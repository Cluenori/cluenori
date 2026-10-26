import type { ActivityEntry, Actor } from "@cluenori/foundation"
import {
  ActivityLog,
  calendarDayOfNumber,
  ComponentKey,
  dayNumberOf,
  EnvelopeName,
  EnvironmentKey,
  Instant,
  Period,
  ProcessName,
  Source,
} from "@cluenori/foundation"
import type { ProjectNotFound } from "@cluenori/projects"
import type { ProjectSettings } from "@cluenori/projects"
import { ComponentNotFound, defaultProjectSettings, isProduction, Projects } from "@cluenori/projects"
import type { OperationRow } from "@cluenori/signals"
import { AppSignals, Signals } from "@cluenori/signals"
import { Context, Crypto, DateTime, Duration, Effect, Layer, Option, Schema } from "effect"
import { HttpClient } from "effect/http"
import type { SqlError } from "effect/sql"
import { SqlClient, SqlSchema } from "effect/sql"

import type { CountCondition } from "./detectors.ts"
import {
  checkTimeout,
  downAfter,
  failingWindow,
  firesOn,
  isFailing,
  measuredOf,
  quietAt,
  reopenWithin,
  resolveAfter,
  rhythmWindows,
  titleOf,
  usualGapOf,
  usualWindow,
  worseTimes,
} from "./detectors.ts"
import type { Evidence, IncidentChange, IncidentDetail, IncidentRelease, IncidentUpdate } from "./incident.ts"
import { Detector, Evidence as EvidenceSchema, Incident, IncidentId, IncidentNotFound } from "./incident.ts"
import type { IncidentList, QuietOperation } from "./incident.ts"
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
import type { MonitorDetail } from "./monitor-detail.ts"
import type {
  AddMonitor,
  MonitorCheck,
  MonitorDay,
  MonitorList,
  MonitorState,
  MonitorStep,
  MonitorUrl,
} from "./monitor.ts"
import {
  AlertLevel,
  Monitor,
  MonitorCondition,
  MonitorExists,
  MonitorId,
  MonitorLimitReached,
  monitorLimit,
  MonitorNotFound,
} from "./monitor.ts"

const source = Source.make("engine:incidents")

// The detectors act on their own, as one process.
const checker: Actor = { _tag: "System", process: ProcessName.make("incidents.check") }

const hour = Duration.toMillis(Duration.hours(1))

// How many resolved incidents the list shows, and from how far back.
const resolvedListed = 50
const resolvedShown = Duration.toMillis(Duration.days(7))

// A Durable Object's SQLite binds at most 100 values in one statement; a baseline has 6, a rhythm 5.
const baselinesAtOnce = Math.floor(100 / 6)
const rhythmsAtOnce = Math.floor(100 / 5)

// How many monitors are fetched at once.
const checksAtOnce = 10

// How long a monitor's every check is kept, and its days' counts; how many days a monitor shows.
const checksKept = Duration.toMillis(Duration.days(7))
const daysShown = 90

// A monitor's recent checks: the last 24 hours, five minutes a step.
const recentShown = Duration.toMillis(Duration.hours(24))
const recentStep = Duration.toMillis(Duration.minutes(5))

// How many of an incident's updates it shows, the latest; how many failed checks and incidents a
// monitor shows; and how long before an incident opened its component's releases are looked for.
const updatesShown = 500
const failuresShown = 20
const incidentsShown = 20
const releasesBefore = hour

const EnvironmentColumn = Schema.Union([Schema.Literal(""), EnvironmentKey])

// Where an incident is, and whether its project calls that environment production.
const placeOf = (environment: EnvironmentKey | "" | undefined, settings: ProjectSettings) => {
  const known = environment === "" ? undefined : environment
  return { ...(known === undefined ? {} : { environment: known }), production: isProduction(settings, known) }
}

const IncidentRow = Schema.Struct({
  id: IncidentId,
  detector: Detector,
  component: ComponentKey,
  environment: EnvironmentColumn,
  subject: Schema.String,
  title: Schema.String,
  evidence: Schema.fromJsonString(EvidenceSchema),
  level: Schema.Finite,
  openedAt: Instant,
  resolvedAt: Schema.NullOr(Instant),
  acknowledgedAt: Schema.NullOr(Instant),
  lastFiringAt: Schema.NullOr(Schema.Int),
})
type IncidentRow = typeof IncidentRow.Type

const MonitorRow = Schema.Struct({
  id: MonitorId,
  component: ComponentKey,
  environment: EnvironmentColumn,
  condition: Schema.fromJsonString(MonitorCondition),
  level: AlertLevel,
  addedAt: Instant,
  failures: Schema.NullOr(Schema.Int),
  problem: Schema.NullOr(Schema.String),
  checkedAt: Schema.NullOr(Schema.Int),
  status: Schema.NullOr(Schema.Int),
  ms: Schema.NullOr(Schema.Finite),
  since: Schema.NullOr(Schema.Int),
  measuredAt: Schema.NullOr(Schema.Int),
  value: Schema.NullOr(Schema.Finite),
})
type MonitorRow = typeof MonitorRow.Type

// A monitor's URL, when it fetches one.
const urlOf = (row: { readonly condition: MonitorCondition }) =>
  row.condition._tag === "noAnswer" ? row.condition.subject.url : undefined

const UpdateRow = Schema.Struct({
  change: Schema.Literals(["opened", "reopened", "worsened", "acknowledged", "resolved"]),
  at: Instant,
  title: Schema.NullOr(Schema.String),
})

const CheckRow = Schema.Struct({
  at: Schema.Int,
  status: Schema.NullOr(Schema.Int),
  ms: Schema.NullOr(Schema.Finite),
  problem: Schema.NullOr(Schema.String),
})

const DayRow = Schema.Struct({
  monitor: MonitorId,
  day: Schema.Int,
  checks: Schema.Int,
  failed: Schema.Int,
  answered: Schema.Int,
  totalMs: Schema.Finite,
})
type DayRow = typeof DayRow.Type

const StepRow = Schema.Struct({
  start: Schema.Int,
  checks: Schema.Int,
  failed: Schema.Int,
  answered: Schema.Int,
  totalMs: Schema.Finite,
  slowestMs: Schema.NullOr(Schema.Finite),
})

// What one check found: the status and time of an answer, absent without one; what was wrong,
// absent when it passed.
interface Checked {
  readonly status: number | undefined
  readonly ms: number | undefined
  readonly problem: string | undefined
}

const BaselineRow = Schema.Struct({
  component: ComponentKey,
  environment: EnvironmentColumn,
  operation: EnvelopeName,
  usualRate: Schema.Finite,
})
type BaselineRow = typeof BaselineRow.Type

const RhythmRow = Schema.Struct({
  component: ComponentKey,
  environment: EnvironmentColumn,
  operation: EnvelopeName,
  gapMs: Schema.Finite,
  lastRanAt: Schema.Int,
  quiet: Schema.Int,
})
type RhythmRow = typeof RhythmRow.Type

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
  /** How its alert reaches phones, as its monitor says; absent for a detector's own. */
  readonly alert: AlertLevel | undefined
}

// An incident's identity: at most one is open for each: a monitor of counts's own, else its
// detector's, component's, environment's and subject's. Keys hold no control characters, so NUL
// separates them unambiguously.
const keyOf = (incident: {
  readonly detector: Detector
  readonly component: ComponentKey
  readonly environment: EnvironmentKey | "" | undefined
  readonly subject: string
  readonly evidence: Evidence
}) =>
  incident.evidence._tag === "monitor"
    ? ["monitor", incident.evidence.monitor].join("\u0000")
    : [incident.detector, incident.component, incident.environment ?? "", incident.subject].join("\u0000")

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

// The first day a monitor shows at `now`, as a day number.
const firstDayShown = (now: number) => dayNumberOf(now) - daysShown + 1

const checkOf = (check: {
  readonly at: number
  readonly status: number | null
  readonly ms: number | null
  readonly problem: string | null
}): MonitorCheck => ({
  at: DateTime.makeUnsafe(check.at),
  ...(check.status === null ? {} : { status: check.status }),
  ...(check.ms === null ? {} : { ms: check.ms }),
  ...(check.problem === null ? {} : { problem: check.problem }),
})

const dayOf = (row: DayRow): MonitorDay => ({
  day: calendarDayOfNumber(row.day),
  checks: row.checks,
  failed: row.failed,
  ...(row.answered === 0 ? {} : { averageMs: row.totalMs / row.answered }),
})

const monitorOf = (row: MonitorRow) =>
  new Monitor({
    id: row.id,
    component: row.component,
    ...(row.environment === "" ? {} : { environment: row.environment }),
    condition: row.condition,
    level: row.level,
    addedAt: row.addedAt,
  })

// A monitor now, from its row, its days, oldest first, and whether it has an open incident.
const stateOf = (row: MonitorRow, days: ReadonlyArray<DayRow>, firing: boolean): MonitorState => ({
  monitor: monitorOf(row),
  ...(row.checkedAt === null
    ? {}
    : { lastCheck: checkOf({ at: row.checkedAt, status: row.status, ms: row.ms, problem: row.problem }) }),
  ...(row.since === null ? {} : { since: DateTime.makeUnsafe(row.since) }),
  days: days.map(dayOf),
  ...(row.measuredAt === null
    ? {}
    : {
        measured: {
          at: DateTime.makeUnsafe(row.measuredAt),
          ...(row.value === null ? {} : { value: row.value }),
        },
      }),
  firing,
})

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
     * usual error rate and guesses how often each runs, for quiet hints. A change to an acknowledged incident is returned too, with its
     * `acknowledgedAt`, so whoever tells people stays quiet. Meant to run every minute; run sooner,
     * it fetches the monitors again, and changes nothing twice.
     */
    readonly check: Effect.Effect<ReadonlyArray<IncidentChange>>
    /** The open incidents, and those resolved in the last 7 days. Reads only. */
    readonly incidents: Effect.Effect<IncidentList>
    /**
     * One incident, whatever any period: its life, and the releases of its component that ran in
     * the hour before it opened, the latest of each environment. Fails with `IncidentNotFound` when
     * the project has no incident with that ID. Reads only: its updates, and the releases' spans.
     */
    readonly incident: (id: IncidentId) => Effect.Effect<IncidentDetail, IncidentNotFound>
    /**
     * Marks an incident as being looked at, with `incident.acknowledged`, which stops its
     * notifications. Again for one acknowledged, it keeps the first time. Fails with
     * `IncidentNotFound` when the project has no incident with that ID.
     */
    readonly acknowledge: (actor: Actor, id: IncidentId) => Effect.Effect<Incident, IncidentNotFound>
    /**
     * The project's monitors, oldest first, each with its last check and its last 90 days. Reads
     * only: a row a monitor and a day.
     */
    readonly monitors: Effect.Effect<MonitorList>
    /**
     * One monitor, whatever any period: how it is now, its days, its last 24 hours' checks by five
     * minutes, its latest failed checks and its incidents. Fails with `MonitorNotFound` when the
     * project has no monitor with that ID. Reads only: at most a day of its checks.
     */
    readonly monitor: (id: MonitorId) => Effect.Effect<MonitorDetail, MonitorNotFound>
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
      const apps = yield* AppSignals
      const projects = yield* Projects
      const crypto = yield* Crypto.Crypto
      const client = yield* HttpClient.HttpClient
      yield* migrateIncidents.pipe(Effect.orDie)

      const encodeEvidence = Schema.encodeEffect(Schema.fromJsonString(EvidenceSchema))
      const encodeCondition = Schema.encodeEffect(Schema.fromJsonString(MonitorCondition))

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
          SELECT m.id, m.component, m.environment, m.condition, m.level, m.added_at AS "addedAt", c.failures,
            c.problem, c.checked_at AS "checkedAt", c.status, c.ms, c.since, x.at AS "measuredAt", x.value
          FROM incidents_monitors m LEFT JOIN incidents_monitor_checks c ON c.monitor = m.id
            LEFT JOIN incidents_monitor_measures x ON x.monitor = m.id
          ORDER BY m.added_at, m.id`,
      })

      const findUpdates = SqlSchema.findAll({
        Request: IncidentId,
        Result: UpdateRow,
        execute: (incident) => sql`
          SELECT change, at, title FROM incidents_updates WHERE incident = ${incident}
          ORDER BY id DESC LIMIT ${updatesShown}`,
      })

      // Every monitor's days since `since`, a day number, oldest first.
      const findDays = SqlSchema.findAll({
        Request: Schema.Int,
        Result: DayRow,
        execute: (since) => sql`
          SELECT monitor, day, checks, failed, answered, total_ms AS "totalMs" FROM incidents_check_days
          WHERE day >= ${since} ORDER BY monitor, day`,
      })

      // A monitor's checks after `since`, by five minutes, oldest first.
      const findSteps = SqlSchema.findAll({
        Request: Schema.Struct({ monitor: MonitorId, since: Schema.Int }),
        Result: StepRow,
        execute: (asked) => sql`
          SELECT at - (at % ${recentStep}) AS start, COUNT(*) AS checks,
            SUM(CASE WHEN problem IS NULL THEN 0 ELSE 1 END) AS failed,
            COUNT(ms) AS answered, COALESCE(SUM(ms), 0) AS "totalMs", MAX(ms) AS "slowestMs"
          FROM incidents_check_history WHERE monitor = ${asked.monitor} AND at > ${asked.since}
          GROUP BY start ORDER BY start`,
      })

      const findFailures = SqlSchema.findAll({
        Request: MonitorId,
        Result: CheckRow,
        execute: (monitor) => sql`
          SELECT at, status, ms, problem FROM incidents_check_history
          WHERE monitor = ${monitor} AND problem IS NOT NULL ORDER BY at DESC LIMIT ${failuresShown}`,
      })

      // A monitor's incidents, the latest opened first: a URL's, those of its component and URL,
      // whichever monitor of them found them; one of counts, its own.
      const findMonitorIncidents = SqlSchema.findAll({
        Request: Schema.Struct({ id: MonitorId, component: ComponentKey, url: Schema.NullOr(Schema.String) }),
        Result: IncidentRow,
        execute: (monitor) =>
          monitor.url === null
            ? sql`
          SELECT ${incidentColumns} FROM incidents_incidents i LEFT JOIN incidents_firing f ON f.incident = i.id
          WHERE i.detector = 'monitor' AND json_extract(i.evidence, '$.monitor') = ${monitor.id}
          ORDER BY i.opened_at DESC LIMIT ${incidentsShown}`
            : sql`
          SELECT ${incidentColumns} FROM incidents_incidents i LEFT JOIN incidents_firing f ON f.incident = i.id
          WHERE i.detector = 'down' AND i.component = ${monitor.component} AND i.subject = ${monitor.url}
          ORDER BY i.opened_at DESC LIMIT ${incidentsShown}`,
      })

      // The latest incident of a monitor of counts resolved since `since`, which it firing so soon reopens.
      const findMonitorRecentlyResolved = SqlSchema.findOneOption({
        Request: Schema.Struct({ monitor: MonitorId, since: Schema.String }),
        Result: IncidentRow,
        execute: (key) => sql`
          SELECT ${incidentColumns} FROM incidents_incidents i LEFT JOIN incidents_firing f ON f.incident = i.id
          WHERE i.detector = 'monitor' AND json_extract(i.evidence, '$.monitor') = ${key.monitor}
            AND i.resolved_at >= ${key.since}
          ORDER BY i.resolved_at DESC LIMIT 1`,
      })

      // The SQL that adds a change to an incident's life.
      const updateOf = (incident: IncidentId, change: IncidentUpdate["change"], at: number, title?: string) =>
        sql`INSERT INTO incidents_updates ${sql.insert({ incident, at: iso(at), change, title: title ?? null })}`

      const findBaselines = SqlSchema.findAll({
        Request: Schema.Void,
        Result: BaselineRow,
        execute: () => sql`
          SELECT component, environment, operation, usual_rate AS "usualRate" FROM incidents_baselines`,
      })

      const findRhythms = SqlSchema.findAll({
        Request: Schema.Void,
        Result: RhythmRow,
        execute: () => sql`
          SELECT component, environment, operation, gap_ms AS "gapMs", last_ran_at AS "lastRanAt", quiet
          FROM incidents_rhythms`,
      })

      const findState = SqlSchema.findOneOption({
        Request: Schema.Void,
        Result: StateRow,
        execute: () => sql`SELECT learned_at AS "learnedAt", checked_at AS "checkedAt" FROM incidents_state`,
      })

      const newId = crypto.randomUUIDv7().pipe(Effect.orDie)

      // ---- Learning: each operation's usual error rate ------------------------------------------

      const learn = Effect.fn("Incidents.learn")(function* (now: number) {
        // Up to an hour before now: learned at most an hour ago, the usual never holds the 15
        // minutes being judged, so an operation failing from its start has a usual of none.
        const week = yield* signals.operations({ period: periodOf(now - Duration.toMillis(usualWindow), now - hour) })
        const rows = week.rows.map((row) => ({
          component: row.component,
          environment: row.environment ?? "",
          operation: row.operation,
          usual_rate: row.count === 0 ? 0 : row.errors / row.count,
        }))
        // How often each sparse operation usually runs, a guess: the two days first, so a rhythm
        // guessed there stands over one from the 6 hours.
        const guessed = new Map<
          string,
          {
            readonly component: ComponentKey
            readonly environment: string
            readonly operation: EnvelopeName
            readonly gap_ms: number
            readonly last_ran_at: number
          }
        >()
        for (const { window, atMost } of rhythmWindows) {
          const ran = yield* signals.minutesRan({ period: periodOf(now - Duration.toMillis(window), now) }, atMost)
          for (const entry of ran) {
            const minutes = entry.minutes.map(DateTime.toEpochMillis)
            const gap = usualGapOf(minutes)
            const last = minutes.at(-1)
            if (gap !== undefined && last !== undefined && !guessed.has(operationKeyOf(entry))) {
              guessed.set(operationKeyOf(entry), {
                component: entry.component,
                environment: entry.environment ?? "",
                operation: entry.operation,
                gap_ms: gap,
                last_ran_at: last,
              })
            }
          }
        }
        const rhythms = [...guessed.values()]
        yield* sql
          .withTransaction(
            Effect.gen(function* () {
              yield* sql`DELETE FROM incidents_baselines`
              for (let start = 0; start < rows.length; start += baselinesAtOnce) {
                yield* sql`INSERT INTO incidents_baselines ${sql.insert(rows.slice(start, start + baselinesAtOnce))}`
              }
              yield* sql`DELETE FROM incidents_rhythms`
              for (let start = 0; start < rhythms.length; start += rhythmsAtOnce) {
                yield* sql`INSERT INTO incidents_rhythms ${sql.insert(rhythms.slice(start, start + rhythmsAtOnce))}`
              }
              yield* sql`INSERT INTO incidents_state (id, learned_at) VALUES (1, ${now})
              ON CONFLICT (id) DO UPDATE SET learned_at = excluded.learned_at`
            }),
          )
          .pipe(Effect.orDie)
      })

      // Whether each operation past its quiet time ran since: then when it last did, else that it is
      // quiet. Writes only these hints, never an incident or activity.
      const confirmQuiet = Effect.fn("Incidents.confirmQuiet")(function* (now: number) {
        const rhythms = yield* findRhythms(undefined).pipe(Effect.orDie)
        for (const row of rhythms) {
          if (now < quietAt(row.lastRanAt, row.gapMs)) {
            continue
          }
          const since = yield* signals.minutesRan(
            {
              period: periodOf(row.lastRanAt + 60_000, now),
              component: row.component,
              operation: row.operation,
              ...(row.environment === "" ? {} : { environment: row.environment }),
            },
            Number.MAX_SAFE_INTEGER,
          )
          const latest = since.flatMap((ran) => ran.minutes.map(DateTime.toEpochMillis)).at(-1)
          yield* sql`UPDATE incidents_rhythms
            SET last_ran_at = ${latest ?? row.lastRanAt}, quiet = ${latest === undefined ? 1 : 0}
            WHERE component = ${row.component} AND environment = ${row.environment}
              AND operation = ${row.operation}`.pipe(Effect.orDie)
        }
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
                  alert: undefined,
                },
              ]
            : []
        })
      })

      // One check of a URL: the status and time of its answer, and what was wrong, absent when it
      // passed. The time is from sending the request to its status and headers.
      const checkUrl = (url: MonitorUrl): Effect.Effect<Checked> =>
        client.get(url).pipe(
          Effect.timed,
          Effect.map(([took, response]): Checked => ({
            status: response.status,
            ms: Duration.toMillis(took),
            problem: response.status < 400 ? undefined : `HTTP ${response.status}`,
          })),
          Effect.timeoutOption(checkTimeout),
          Effect.map(
            Option.getOrElse((): Checked => ({
              status: undefined,
              ms: undefined,
              problem: `No answer in ${Duration.toSeconds(checkTimeout)} s`,
            })),
          ),
          Effect.catchTag("HttpClientError", (error) =>
            Effect.succeed<Checked>({
              status: undefined,
              ms: undefined,
              problem: error.reason._tag === "TransportError" ? "Could not connect" : `Failed: ${error.reason._tag}`,
            }),
          ),
          Effect.provideService(HttpClient.TracerPropagationEnabled, false),
        )

      // Fetches every URL monitors fetch: the network part of a check, which stores nothing.
      const fetchMonitors = Effect.gen(function* () {
        const monitors = yield* findMonitors(undefined).pipe(Effect.orDie)
        return yield* Effect.forEach(
          monitors.flatMap((monitor) => {
            const url = urlOf(monitor)
            return url === undefined ? [] : [{ id: monitor.id, url }]
          }),
          (monitor) => checkUrl(monitor.url).pipe(Effect.map((check) => [monitor.id, check] as const)),
          { concurrency: checksAtOnce },
        )
      })

      // Stores the checks fetched and says which monitors are down, against the monitors as they
      // are now: one removed while its URL was fetched keeps nothing, and a monitor already checked
      // at this very millisecond isn't counted twice.
      const downNow = Effect.fn("Incidents.downNow")(function* (
        now: number,
        fetched: ReadonlyArray<readonly [MonitorId, Checked]>,
      ) {
        const monitors = new Map((yield* findMonitors(undefined)).map((row) => [row.id, row] as const))
        const firings: Array<Firing> = []
        for (const [id, check] of fetched) {
          const monitor = monitors.get(id)
          const url = monitor === undefined ? undefined : urlOf(monitor)
          if (monitor === undefined || url === undefined || monitor.checkedAt === now) {
            continue
          }
          const { problem } = check
          const failures = problem === undefined ? 0 : (monitor.failures ?? 0) + 1
          // Passing or failing as before keeps when that began; a first check, or a turn, starts it.
          const turned = monitor.failures === null || monitor.failures > 0 !== failures > 0
          const since = turned ? now : monitor.since
          const status = check.status ?? null
          const ms = check.ms ?? null
          yield* sql`INSERT INTO incidents_monitor_checks ${sql.insert({
            monitor: monitor.id,
            failures,
            problem: problem ?? null,
            checked_at: now,
            status,
            ms,
            since,
          })}
            ON CONFLICT (monitor) DO UPDATE SET failures = excluded.failures, problem = excluded.problem,
              checked_at = excluded.checked_at, status = excluded.status, ms = excluded.ms,
              since = excluded.since`
          yield* sql`INSERT INTO incidents_check_history ${sql.insert({
            monitor: monitor.id,
            at: now,
            status,
            ms,
            problem: problem ?? null,
          })} ON CONFLICT (monitor, at) DO NOTHING`
          const failed = problem === undefined ? 0 : 1
          const answered = ms === null ? 0 : 1
          yield* sql`INSERT INTO incidents_check_days ${sql.insert({
            monitor: monitor.id,
            day: dayNumberOf(now),
            checks: 1,
            failed,
            answered,
            total_ms: ms ?? 0,
          })}
            ON CONFLICT (monitor, day) DO UPDATE SET checks = checks + 1, failed = failed + ${failed},
              answered = answered + ${answered}, total_ms = total_ms + ${ms ?? 0}`
          if (problem !== undefined && failures >= downAfter) {
            firings.push({
              detector: "down",
              component: monitor.component,
              environment: undefined,
              subject: url,
              evidence: { _tag: "down", monitor: monitor.id, url, failures, problem },
              level: 0,
              alert: monitor.level,
            })
          }
        }
        return firings
      }, Effect.orDie)

      // What a monitor of counts reads over its window: how many ran or came, how many failed, and
      // the p95. One read, through an index, of the subject's counts: Signals' minute counts of one
      // operation, the warnings and errors of one error or log message, or one event's signals.
      const readCounts = Effect.fn("Incidents.readCounts")(function* (
        monitor: MonitorRow,
        condition: CountCondition,
        now: number,
      ) {
        const minutes = condition._tag === "nothingFor" ? condition.minutes : condition.minutes
        const period = periodOf(now - minutes * 60_000, now)
        const environment = monitor.environment === "" ? {} : { environment: monitor.environment }
        const place = { component: monitor.component, ...environment }
        const subject = condition.subject
        switch (subject._tag) {
          case "operation": {
            const table = yield* signals.operations({ period, ...place, operation: subject.operation })
            // Environments added up when the monitor names none; the p95 the highest of those that
            // ran at least 5 times, so one environment slow is seen.
            const judged = table.rows.filter((row) => row.count >= 5)
            return {
              count: table.rows.reduce((total, row) => total + row.count, 0),
              errors: table.rows.reduce((total, row) => total + row.errors, 0),
              // None when no environment ran 5 times: unknown, never 0.
              p95Ms: judged.length === 0 ? undefined : Math.max(...judged.map((row) => row.p95Ms)),
            }
          }
          case "event": {
            const atMost = condition._tag === "moreThan" ? condition.count + 1 : 1
            const count = yield* apps.eventCount({ period, ...place, event: subject.event }, atMost)
            return { count, errors: 0, p95Ms: undefined }
          }
          case "error":
          case "message": {
            const counts = yield* signals.logCounts({
              period,
              step: "1d",
              by: subject._tag,
              ...place,
              ...(subject._tag === "error" ? { error: subject.error } : { message: subject.message }),
            })
            return {
              count: counts.series.reduce((total, series) => total + series.total, 0),
              errors: 0,
              p95Ms: undefined,
            }
          }
        }
      })

      // What a monitor's subject is called, for its incident: an operation's or event's name, an
      // error's or log message's title, else its ID. Read only when it fires.
      const nameOf = Effect.fn("Incidents.nameOf")(function* (condition: CountCondition, now: number) {
        const subject = condition.subject
        const period = periodOf(now - Duration.toMillis(Duration.days(90)), now)
        switch (subject._tag) {
          case "operation":
            return subject.operation
          case "event":
            return subject.event
          case "error":
            return yield* signals.error(subject.error, { period }).pipe(
              Effect.map((detail) => detail.group.title),
              Effect.catchTag("ErrorGroupNotFound", () => Effect.succeed(`error ${subject.error}`)),
            )
          case "message":
            return yield* signals.logMessage(subject.message, { period }).pipe(
              Effect.map((detail) => detail.message.title),
              Effect.catchTag("LogMessageNotFound", () => Effect.succeed(`log message ${subject.message}`)),
            )
        }
      })

      // Measures every monitor of counts, keeps what each measured, and says which fire. A monitor
      // whose condition is "nothing for N" is first judged N after it was added.
      const countsNow = Effect.fn("Incidents.countsNow")(function* (now: number) {
        const monitors = yield* findMonitors(undefined)
        const firings: Array<Firing> = []
        for (const monitor of monitors) {
          const condition = monitor.condition
          if (condition._tag === "noAnswer") {
            continue
          }
          const added = DateTime.toEpochMillis(monitor.addedAt)
          if (condition._tag === "nothingFor" && now - added < condition.minutes * 60_000) {
            continue
          }
          const value = measuredOf(condition, yield* readCounts(monitor, condition, now))
          yield* sql`INSERT INTO incidents_monitor_measures ${sql.insert({ monitor: monitor.id, at: now, value: value ?? null })}
            ON CONFLICT (monitor) DO UPDATE SET at = excluded.at, value = excluded.value`
          if (value === undefined || !firesOn(condition, value)) {
            continue
          }
          const name = yield* nameOf(condition, now)
          firings.push({
            detector: "monitor",
            component: monitor.component,
            environment: monitor.environment === "" ? undefined : monitor.environment,
            subject: name,
            evidence: { _tag: "monitor", monitor: monitor.id, condition, value, name },
            level: 0,
            alert: monitor.level,
          })
        }
        return firings
      }, Effect.orDie)

      // Removes monitors' checks older than 7 days, and days older than 90.
      const cleanUp = (now: number) =>
        Effect.all(
          [
            sql`DELETE FROM incidents_check_history WHERE at < ${now - checksKept}`,
            sql`DELETE FROM incidents_check_days WHERE day < ${dayNumberOf(now) - daysShown + 1}`,
          ],
          { discard: true },
        ).pipe(Effect.orDie)

      // ---- An incident's life ---------------------------------------------------------------

      // The project's settings, which say what is production; the defaults before it exists.
      const settingsNow = projects.settings.pipe(
        Effect.catchTag("ProjectNotFound", () => Effect.succeed(defaultProjectSettings)),
      )

      const resolvedEntry = (row: IncidentRow, settings: ProjectSettings): ActivityEntry => ({
        payload: IncidentResolved.make({
          incident: row.id,
          detector: row.detector,
          component: row.component,
          subject: row.subject,
          title: row.title,
          ...placeOf(row.environment, settings),
          ...(row.acknowledgedAt === null ? {} : { acknowledged: true }),
        }),
      })

      // Opens, reopens, worsens, and resolves incidents from what the detectors see now: the SQL of
      // each change, the activity it emits, and what to tell people.
      const settle = Effect.fn("Incidents.settle")(function* (
        now: number,
        open: ReadonlyArray<IncidentRow>,
        firings: ReadonlyArray<Firing>,
        settings: ProjectSettings,
      ) {
        const openByKey = new Map(open.map((row) => [keyOf(row), row] as const))
        const firingKeys = new Set(firings.map(keyOf))
        const writes: Array<Effect.Effect<unknown, SqlError.SqlError>> = []
        const entries: Array<ActivityEntry> = []
        const changes: Array<IncidentChange> = []
        const record = (change: IncidentChange["change"], row: IncidentRow, alert?: AlertLevel) => {
          const fields = {
            incident: row.id,
            detector: row.detector,
            component: row.component,
            subject: row.subject,
            title: row.title,
            ...placeOf(row.environment, settings),
          }
          const level = alert === undefined ? {} : { level: alert }
          const acknowledged = row.acknowledgedAt === null ? {} : { acknowledged: true as const }
          if (change === "resolved") {
            entries.push({ payload: changeEntries.resolved.make({ ...fields, ...acknowledged }) })
          } else if (change === "worsened") {
            entries.push({ payload: changeEntries.worsened.make({ ...fields, ...acknowledged, ...level }) })
          } else {
            entries.push({ payload: changeEntries[change].make({ ...fields, ...level }) })
          }
          changes.push({ change, incident: incidentOf(row) })
          writes.push(updateOf(row.id, change, now, change === "resolved" ? undefined : row.title))
        }

        // The incident a firing so soon after it resolved reopens: its monitor's own, or its key's.
        const reopenable = (firing: Firing, since: string) =>
          firing.evidence._tag === "monitor"
            ? findMonitorRecentlyResolved({ monitor: firing.evidence.monitor, since })
            : findRecentlyResolved({
                detector: firing.detector,
                component: firing.component,
                environment: firing.environment ?? "",
                subject: firing.subject,
                since,
              })

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
              record("worsened", { ...current, title, evidence: firing.evidence, level: firing.level }, firing.alert)
            }
            continue
          }
          const environment = firing.environment ?? ""
          const since = iso(now - Duration.toMillis(reopenWithin))
          const recent = yield* reopenable(firing, since).pipe(Effect.orDie)
          if (Option.isSome(recent)) {
            const row = recent.value
            writes.push(
              sql`UPDATE incidents_incidents SET resolved_at = NULL, acknowledged_at = NULL, title = ${title},
                evidence = ${evidence}, level = ${firing.level} WHERE id = ${row.id}`,
              sql`INSERT INTO incidents_firing ${sql.insert({ incident: row.id, last_firing_at: now })}`,
            )
            record(
              "reopened",
              {
                ...row,
                title,
                evidence: firing.evidence,
                level: firing.level,
                resolvedAt: null,
                acknowledgedAt: null,
              },
              firing.alert,
            )
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
          record(
            "opened",
            {
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
            },
            firing.alert,
          )
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
          yield* cleanUp(now)
        }
        // The network first; then everything else at once in one transaction, from the monitors and
        // incidents as they are after it, so a monitor removed or an incident acknowledged meanwhile
        // is seen.
        const fetched = yield* fetchMonitors
        const settings = yield* settingsNow
        return yield* sql
          .withTransaction(
            Effect.gen(function* () {
              const baselines = yield* findBaselines(undefined).pipe(Effect.orDie)
              const firings = [
                ...(yield* downNow(now, fetched)),
                ...(yield* failingNow(now, baselines)),
                ...(yield* countsNow(now)),
              ]
              yield* confirmQuiet(now)
              const open = yield* findOpen(undefined).pipe(Effect.orDie)
              const changes = yield* settle(now, open, firings, settings)
              yield* sql`INSERT INTO incidents_state (id, checked_at) VALUES (1, ${now})
                ON CONFLICT (id) DO UPDATE SET checked_at = excluded.checked_at`
              return changes
            }),
          )
          .pipe(Effect.orDie)
      }).pipe(Effect.withSpan("Incidents.check"))

      // ---- Questions and actions ------------------------------------------------------------

      const incidents = Effect.gen(function* () {
        const now = DateTime.toEpochMillis(yield* DateTime.now)
        const open = yield* findOpen(undefined).pipe(Effect.orDie)
        const resolved = yield* findResolved(iso(now - resolvedShown)).pipe(Effect.orDie)
        const state = yield* findState(undefined).pipe(Effect.orDie)
        const checkedAt = Option.match(state, { onNone: () => null, onSome: (row) => row.checkedAt })
        const rhythms = yield* findRhythms(undefined).pipe(Effect.orDie)
        const list: IncidentList = {
          open: open.map(incidentOf),
          resolved: resolved.map(incidentOf),
          ...(checkedAt === null ? {} : { checkedAt: DateTime.makeUnsafe(checkedAt) }),
          quiet: rhythms
            .filter((row) => row.quiet === 1 && now >= quietAt(row.lastRanAt, row.gapMs))
            .toSorted((left, right) => left.lastRanAt - right.lastRanAt)
            .map((row): QuietOperation => ({
              component: row.component,
              ...(row.environment === "" ? {} : { environment: row.environment }),
              operation: row.operation,
              usualGapMs: row.gapMs,
              lastRanAt: DateTime.makeUnsafe(row.lastRanAt),
            })),
        }
        return list
      }).pipe(Effect.withSpan("Incidents.incidents"))

      const acknowledge = Effect.fn("Incidents.acknowledge")(function* (actor: Actor, id: IncidentId) {
        const settings = yield* settingsNow
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
            yield* updateOf(id, "acknowledged", DateTime.toEpochMillis(at)).pipe(Effect.orDie)
            return incidentOf({ ...row, acknowledgedAt: at })
          }),
          activity: (incident) => [
            {
              payload: IncidentAcknowledged.make({
                incident: incident.id,
                title: incident.title,
                detector: incident.evidence._tag,
                ...placeOf(incident.environment, settings),
              }),
            },
          ],
        })
      })

      // A monitor's open incident: a URL's, the down incident of its component and URL; one of
      // counts, its own.
      const openOf = (row: MonitorRow, open: ReadonlyArray<IncidentRow>) => {
        const url = urlOf(row)
        return open.find((incident) =>
          url === undefined
            ? incident.evidence._tag === "monitor" && incident.evidence.monitor === row.id
            : incident.detector === "down" && incident.component === row.component && incident.subject === url,
        )
      }

      const monitors = Effect.gen(function* () {
        const now = DateTime.toEpochMillis(yield* DateTime.now)
        const rows = yield* findMonitors(undefined).pipe(Effect.orDie)
        const days = yield* findDays(firstDayShown(now)).pipe(Effect.orDie)
        const open = yield* findOpen(undefined).pipe(Effect.orDie)
        const list: MonitorList = {
          monitors: rows.map((row) =>
            stateOf(
              row,
              days.filter((day) => day.monitor === row.id),
              openOf(row, open) !== undefined,
            ),
          ),
        }
        return list
      }).pipe(Effect.withSpan("Incidents.monitors"))

      const monitorDetail = Effect.fn("Incidents.monitor")(function* (id: MonitorId) {
        const now = DateTime.toEpochMillis(yield* DateTime.now)
        const row = (yield* findMonitors(undefined).pipe(Effect.orDie)).find((found) => found.id === id)
        if (row === undefined) {
          return yield* new MonitorNotFound({ monitor: id })
        }
        const days = yield* findDays(firstDayShown(now)).pipe(Effect.orDie)
        const steps = yield* findSteps({ monitor: id, since: now - recentShown }).pipe(Effect.orDie)
        const failures = yield* findFailures(id).pipe(Effect.orDie)
        const found = yield* findMonitorIncidents({ id, component: row.component, url: urlOf(row) ?? null }).pipe(
          Effect.orDie,
        )
        const detail: MonitorDetail = {
          state: stateOf(
            row,
            days.filter((day) => day.monitor === id),
            found.some((incident) => incident.resolvedAt === null),
          ),
          recent: steps.map((step): MonitorStep => ({
            start: DateTime.makeUnsafe(step.start),
            checks: step.checks,
            failed: step.failed,
            ...(step.answered === 0 ? {} : { averageMs: step.totalMs / step.answered }),
            ...(step.slowestMs === null ? {} : { slowestMs: step.slowestMs }),
          })),
          failures: failures.map(checkOf),
          incidents: found.map(incidentOf),
        }
        return detail
      })

      // The releases of an incident's component that ran in the hour before it opened, the one that
      // ran last before it opened in each environment: in its own, or, for a monitor's, in each. Not
      // the release first seen latest: after a rollback, the older release is the one that ran.
      const releasesOf = Effect.fn("Incidents.releasesOf")(function* (row: IncidentRow) {
        const opened = DateTime.toEpochMillis(row.openedAt)
        const period = periodOf(opened - releasesBefore, opened + 1)
        const table = yield* signals.releases({
          period,
          component: row.component,
          ...(row.environment === "" ? {} : { environment: row.environment }),
        })
        const latest = new Map<string, { readonly ran: IncidentRelease; readonly at: number }>()
        for (const ran of table.rows) {
          const place = ran.environment ?? ""
          // A down incident, or a monitor's that names no environment, is about every environment;
          // a failing or stopped one without an environment is about operations that named none.
          const everyEnvironment = row.detector === "down" || (row.detector === "monitor" && row.environment === "")
          if (!everyEnvironment && place !== row.environment) {
            continue
          }
          // When it last ran before the incident opened: its last step of the counts, by the minute
          // while they are kept, by the hour after.
          const load = yield* signals.loadOverTime(
            {
              period,
              component: row.component,
              release: ran.release,
              ...(ran.environment === undefined ? {} : { environment: ran.environment }),
            },
            "1m",
          )
          const at = load.points.map((point) => DateTime.toEpochMillis(point.start)).at(-1)
          const earlier = latest.get(place)
          if (at === undefined || (earlier !== undefined && earlier.at >= at)) {
            continue
          }
          latest.set(place, {
            ran: { ...(ran.environment === undefined ? {} : { environment: ran.environment }), release: ran.release },
            at,
          })
        }
        return [...latest.values()].map((found) => found.ran)
      })

      const incidentDetail = Effect.fn("Incidents.incident")(function* (id: IncidentId) {
        const found = yield* findIncident(id).pipe(Effect.orDie)
        if (Option.isNone(found)) {
          return yield* new IncidentNotFound({ incident: id })
        }
        const updates = yield* findUpdates(id).pipe(Effect.orDie)
        const detail: IncidentDetail = {
          incident: incidentOf(found.value),
          updates: updates.toReversed().map((update): IncidentUpdate => ({
            change: update.change,
            at: update.at,
            ...(update.title === null ? {} : { title: update.title }),
          })),
          releases: yield* releasesOf(found.value),
        }
        return detail
      })

      // The project and the monitor's ID are settled before the transaction, which holds only SQL.
      const addMonitor = Effect.fn("Incidents.addMonitor")(function* (actor: Actor, input: AddMonitor) {
        const components = yield* projects.components
        if (!components.some((component) => component.key === input.component)) {
          return yield* new ComponentNotFound({ component: input.component })
        }
        const id = MonitorId.make(yield* newId)
        const condition = yield* encodeCondition(input.condition).pipe(Effect.orDie)
        return yield* log.commit({
          source,
          actor,
          write: Effect.gen(function* () {
            const environment = input.environment ?? ""
            const existing = yield* findMonitors(undefined).pipe(Effect.orDie)
            // The same condition encodes to the same JSON, which the table keeps unique.
            const same = yield* sql<{ readonly id: MonitorId }>`SELECT id FROM incidents_monitors
              WHERE component = ${input.component} AND environment = ${environment} AND condition = ${condition}`.pipe(
              Effect.orDie,
            )
            const [first] = same
            if (first !== undefined) {
              return yield* new MonitorExists({ monitor: first.id })
            }
            if (existing.length >= monitorLimit) {
              return yield* new MonitorLimitReached({ limit: monitorLimit })
            }
            const addedAt = yield* DateTime.now
            yield* sql`INSERT INTO incidents_monitors ${sql.insert({
              id,
              component: input.component,
              environment,
              condition,
              level: input.level,
              added_at: DateTime.formatIso(addedAt),
            })}`.pipe(Effect.orDie)
            return new Monitor({
              id,
              component: input.component,
              ...(input.environment === undefined ? {} : { environment: input.environment }),
              condition: input.condition,
              level: input.level,
              addedAt,
            })
          }),
          activity: (monitor) => [
            {
              payload: MonitorAdded.make({
                monitor: monitor.id,
                component: monitor.component,
                ...(monitor.environment === undefined ? {} : { environment: monitor.environment }),
                condition: monitor.condition,
                level: monitor.level,
              }),
            },
          ],
        })
      })

      const removeMonitor = Effect.fn("Incidents.removeMonitor")(function* (actor: Actor, id: MonitorId) {
        const now = DateTime.toEpochMillis(yield* DateTime.now)
        const settings = yield* settingsNow
        yield* log.commit({
          source,
          actor,
          write: Effect.gen(function* () {
            const monitor = (yield* findMonitors(undefined).pipe(Effect.orDie)).find((row) => row.id === id)
            if (monitor === undefined) {
              return yield* new MonitorNotFound({ monitor: id })
            }
            const down = openOf(monitor, yield* findOpen(undefined).pipe(Effect.orDie))
            if (down !== undefined) {
              yield* sql`UPDATE incidents_incidents SET resolved_at = ${iso(now)} WHERE id = ${down.id}`.pipe(
                Effect.orDie,
              )
              yield* sql`DELETE FROM incidents_firing WHERE incident = ${down.id}`.pipe(Effect.orDie)
              yield* updateOf(down.id, "resolved", now).pipe(Effect.orDie)
            }
            yield* sql`DELETE FROM incidents_monitor_checks WHERE monitor = ${id}`.pipe(Effect.orDie)
            yield* sql`DELETE FROM incidents_monitor_measures WHERE monitor = ${id}`.pipe(Effect.orDie)
            yield* sql`DELETE FROM incidents_check_history WHERE monitor = ${id}`.pipe(Effect.orDie)
            yield* sql`DELETE FROM incidents_check_days WHERE monitor = ${id}`.pipe(Effect.orDie)
            yield* sql`DELETE FROM incidents_monitors WHERE id = ${id}`.pipe(Effect.orDie)
            return down
          }),
          activity: (down) =>
            down === undefined
              ? [{ payload: MonitorRemoved.make({ monitor: id }) }]
              : [{ payload: MonitorRemoved.make({ monitor: id }) }, resolvedEntry(down, settings)],
        })
      })

      return {
        check,
        incidents,
        incident: incidentDetail,
        acknowledge,
        monitors,
        monitor: monitorDetail,
        addMonitor,
        removeMonitor,
      }
    }),
  )
}
