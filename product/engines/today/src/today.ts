import { Period } from "@cluenori/foundation"
import { Incidents } from "@cluenori/incidents"
import type { ProjectNotFound } from "@cluenori/projects"
import { isProduction, Projects } from "@cluenori/projects"
import type { ErrorTable, OperationTable } from "@cluenori/signals"
import { Signals } from "@cluenori/signals"
import { Context, DateTime, Effect, Layer } from "effect"

import { itemsOf } from "./detectors.ts"
import type { TodayItem } from "./today-item.ts"

/**
 * What needs attention in one project now. Runs inside the Durable Object that holds the project's
 * database, beside the engines it reads.
 */
export class Today extends Context.Service<
  Today,
  {
    /**
     * The project's items at the clock's time, in no order, in the environments it calls production:
     * its open incidents, its errors new or happening now, its operations slower than over the 7
     * days before, and the project itself when it has components but sent nothing in the last day.
     * Reads only: the incidents, the errors of the last day in each production environment, and the
     * operations of the last day and of the 7 days before.
     */
    readonly items: Effect.Effect<ReadonlyArray<TodayItem>, ProjectNotFound>
  }
>()("@cluenori/today/today") {
  /** Builds the engine on the object's Incidents, Signals, and Projects. */
  static readonly layer = Layer.effect(
    Today,
    Effect.gen(function* () {
      const incidents = yield* Incidents
      const signals = yield* Signals
      const projects = yield* Projects

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
          },
          errors: { groups, occurrences: groups.reduce((total, group) => total + group.occurrences, 0) },
          operations: {
            lastDay: productionOnly(yield* signals.operations({ period: lastDay })),
            usual: productionOnly(yield* signals.operations({ period: weekBefore })),
          },
          components: components.length,
          now: DateTime.toEpochMillis(now),
        })
      }).pipe(Effect.withSpan("Today.items"))

      return Today.of({ items })
    }),
  )
}
