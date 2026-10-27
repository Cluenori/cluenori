import type { EnvironmentKey } from "@cluenori/foundation"
import { calendarDayOfNumber, dayNumberOf, dayStartMillis, Period } from "@cluenori/foundation"
import { Incidents } from "@cluenori/incidents"
import type { ProjectNotFound } from "@cluenori/projects"
import { isProduction, Projects } from "@cluenori/projects"
import type { AppUsage, ErrorTable, OperationQuery, OperationTable } from "@cluenori/signals"
import { AppSignals, Signals, stepMillis } from "@cluenori/signals"
import { Context, DateTime, Effect, Layer } from "effect"

import { itemsOf } from "./detectors.ts"
import type { ProjectPulse } from "./project-pulse.ts"
import { pulseOf } from "./project-pulse.ts"
import type { TodayItem } from "./today-item.ts"

const hourMillis = stepMillis["1h"]

// The stored day `day` of one environment's usage, where it is counted: a day before its apps sent
// anything isn't listed, as it is unknown, not zero.
const countedOn = (day: number) => (usage: AppUsage) =>
  usage.days.filter((counted) => counted.day === calendarDayOfNumber(day))

/**
 * What needs attention in one project now, and how it is going. Runs inside the Durable Object that
 * holds the project's database, beside the engines it reads.
 */
export class Today extends Context.Service<
  Today,
  {
    /**
     * The project's items at the clock's time, in no order, in the environments it calls production:
     * its open incidents, its errors new or happening now, its operations slower than over the 7
     * days before, its operations quiet as guessed from their history, and the project itself when it has components but sent nothing in the last day.
     * Reads only: the incidents, the errors of the last day in each production environment, and the
     * operations of the last day and of the 7 days before. Modules' items come from their own
     * detectors, which the host composes beside these.
     */
    readonly items: Effect.Effect<ReadonlyArray<TodayItem>, ProjectNotFound>
    /**
     * The project's pulse at the clock's time, in the environments it calls production: its load by
     * the hour over the current hour so far and the 23 before it, summed over each production
     * environment its telemetry named then, or over all of it when it named none; and its apps'
     * people on the latest whole UTC day and the same day a week before, summed over its production
     * environments. Reads only: the environments the hour counts named, one load series per
     * production environment among them, and two one-day usage questions per production
     * environment.
     */
    readonly pulse: Effect.Effect<ProjectPulse, ProjectNotFound>
  }
>()("@cluenori/today/today") {
  /** Builds the engine on the object's Incidents, Signals, AppSignals, and Projects. */
  static readonly layer = Layer.effect(
    Today,
    Effect.gen(function* () {
      const incidents = yield* Incidents
      const signals = yield* Signals
      const apps = yield* AppSignals
      const projects = yield* Projects

      // One environment's apps' usage on one stored day.
      const usageOn = (day: number) => (environment: EnvironmentKey) =>
        apps.usage({
          period: new Period({
            from: DateTime.makeUnsafe(dayStartMillis(day)),
            to: DateTime.makeUnsafe(dayStartMillis(day + 1)),
          }),
          environment,
        })

      const items = Effect.gen(function* () {
        const project = yield* projects.project
        const components = yield* projects.components
        const settings = yield* projects.settings
        const production = (environment: Parameters<typeof isProduction>[1]) => isProduction(settings, environment)
        const now = yield* DateTime.now
        const dayAgo = DateTime.subtract(now, { days: 1 })
        const lastDay = new Period({ from: dayAgo, to: now })
        const weekBefore = new Period({ from: DateTime.subtract(now, { days: 8 }), to: dayAgo })
        const all = yield* incidents.incidents
        const productionOnly = (table: OperationTable): OperationTable => {
          const rows = table.rows.filter((row) => production(row.environment))
          return {
            ...table,
            rows,
            count: rows.reduce((total, row) => total + row.count, 0),
            errors: rows.reduce((total, row) => total + row.errors, 0),
          }
        }
        // Each production environment's errors, merged: an error group's own environment is only
        // where it was last seen. Not handled: errors logged without an environment, which every
        // environment's question leaves out; that takes errors that filter by "no environment".
        const tables = yield* Effect.forEach(settings.productionEnvironments, (environment) =>
          signals.errors({ period: lastDay, environment }),
        )
        const merged = new Map<string, ErrorTable["groups"][number]>()
        for (const group of tables.flatMap((table) => table.groups)) {
          const earlier = merged.get(group.id)
          merged.set(
            group.id,
            earlier === undefined ? group : { ...earlier, occurrences: earlier.occurrences + group.occurrences },
          )
        }
        const groups = [...merged.values()].toSorted((left, right) => right.occurrences - left.occurrences)
        return itemsOf({
          project: project.key,
          incidents: {
            ...all,
            open: all.open.filter((incident) => production(incident.environment)),
            resolved: all.resolved.filter((incident) => production(incident.environment)),
            quiet: all.quiet.filter((quiet) => production(quiet.environment)),
          },
          errors: { groups, occurrences: groups.reduce((total, group) => total + group.occurrences, 0) },
          operations: {
            lastDay: productionOnly(yield* signals.operations({ period: lastDay })),
            usual: productionOnly(yield* signals.operations({ period: weekBefore })),
          },
          components: components.length,
          expiringKeys: yield* projects.expiringIngestKeys,
          now: DateTime.toEpochMillis(now),
        })
      }).pipe(Effect.withSpan("Today.items"))

      const pulse = Effect.gen(function* () {
        const project = yield* projects.project
        const settings = yield* projects.settings
        const now = yield* DateTime.now
        const nowMillis = DateTime.toEpochMillis(now)
        // The current hour so far and the 23 before it: every point a whole hour but the last.
        const hoursFrom = Math.floor(nowMillis / hourMillis) * hourMillis - 23 * hourMillis
        const lastHours = new Period({ from: DateTime.makeUnsafe(hoursFrom), to: now })
        const named = yield* signals.environments(lastHours)
        // Telemetry without an environment is production by rule; when the telemetry named none, all
        // of it is asked once. Not handled: telemetry with and without an environment in the same
        // hours, whose part without one is left out; counting it takes load that filters by "no
        // environment".
        const asked: ReadonlyArray<OperationQuery> =
          named.length === 0
            ? [{ period: lastHours }]
            : named
                .filter((environment) => isProduction(settings, environment))
                .map((environment) => ({ period: lastHours, environment }))
        const load = yield* Effect.forEach(asked, (query) => signals.loadOverTime(query, "1h"))
        // The latest whole UTC day, and the same day a week before, each in every production
        // environment. Apps' signals always name their environment, so none is left out. Not
        // handled: a person active in two production environments that day counts in each; counting
        // them once takes usage across several environments.
        const latestDay = dayNumberOf(nowMillis) - 1
        const weekBeforeDay = latestDay - 7
        const latest = yield* Effect.forEach(settings.productionEnvironments, usageOn(latestDay))
        const weekBefore = yield* Effect.forEach(settings.productionEnvironments, usageOn(weekBeforeDay))
        return pulseOf({
          project: project.key,
          load,
          latest: latest.flatMap(countedOn(latestDay)),
          weekBefore: weekBefore.flatMap(countedOn(weekBeforeDay)),
        })
      }).pipe(Effect.withSpan("Today.pulse"))

      return Today.of({ items, pulse })
    }),
  )
}
