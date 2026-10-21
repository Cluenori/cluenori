import type { ActivityEntry, Actor } from "@cluenori/foundation"
import {
  ActivityLog,
  ComponentKey,
  EnvelopeName,
  EnvironmentKey,
  Period,
  ProcessName,
  Source,
} from "@cluenori/foundation"
import type { ProjectNotFound } from "@cluenori/projects"
import { ComponentNotFound, Projects } from "@cluenori/projects"
import type { OperationRow } from "@cluenori/signals"
import { Signals } from "@cluenori/signals"
import { Context, Crypto, DateTime, Duration, Effect, Layer, Option, Schema } from "effect"
import { HttpClient } from "effect/http"
import type { SqlError } from "effect/sql"
import { SqlClient, SqlSchema } from "effect/sql"

import {
  checkTimeout,
  downAfter,
  failingWindow,
  isFailing,
  overdueAt,
  reopenWithin,
  resolveAfter,
  scheduleWindows,
  titleOf,
  usualGapOf,
  usualWindow,
  worseTimes,
} from "./detectors.ts"
import type { Evidence, IncidentChange } from "./incident.ts"
import { Detector, Evidence as EvidenceSchema, Incident, IncidentId, IncidentNotFound } from "./incident.ts"
import type { IncidentList } from "./incident.ts"
import {
  IncidentAcknowledged,
  IncidentOpened,
  IncidentReopened,
  IncidentResolved,
  IncidentWorsened,
  MonitorAdded,
  MonitorRemoved,
} from "./incidents-activity.ts"
import { migrateIncidents } from "./incidents-migrations.ts"
import type { AddMonitor, MonitorList } from "./monitor.ts"
import {
  Monitor,
  MonitorExists,
  MonitorId,
  MonitorLimitReached,
  monitorLimit,
  MonitorNotFound,
  MonitorUrl,
} from "./monitor.ts"

const source = Source.make("engine:incidents")

// The detectors act on their own, as one process.
const checker: Actor = { _tag: "System", process: ProcessName.make("incidents.check") }

const hour = Duration.toMillis(Duration.hours(1))

// How many resolved incidents the list shows, and from how far back.
const resolvedListed = 50
const resolvedShown = Duration.toMillis(Duration.days(7))

// How many monitors are fetched at once.
const checksAtOnce = 10

const EnvironmentColumn = Schema.Union([Schema.Literal(""), EnvironmentKey])

const IncidentRow = Schema.Struct({
  id: IncidentId,
  detector: Detector,
  component: ComponentKey,
  environment: EnvironmentColumn,
  subject: Schema.String,
  title: Schema.String,
  evidence: Schema.fromJsonString(EvidenceSchema),
  level: Schema.Finite,
  openedAt: Schema.DateTimeUtcFromString,
  resolvedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
  acknowledgedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
  lastFiringAt: Schema.NullOr(Schema.Int),
})
type IncidentRow = typeof IncidentRow.Type

const MonitorRow = Schema.Struct({
  id: MonitorId,
  component: ComponentKey,
  url: MonitorUrl,
  addedAt: Schema.DateTimeUtcFromString,
  failures: Schema.NullOr(Schema.Int),
  problem: Schema.NullOr(Schema.String),
  checkedAt: Schema.NullOr(Schema.Int),
})
type MonitorRow = typeof MonitorRow.Type

const BaselineRow = Schema.Struct({
  component: ComponentKey,
  environment: EnvironmentColumn,
  operation: EnvelopeName,
  usualRate: Schema.Finite,
  gapMs: Schema.NullOr(Schema.Finite),
  lastRanAt: Schema.NullOr(Schema.Int),
})
type BaselineRow = typeof BaselineRow.Type

// The activity of each change a check makes.
const changeEntries = {
  opened: IncidentOpened,
  reopened: IncidentReopened,
  worsened: IncidentWorsened,
  resolved: IncidentResolved,
}

const StateRow = Schema.Struct({ learnedAt: Schema.NullOr(Schema.Int), checkedAt: Schema.NullOr(Schema.Int) })

/** What a detector sees now: the incident it would open, or keep open. */
interface Firing {
  readonly detector: Detector
  readonly component: ComponentKey
  readonly environment: EnvironmentKey | undefined
  readonly subject: string
  readonly evidence: Evidence
  /** How bad it is: a failure rate, else 0. */
  readonly level: number
}

// An incident's identity: at most one is open for each. Keys hold no control characters, so NUL
// separates them unambiguously.
const keyOf = (incident: {
  readonly detector: Detector
  readonly component: ComponentKey
  readonly environment: EnvironmentKey | "" | undefined
  readonly subject: string
}) => [incident.detector, incident.component, incident.environment ?? "", incident.subject].join("\u0000")

const operationKeyOf = (row: {
  readonly component: ComponentKey
  readonly environment?: EnvironmentKey | "" | undefined
  readonly operation: EnvelopeName
}) => [row.component, row.environment ?? "", row.operation].join("\u0000")

const incidentOf = (row: IncidentRow) =>
  new Incident({
    id: row.id,
    component: row.component,
    ...(row.environment === "" ? {} : { environment: row.environment }),
    subject: row.subject,
    title: row.title,
    evidence: row.evidence,
    openedAt: row.openedAt,
    ...(row.resolvedAt === null ? {} : { resolvedAt: row.resolvedAt }),
    ...(row.acknowledgedAt === null ? {} : { acknowledgedAt: row.acknowledgedAt }),
  })

const periodOf = (from: number, to: number) =>
  new Period({ from: DateTime.makeUnsafe(from), to: DateTime.makeUnsafe(to) })

const iso = (millis: number) => DateTime.formatIso(DateTime.makeUnsafe(millis))

/**
 * A project's incidents, the detectors that open and resolve them, and the monitors they check.
 * Runs inside the Durable Object that holds the project's database, beside `Signals`, whose counts
 * the detectors read.
 */
export class Incidents extends Context.Service<
  Incidents,
  {
    /**
     * Looks once, at the clock's time, and returns what changed for whoever tells people. It
     * fetches every monitor, ten at a time, each within 10 seconds, with no trace headers; runs the
     * detectors on the counts; and opens, reopens, worsens and resolves incidents, with their
     * activity, in one commit by `incidents.check`. Once an hour it first relearns each operation's
     * usual error rate and schedule. A change to an acknowledged incident is returned too, with its
     * `acknowledgedAt`, so whoever tells people stays quiet. Meant to run every minute; run sooner,
     * it fetches the monitors again, and changes nothing twice.
     */
    readonly check: Effect.Effect<ReadonlyArray<IncidentChange>>
    /** The open incidents, and those resolved in the last 7 days. Reads only. */
    readonly incidents: Effect.Effect<IncidentList>
    /**
     * Marks an incident as being looked at, with `incident.acknowledged`, which stops its
     * notifications. Again for one acknowledged, it keeps the first time. Fails with
     * `IncidentNotFound` when the project has no incident with that ID.
     */
    readonly acknowledge: (actor: Actor, id: IncidentId) => Effect.Effect<Incident, IncidentNotFound>
    /** The project's monitors, oldest first, each with its last check. Reads only. */
    readonly monitors: Effect.Effect<MonitorList>
    /**
     * Adds a monitor, with `monitor.added`; it is first fetched at the next check. Fails with
     * `ComponentNotFound` for a component the project doesn't have, `MonitorExists` when the
     * component already has one of that URL, and `MonitorLimitReached` past 20.
     */
    readonly addMonitor: (
      actor: Actor,
      input: AddMonitor,
    ) => Effect.Effect<Monitor, ComponentNotFound | MonitorExists | MonitorLimitReached | ProjectNotFound>
    /**
     * Removes a monitor, with `monitor.removed`, and resolves its open incident, if any. Fails with
     * `MonitorNotFound` when the project has no monitor with that ID.
     */
    readonly removeMonitor: (actor: Actor, id: MonitorId) => Effect.Effect<void, MonitorNotFound>
  }
>()("@cluenori/incidents/incidents") {
  /**
   * Builds the engine on the object's database, beside `Signals` and `Projects`, first creating or
   * updating its tables. Monitors are fetched with the `HttpClient` the host provides.
   */
  static readonly layer = Layer.effect(
    Incidents,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const log = yield* ActivityLog
      const signals = yield* Signals
      const projects = yield* Projects
      const crypto = yield* Crypto.Crypto
      const client = yield* HttpClient.HttpClient
      yield* migrateIncidents.pipe(Effect.orDie)

      const encodeEvidence = Schema.encodeEffect(Schema.fromJsonString(EvidenceSchema))

      const incidentColumns = sql`i.id, i.detector, i.component, i.environment, i.subject, i.title, i.evidence,
        i.level, i.opened_at AS "openedAt", i.resolved_at AS "resolvedAt",
        i.acknowledged_at AS "acknowledgedAt", f.last_firing_at AS "lastFiringAt"`

      const findOpen = SqlSchema.findAll({
        Request: Schema.Void,
        Result: IncidentRow,
        execute: () => sql`
          SELECT ${incidentColumns} FROM incidents_incidents i LEFT JOIN incidents_firing f ON f.incident = i.id
          WHERE i.resolved_at IS NULL ORDER BY i.opened_at DESC`,
      })

      const findResolved = SqlSchema.findAll({
        Request: Schema.String,
        Result: IncidentRow,
        execute: (since) => sql`
          SELECT ${incidentColumns} FROM incidents_incidents i LEFT JOIN incidents_firing f ON f.incident = i.id
          WHERE i.resolved_at >= ${since} ORDER BY i.resolved_at DESC LIMIT ${resolvedListed}`,
      })

      // The latest incident of a key resolved since `since`, which a problem back so soon reopens.
      const findRecentlyResolved = SqlSchema.findOneOption({
        Request: Schema.Struct({
          detector: Detector,
          component: ComponentKey,
          environment: Schema.String,
          subject: Schema.String,
          since: Schema.String,
        }),
        Result: IncidentRow,
        execute: (key) => sql`
          SELECT ${incidentColumns} FROM incidents_incidents i LEFT JOIN incidents_firing f ON f.incident = i.id
          WHERE i.detector = ${key.detector} AND i.component = ${key.component}
            AND i.environment = ${key.environment} AND i.subject = ${key.subject} AND i.resolved_at >= ${key.since}
          ORDER BY i.resolved_at DESC LIMIT 1`,
      })

      const findIncident = SqlSchema.findOneOption({
        Request: IncidentId,
        Result: IncidentRow,
        execute: (id) => sql`
          SELECT ${incidentColumns} FROM incidents_incidents i LEFT JOIN incidents_firing f ON f.incident = i.id
          WHERE i.id = ${id}`,
      })

      const findMonitors = SqlSchema.findAll({
        Request: Schema.Void,
        Result: MonitorRow,
        execute: () => sql`
          SELECT m.id, m.component, m.url, m.added_at AS "addedAt", c.failures, c.problem, c.checked_at AS "checkedAt"
          FROM incidents_monitors m LEFT JOIN incidents_monitor_checks c ON c.monitor = m.id
          ORDER BY m.added_at, m.id`,
      })

      const findBaselines = SqlSchema.findAll({
        Request: Schema.Void,
        Result: BaselineRow,
        execute: () => sql`
          SELECT component, environment, operation, usual_rate AS "usualRate", gap_ms AS "gapMs",
            last_ran_at AS "lastRanAt"
          FROM incidents_baselines`,
      })

      const findState = SqlSchema.findOneOption({
        Request: Schema.Void,
        Result: StateRow,
        execute: () => sql`SELECT learned_at AS "learnedAt", checked_at AS "checkedAt" FROM incidents_state`,
      })

      const newId = crypto.randomUUIDv7().pipe(Effect.orDie)

      // ---- Learning: each operation's usual error rate, and its schedule if it runs on one ------

      const learn = Effect.fn("Incidents.learn")(function* (now: number) {
        // Up to an hour before now: learned at most an hour ago, the usual never holds the 15
        // minutes being judged, so an operation failing from its start has a usual of none.
        const week = yield* signals.operations({ period: periodOf(now - Duration.toMillis(usualWindow), now - hour) })
        // The two days first: a schedule learned there stands over one from the 6 hours.
        const schedules = new Map<string, { readonly gap: number; readonly last: number }>()
        for (const { window, atMost } of scheduleWindows) {
          const ran = yield* signals.minutesRan({ period: periodOf(now - Duration.toMillis(window), now) }, atMost)
          for (const entry of ran) {
            const minutes = entry.minutes.map(DateTime.toEpochMillis)
            const gap = usualGapOf(minutes)
            const last = minutes.at(-1)
            if (gap !== undefined && last !== undefined && !schedules.has(operationKeyOf(entry))) {
              schedules.set(operationKeyOf(entry), { gap, last })
            }
          }
        }
        const rows = week.rows.map((row) => {
          const schedule = schedules.get(operationKeyOf(row))
          return {
            component: row.component,
            environment: row.environment ?? "",
            operation: row.operation,
            usual_rate: row.count === 0 ? 0 : row.errors / row.count,
            gap_ms: schedule?.gap ?? null,
            last_ran_at: schedule?.last ?? null,
          }
        })
        yield* sql
          .withTransaction(
            Effect.gen(function* () {
              yield* sql`DELETE FROM incidents_baselines`
              // A hundred rows at a time stays well within SQLite's limit of bound values.
              for (let start = 0; start < rows.length; start += 100) {
                yield* sql`INSERT INTO incidents_baselines ${sql.insert(rows.slice(start, start + 100))}`
              }
              yield* sql`INSERT INTO incidents_state (id, learned_at) VALUES (1, ${now})
              ON CONFLICT (id) DO UPDATE SET learned_at = excluded.learned_at`
            }),
          )
          .pipe(Effect.orDie)
      })

      // ---- Detectors: what each sees now ------------------------------------------------------

      const failingNow = Effect.fn("Incidents.failingNow")(function* (
        now: number,
        baselines: ReadonlyArray<BaselineRow>,
      ) {
        const usual = new Map(baselines.map((row) => [operationKeyOf(row), row.usualRate] as const))
        const recent = yield* signals.operations({ period: periodOf(now - Duration.toMillis(failingWindow), now) })
        return recent.rows.flatMap((row: OperationRow): ReadonlyArray<Firing> => {
          const usualRate = usual.get(operationKeyOf(row)) ?? 0
          return isFailing(row, usualRate)
            ? [
                {
                  detector: "failing",
                  component: row.component,
                  environment: row.environment,
                  subject: row.operation,
                  evidence: {
                    _tag: "failing",
                    operation: row.operation,
                    failed: row.errors,
                    count: row.count,
                    usualRate,
                  },
                  level: row.errors / row.count,
                },
              ]
            : []
        })
      })

      // Scheduled operations that are overdue, and those already stopped, whose schedule may no
      // longer be learned: an open incident stays open until its operation runs again.
      const stoppedNow = Effect.fn("Incidents.stoppedNow")(function* (
        now: number,
        baselines: ReadonlyArray<BaselineRow>,
        open: ReadonlyArray<IncidentRow>,
      ) {
        const watched = new Map<
          string,
          {
            readonly component: ComponentKey
            readonly environment: EnvironmentKey | undefined
            readonly operation: EnvelopeName
            readonly gap: number
            readonly last: number
          }
        >()
        for (const row of baselines) {
          if (row.gapMs !== null && row.lastRanAt !== null) {
            watched.set(operationKeyOf(row), {
              component: row.component,
              environment: row.environment === "" ? undefined : row.environment,
              operation: row.operation,
              gap: row.gapMs,
              last: row.lastRanAt,
            })
          }
        }
        for (const row of open) {
          if (row.evidence._tag === "stopped") {
            const environment = row.environment === "" ? undefined : row.environment
            const key = operationKeyOf({ component: row.component, environment, operation: row.evidence.operation })
            watched.set(key, {
              component: row.component,
              environment,
              operation: row.evidence.operation,
              gap: row.evidence.usualGapMs,
              last: DateTime.toEpochMillis(row.evidence.lastRanAt),
            })
          }
        }
        const firings: Array<Firing> = []
        for (const entry of watched.values()) {
          if (now < overdueAt(entry.last, entry.gap)) {
            continue
          }
          const since = yield* signals.minutesRan(
            {
              period: periodOf(entry.last + 60_000, now),
              component: entry.component,
              operation: entry.operation,
              ...(entry.environment === undefined ? {} : { environment: entry.environment }),
            },
            Number.MAX_SAFE_INTEGER,
          )
          const latest = since.flatMap((ran) => ran.minutes.map(DateTime.toEpochMillis)).at(-1)
          if (latest !== undefined) {
            yield* sql`UPDATE incidents_baselines SET last_ran_at = ${latest}
              WHERE component = ${entry.component} AND environment = ${entry.environment ?? ""}
                AND operation = ${entry.operation}`.pipe(Effect.orDie)
            continue
          }
          firings.push({
            detector: "stopped",
            component: entry.component,
            environment: entry.environment,
            subject: entry.operation,
            evidence: {
              _tag: "stopped",
              operation: entry.operation,
              lastRanAt: DateTime.makeUnsafe(entry.last),
              usualGapMs: entry.gap,
            },
            level: 0,
          })
        }
        return firings
      })

      // One check of a URL: absent when it passed; else what was wrong.
      const problemOf = (url: MonitorUrl) =>
        client.get(url).pipe(
          Effect.map((response) => (response.status < 400 ? undefined : `HTTP ${response.status}`)),
          Effect.timeoutOption(checkTimeout),
          Effect.map(Option.getOrElse(() => `No answer in ${Duration.toSeconds(checkTimeout)} s`)),
          Effect.catchTag("HttpClientError", (error) =>
            Effect.succeed(
              error.reason._tag === "TransportError" ? "Could not connect" : `Failed: ${error.reason._tag}`,
            ),
          ),
          Effect.provideService(HttpClient.TracerPropagationEnabled, false),
        )

      const downNow = Effect.fn("Incidents.downNow")(function* (now: number) {
        const monitors = yield* findMonitors(undefined).pipe(Effect.orDie)
        const checked = yield* Effect.forEach(
          monitors,
          (monitor) => problemOf(monitor.url).pipe(Effect.map((problem) => ({ monitor, problem }))),
          { concurrency: checksAtOnce },
        )
        const firings: Array<Firing> = []
        for (const { monitor, problem } of checked) {
          const failures = problem === undefined ? 0 : (monitor.failures ?? 0) + 1
          yield* sql`INSERT INTO incidents_monitor_checks ${sql.insert({
            monitor: monitor.id,
            failures,
            problem: problem ?? null,
            checked_at: now,
          })}
            ON CONFLICT (monitor) DO UPDATE SET failures = excluded.failures, problem = excluded.problem,
              checked_at = excluded.checked_at`.pipe(Effect.orDie)
          if (problem !== undefined && failures >= downAfter) {
            firings.push({
              detector: "down",
              component: monitor.component,
              environment: undefined,
              subject: monitor.url,
              evidence: { _tag: "down", monitor: monitor.id, url: monitor.url, failures, problem },
              level: 0,
            })
          }
        }
        return firings
      })

      // ---- An incident's life ---------------------------------------------------------------

      const resolvedEntry = (row: IncidentRow): ActivityEntry => ({
        payload: IncidentResolved.make({
          incident: row.id,
          detector: row.detector,
          component: row.component,
          subject: row.subject,
          title: row.title,
        }),
      })

      // Opens, reopens, worsens, and resolves incidents from what the detectors see now: the SQL of
      // each change, the activity it emits, and what to tell people.
      const settle = Effect.fn("Incidents.settle")(function* (
        now: number,
        open: ReadonlyArray<IncidentRow>,
        firings: ReadonlyArray<Firing>,
      ) {
        const openByKey = new Map(open.map((row) => [keyOf(row), row] as const))
        const firingKeys = new Set(firings.map(keyOf))
        const writes: Array<Effect.Effect<unknown, SqlError.SqlError>> = []
        const entries: Array<ActivityEntry> = []
        const changes: Array<IncidentChange> = []
        const record = (change: IncidentChange["change"], row: IncidentRow) => {
          const fields = {
            incident: row.id,
            detector: row.detector,
            component: row.component,
            subject: row.subject,
            title: row.title,
          }
          entries.push({ payload: changeEntries[change].make(fields) })
          changes.push({ change, incident: incidentOf(row) })
        }

        for (const firing of firings) {
          const key = keyOf(firing)
          const title = titleOf(firing.evidence)
          const evidence = yield* encodeEvidence(firing.evidence).pipe(Effect.orDie)
          const current = openByKey.get(key)
          if (current !== undefined) {
            yield* sql`UPDATE incidents_firing SET last_firing_at = ${now} WHERE incident = ${current.id}`.pipe(
              Effect.orDie,
            )
            if (firing.detector === "failing" && firing.level >= worseTimes * current.level) {
              writes.push(
                sql`UPDATE incidents_incidents SET title = ${title}, evidence = ${evidence}, level = ${firing.level}
                  WHERE id = ${current.id}`,
              )
              record("worsened", { ...current, title, evidence: firing.evidence, level: firing.level })
            }
            continue
          }
          const environment = firing.environment ?? ""
          const recent = yield* findRecentlyResolved({
            detector: firing.detector,
            component: firing.component,
            environment,
            subject: firing.subject,
            since: iso(now - Duration.toMillis(reopenWithin)),
          }).pipe(Effect.orDie)
          if (Option.isSome(recent)) {
            const row = recent.value
            writes.push(
              sql`UPDATE incidents_incidents SET resolved_at = NULL, acknowledged_at = NULL, title = ${title},
                evidence = ${evidence}, level = ${firing.level} WHERE id = ${row.id}`,
              sql`INSERT INTO incidents_firing ${sql.insert({ incident: row.id, last_firing_at: now })}`,
            )
            record("reopened", {
              ...row,
              title,
              evidence: firing.evidence,
              level: firing.level,
              resolvedAt: null,
              acknowledgedAt: null,
            })
            continue
          }
          const id = IncidentId.make(yield* newId)
          const openedAt = DateTime.makeUnsafe(now)
          writes.push(
            sql`INSERT INTO incidents_incidents ${sql.insert({
              id,
              detector: firing.detector,
              component: firing.component,
              environment,
              subject: firing.subject,
              title,
              evidence,
              level: firing.level,
              opened_at: DateTime.formatIso(openedAt),
            })}`,
            sql`INSERT INTO incidents_firing ${sql.insert({ incident: id, last_firing_at: now })}`,
          )
          record("opened", {
            id,
            detector: firing.detector,
            component: firing.component,
            environment,
            subject: firing.subject,
            title,
            evidence: firing.evidence,
            level: firing.level,
            openedAt,
            resolvedAt: null,
            acknowledgedAt: null,
            lastFiringAt: now,
          })
        }

        for (const row of open) {
          if (firingKeys.has(keyOf(row)) || now - (row.lastFiringAt ?? 0) < Duration.toMillis(resolveAfter)) {
            continue
          }
          writes.push(
            sql`UPDATE incidents_incidents SET resolved_at = ${iso(now)} WHERE id = ${row.id}`,
            sql`DELETE FROM incidents_firing WHERE incident = ${row.id}`,
          )
          record("resolved", { ...row, resolvedAt: DateTime.makeUnsafe(now) })
        }

        const [first, ...rest] = entries
        if (first !== undefined) {
          yield* log.commit({
            source,
            actor: checker,
            write: Effect.all(writes, { discard: true }).pipe(Effect.orDie),
            activity: () => [first, ...rest],
          })
        }
        return changes
      })

      const check = Effect.gen(function* () {
        const now = DateTime.toEpochMillis(yield* DateTime.now)
        const state = yield* findState(undefined).pipe(Effect.orDie)
        const learnedAt = Option.match(state, { onNone: () => null, onSome: (row) => row.learnedAt })
        if (learnedAt === null || now - learnedAt >= hour) {
          yield* learn(now)
        }
        const baselines = yield* findBaselines(undefined).pipe(Effect.orDie)
        const open = yield* findOpen(undefined).pipe(Effect.orDie)
        const firings = [
          ...(yield* downNow(now)),
          ...(yield* failingNow(now, baselines)),
          ...(yield* stoppedNow(now, baselines, open)),
        ]
        const changes = yield* settle(now, open, firings)
        yield* sql`INSERT INTO incidents_state (id, checked_at) VALUES (1, ${now})
          ON CONFLICT (id) DO UPDATE SET checked_at = excluded.checked_at`.pipe(Effect.orDie)
        return changes
      }).pipe(Effect.withSpan("Incidents.check"))

      // ---- Questions and actions ------------------------------------------------------------

      const incidents = Effect.gen(function* () {
        const now = DateTime.toEpochMillis(yield* DateTime.now)
        const open = yield* findOpen(undefined).pipe(Effect.orDie)
        const resolved = yield* findResolved(iso(now - resolvedShown)).pipe(Effect.orDie)
        const state = yield* findState(undefined).pipe(Effect.orDie)
        const checkedAt = Option.match(state, { onNone: () => null, onSome: (row) => row.checkedAt })
        const list: IncidentList = {
          open: open.map(incidentOf),
          resolved: resolved.map(incidentOf),
          ...(checkedAt === null ? {} : { checkedAt: DateTime.makeUnsafe(checkedAt) }),
        }
        return list
      }).pipe(Effect.withSpan("Incidents.incidents"))

      const acknowledge = Effect.fn("Incidents.acknowledge")(function* (actor: Actor, id: IncidentId) {
        return yield* log.commit({
          source,
          actor,
          write: Effect.gen(function* () {
            const found = yield* findIncident(id).pipe(Effect.orDie)
            if (Option.isNone(found)) {
              return yield* new IncidentNotFound({ incident: id })
            }
            const row = found.value
            if (row.acknowledgedAt !== null) {
              return incidentOf(row)
            }
            const at = yield* DateTime.now
            yield* sql`UPDATE incidents_incidents SET acknowledged_at = ${DateTime.formatIso(at)} WHERE id = ${id}`.pipe(
              Effect.orDie,
            )
            return incidentOf({ ...row, acknowledgedAt: at })
          }),
          activity: (incident) => [{ payload: IncidentAcknowledged.make({ incident: incident.id }) }],
        })
      })

      const monitors = Effect.gen(function* () {
        const rows = yield* findMonitors(undefined).pipe(Effect.orDie)
        const list: MonitorList = {
          monitors: rows.map((row: MonitorRow) => ({
            monitor: new Monitor({ id: row.id, component: row.component, url: row.url, addedAt: row.addedAt }),
            ...(row.checkedAt === null
              ? {}
              : {
                  lastCheck: {
                    at: DateTime.makeUnsafe(row.checkedAt),
                    ...(row.problem === null ? {} : { problem: row.problem }),
                  },
                }),
          })),
        }
        return list
      }).pipe(Effect.withSpan("Incidents.monitors"))

      // The project and the monitor's ID are settled before the transaction, which holds only SQL.
      const addMonitor = Effect.fn("Incidents.addMonitor")(function* (actor: Actor, input: AddMonitor) {
        const components = yield* projects.components
        if (!components.some((component) => component.key === input.component)) {
          return yield* new ComponentNotFound({ component: input.component })
        }
        const id = MonitorId.make(yield* newId)
        return yield* log.commit({
          source,
          actor,
          write: Effect.gen(function* () {
            const existing = yield* findMonitors(undefined).pipe(Effect.orDie)
            if (existing.some((monitor) => monitor.component === input.component && monitor.url === input.url)) {
              return yield* new MonitorExists({ component: input.component, url: input.url })
            }
            if (existing.length >= monitorLimit) {
              return yield* new MonitorLimitReached({ limit: monitorLimit })
            }
            const addedAt = yield* DateTime.now
            yield* sql`INSERT INTO incidents_monitors ${sql.insert({
              id,
              component: input.component,
              url: input.url,
              added_at: DateTime.formatIso(addedAt),
            })}`.pipe(Effect.orDie)
            return new Monitor({ id, component: input.component, url: input.url, addedAt })
          }),
          activity: (monitor) => [
            { payload: MonitorAdded.make({ monitor: monitor.id, component: monitor.component, url: monitor.url }) },
          ],
        })
      })

      const removeMonitor = Effect.fn("Incidents.removeMonitor")(function* (actor: Actor, id: MonitorId) {
        const now = DateTime.toEpochMillis(yield* DateTime.now)
        yield* log.commit({
          source,
          actor,
          write: Effect.gen(function* () {
            const monitor = (yield* findMonitors(undefined).pipe(Effect.orDie)).find((row) => row.id === id)
            if (monitor === undefined) {
              return yield* new MonitorNotFound({ monitor: id })
            }
            const open = yield* findOpen(undefined).pipe(Effect.orDie)
            const down = open.find(
              (row) => row.detector === "down" && row.component === monitor.component && row.subject === monitor.url,
            )
            if (down !== undefined) {
              yield* sql`UPDATE incidents_incidents SET resolved_at = ${iso(now)} WHERE id = ${down.id}`.pipe(
                Effect.orDie,
              )
              yield* sql`DELETE FROM incidents_firing WHERE incident = ${down.id}`.pipe(Effect.orDie)
            }
            yield* sql`DELETE FROM incidents_monitor_checks WHERE monitor = ${id}`.pipe(Effect.orDie)
            yield* sql`DELETE FROM incidents_monitors WHERE id = ${id}`.pipe(Effect.orDie)
            return down
          }),
          activity: (down) =>
            down === undefined
              ? [{ payload: MonitorRemoved.make({ monitor: id }) }]
              : [{ payload: MonitorRemoved.make({ monitor: id }) }, resolvedEntry(down)],
        })
      })

      return { check, incidents, acknowledge, monitors, addMonitor, removeMonitor }
    }),
  )
}
