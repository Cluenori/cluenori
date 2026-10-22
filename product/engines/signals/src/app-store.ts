import type { QuantileSketch as Sketch } from "@bagatka/quantile-sketch"
import { countOf, mergeSketches, Quantile, QuantileSketch, quantileOf, sketchOf } from "@bagatka/quantile-sketch"
import {
  calendarDayOfNumber,
  ComponentKey,
  InstallationId,
  dayNumberOf,
  dayStartMillis,
  EnvironmentKey,
  FeatureKey,
  Period,
  PersonId,
  ReleaseVersion,
} from "@cluenori/foundation"
import { DateTime, Duration, Effect, Option, Schema } from "effect"
import { SqlClient, SqlSchema } from "effect/sql"

import type { AppBatch, AppSignal } from "./app-batch.ts"
import { AppDevice, AppSdk, AppUserId } from "./app-batch.ts"
import type {
  AppHealth,
  AppPerson,
  AppQuery,
  AppRelease,
  AppReleaseKey,
  AppReleaseList,
  AppReleaseQuery,
  AppRetention,
  AppUsage,
  CountryCode,
  FeatureUse,
  FeatureUseTable,
  LaunchTimes,
  MemoryUse,
  PersonLookup,
  RetentionCohort,
  RetentionQuery,
  UsageDay,
} from "./app-queries.ts"
import { CountryCode as CountryCodeSchema, PersonNotFound, TimelineEntry } from "./app-queries.ts"
import type { PersonSignal, Tallies } from "./app-tallies.ts"

/** How long what is counted by day is kept: 15 months, so a year compares with the one before. */
export const appDayRetention = Duration.days(455)

// A session is kept 90 days; a signal's ID 14 days by its own time, which is how long a batch sent
// again is still counted once; a person's timeline its latest 1,000 signals.
const sessionRetention = Duration.days(90)
const seenRetention = Duration.days(14)
const timelineKept = 1000
const daysShown = 90
const installationsShown = 50

// Durable Objects take at most 100 parameters in one statement.
const parametersAtOnce = 100

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const Total = Schema.NullOr(Schema.Finite)
const DeviceJson = Schema.fromJsonString(AppDevice)
const SdkJson = Schema.fromJsonString(AppSdk)
const EntryJson = Schema.fromJsonString(TimelineEntry)
const SketchJson = Schema.fromJsonString(QuantileSketch)
const p50 = Quantile.make(0.5)
const p95 = Quantile.make(0.95)

const chunksOf = <A>(items: ReadonlyArray<A>, size: number): ReadonlyArray<ReadonlyArray<A>> =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size))

// The lowest UUIDv7 made at `millis`, as text: IDs made before it sort before it.
const firstIdAt = (millis: number) => {
  const hex = Math.max(0, Math.floor(millis)).toString(16).padStart(12, "0")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}`
}

const quantile = (sketch: Sketch, which: Quantile) =>
  Option.match(quantileOf(sketch, which), {
    onNone: () => Effect.die("A measure with values has no quantile"),
    onSome: Effect.succeed,
  })

/** Who a batch's signals are of: the installation's person now, those of user IDs, and those to add. */
export interface PeoplePlan {
  /** Each new signal's person, in the batch's order. */
  readonly signals: ReadonlyArray<PersonSignal>
  /** The person the installation is of after the batch. */
  readonly installationPerson: PersonId
  /** People to add. */
  readonly newPeople: ReadonlyArray<PersonId>
  /** User IDs to link, each to its person. */
  readonly newUsers: ReadonlyArray<{ readonly user: AppUserId; readonly person: PersonId }>
}

/** Where a batch came from: its component and country, and the batch itself. */
export interface BatchSource {
  readonly component: ComponentKey
  readonly country: CountryCode | undefined
  readonly batch: AppBatch
}

// Weeks are numbered from 1970-01-01, a Thursday, so each starts on a Monday: day 4 is week 1's first.
const weekOf = (day: number) => Math.floor((day + 3) / 7)
const weekStart = (week: number) => calendarDayOfNumber(week * 7 - 3)

// The days a period covers, cut to what is kept and to today: [from, to] as day numbers.
const daysOf = (period: Period, now: number) => {
  const today = dayNumberOf(now)
  const keptFrom = today - Duration.toDays(appDayRetention) + 1
  return {
    from: Math.max(dayNumberOf(DateTime.toEpochMillis(period.from)), keptFrom),
    to: Math.min(dayNumberOf(DateTime.toEpochMillis(period.to) - 1), today),
    keptFrom,
  }
}

/**
 * Apps' signals in the project's database: people and the user IDs linked to them, installations,
 * what is counted by day, sessions, timelines, and the IDs of signals seen lately; and the questions
 * asked of them. Part of Signals, which owns the transaction each write runs in.
 */
export const appStore = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const encodeSketch = Schema.encodeEffect(SketchJson)
  // Sketches merged, as stored; none for a measure only counted, such as a prewarmed launch.
  const sketchJsonOf = (sketches: ReadonlyArray<Sketch>) =>
    sketches.length === 0 ? Effect.succeed(null) : encodeSketch(mergeSketches(sketches))
  const encodeEntry = Schema.encodeEffect(EntryJson)
  const encodeDevice = Schema.encodeEffect(DeviceJson)
  const encodeSdk = Schema.encodeEffect(SdkJson)

  // Filters by scope, of the columns every table by day has.
  const scopeOf = (query: {
    readonly component?: ComponentKey | undefined
    readonly environment?: EnvironmentKey | undefined
    readonly release?: ReleaseVersion | undefined
  }) => [
    ...(query.component === undefined ? [] : [sql`component = ${query.component}`]),
    ...(query.environment === undefined ? [] : [sql`environment = ${query.environment}`]),
    ...(query.release === undefined ? [] : [sql`release = ${query.release}`]),
  ]

  const findSeen = SqlSchema.findAll({
    Request: Schema.Array(Schema.String),
    Result: Schema.Struct({ signal: Schema.String }),
    execute: (ids) => sql`SELECT signal FROM signals_app_seen WHERE signal IN ${sql.in(ids)}`,
  })

  /** The IDs among `ids` seen before. Reads at most 100 at a time. */
  const seenOf = Effect.fn("AppStore.seenOf")(function* (ids: ReadonlyArray<string>) {
    const seen = new Set<string>()
    for (const chunk of chunksOf(ids, parametersAtOnce)) {
      const rows = yield* findSeen(chunk)
      for (const row of rows) {
        seen.add(row.signal)
      }
    }
    return seen
  }, Effect.orDie)

  const findInstallationPerson = SqlSchema.findOneOption({
    Request: Schema.String,
    Result: Schema.Struct({ person: PersonId, linked: Schema.BooleanFromBit }),
    execute: (installation) => sql`
      SELECT p.person, EXISTS (SELECT 1 FROM signals_person_users u WHERE u.person = i.person) AS linked
      FROM signals_installations i JOIN signals_people p ON p.id = i.person
      WHERE i.installation = ${installation}`,
  })

  const findUsers = SqlSchema.findAll({
    Request: Schema.Array(Schema.String),
    Result: Schema.Struct({ user: AppUserId, person: PersonId }),
    execute: (users) => sql`
      SELECT u.user, p.person FROM signals_person_users u JOIN signals_people p ON p.id = u.person
      WHERE u.user IN ${sql.in(users)}`,
  })

  /**
   * Who each of `signals` is of. A signal with a user ID is of the person linked to it; a user ID
   * seen for the first time links to the installation's person if that person has none yet, so the
   * history before signing in stays theirs, or else to a new person. A signal without one is of the
   * installation's person: the last one signed in on it, or a person of its own. New people take their
   * IDs from `candidates`, in order. Reads only.
   */
  const peopleOf = Effect.fn("AppStore.peopleOf")(function* (
    installation: InstallationId,
    signals: ReadonlyArray<AppSignal>,
    candidates: ReadonlyArray<PersonId>,
  ) {
    const found = yield* findInstallationPerson(installation)
    const userIds = [
      ...new Set(
        signals.flatMap((signal) => (signal._tag !== "metrickit" && signal.user !== undefined ? [signal.user] : [])),
      ),
    ]
    const users = new Map<string, { readonly person: PersonId; readonly linked: boolean }>()
    for (const chunk of chunksOf(userIds, parametersAtOnce)) {
      const rows = yield* findUsers(chunk)
      for (const row of rows) {
        users.set(row.user, { person: row.person, linked: true })
      }
    }
    const unused = [...candidates]
    const nextPerson = () => {
      const person = unused.shift()
      return person === undefined
        ? Effect.die("Fewer people's IDs were made than the batch needs")
        : Effect.succeed(person)
    }
    const newPeople: Array<PersonId> = []
    const newUsers: Array<{ readonly user: AppUserId; readonly person: PersonId }> = []
    // The installation's person as the batch goes on: whether a user ID is linked to them yet.
    let current = Option.getOrUndefined(found)
    const planned: Array<PersonSignal> = []
    for (const signal of signals) {
      const user = signal._tag === "metrickit" ? undefined : signal.user
      if (user !== undefined) {
        const known = users.get(user)
        if (known !== undefined) {
          current = known
        } else if (current !== undefined && !current.linked) {
          current = { person: current.person, linked: true }
          users.set(user, current)
          newUsers.push({ user, person: current.person })
        } else {
          const person = yield* nextPerson()
          newPeople.push(person)
          current = { person, linked: true }
          users.set(user, current)
          newUsers.push({ user, person })
        }
      } else if (current === undefined) {
        const person = yield* nextPerson()
        newPeople.push(person)
        current = { person, linked: false }
      }
      planned.push({ person: current.person, signal })
    }
    if (current === undefined) {
      return yield* Effect.die("A batch with signals left its installation without a person")
    }
    const plan: PeoplePlan = { signals: planned, installationPerson: current.person, newPeople, newUsers }
    return plan
  }, Effect.orDie)

  const findPersonRows = SqlSchema.findAll({
    Request: Schema.Array(Schema.String),
    Result: Schema.Struct({ id: Schema.Int, person: PersonId }),
    execute: (people) => sql`SELECT id, person FROM signals_people WHERE person IN ${sql.in(people)}`,
  })

  const findInstallationRow = SqlSchema.findOne({
    Request: Schema.String,
    Result: Schema.Struct({ id: Schema.Int }),
    execute: (installation) => sql`SELECT id FROM signals_installations WHERE installation = ${installation}`,
  })

  const findSketch = SqlSchema.findOneOption({
    Request: Schema.Struct({
      day: Schema.Int,
      component: Schema.String,
      environment: Schema.String,
      release: Schema.String,
      feature: Schema.String,
      measure: Schema.String,
    }),
    Result: Schema.Struct({ sketch: Schema.NullOr(SketchJson) }),
    execute: (key) => sql`
      SELECT sketch FROM signals_app_measures
      WHERE day = ${key.day} AND component = ${key.component} AND environment = ${key.environment}
        AND release = ${key.release} AND feature = ${key.feature} AND measure = ${key.measure}`,
  })

  /**
   * Writes a batch's new signals, as `plan` assigns them to people and `tallies` adds them up.
   * Runs inside the caller's transaction.
   */
  const write = Effect.fn("AppStore.write")(function* (source: BatchSource, plan: PeoplePlan, tallies: Tallies) {
    const { component, batch } = source
    const { environment, release } = batch
    for (const { signal } of plan.signals) {
      yield* sql`INSERT INTO signals_app_seen (signal) VALUES (${signal.id}) ON CONFLICT DO NOTHING`
    }
    // People, first: their row numbers are what the tables by day hold.
    for (const [person, seen] of tallies.people) {
      yield* sql`
        INSERT INTO signals_people ${sql.insert({ person, first_seen: seen.first, last_seen: seen.last })}
        ON CONFLICT (person) DO UPDATE SET
          first_seen = min(first_seen, excluded.first_seen),
          last_seen = max(last_seen, excluded.last_seen)`
    }
    const rows = new Map<string, number>()
    for (const chunk of chunksOf([...tallies.people.keys()], parametersAtOnce)) {
      const found = yield* findPersonRows(chunk)
      for (const row of found) {
        rows.set(row.person, row.id)
      }
    }
    const rowOf = (person: PersonId) => {
      const row = rows.get(person)
      return row === undefined ? Effect.die(`A person of the batch has no row, ${person}`) : Effect.succeed(row)
    }
    for (const { user, person } of plan.newUsers) {
      const row = yield* rowOf(person)
      yield* sql`INSERT INTO signals_person_users ${sql.insert({ user, person: row })} ON CONFLICT (user) DO NOTHING`
    }
    // The installation, as of its latest batch: one sent late, from a buffer, changes only when it was
    // last seen.
    const installationPerson = yield* rowOf(plan.installationPerson)
    const device = yield* encodeDevice(batch.device)
    const sdk = yield* encodeSdk(batch.sdk)
    yield* sql`
      INSERT INTO signals_installations ${sql.insert({
        installation: batch.installation,
        person: installationPerson,
        component,
        environment,
        release,
        device,
        sdk,
        country: source.country ?? null,
        first_seen: tallies.span.first,
        last_seen: tallies.span.last,
      })}
      ON CONFLICT (installation) DO UPDATE SET
        person = CASE WHEN excluded.last_seen >= last_seen THEN excluded.person ELSE person END,
        component = excluded.component,
        environment = CASE WHEN excluded.last_seen >= last_seen THEN excluded.environment ELSE environment END,
        release = CASE WHEN excluded.last_seen >= last_seen THEN excluded.release ELSE release END,
        device = CASE WHEN excluded.last_seen >= last_seen THEN excluded.device ELSE device END,
        sdk = CASE WHEN excluded.last_seen >= last_seen THEN excluded.sdk ELSE sdk END,
        country = CASE WHEN excluded.last_seen >= last_seen THEN coalesce(excluded.country, country) ELSE country END,
        first_seen = min(first_seen, excluded.first_seen),
        last_seen = max(last_seen, excluded.last_seen)`
    const { id: installation } = yield* findInstallationRow(batch.installation)
    yield* sql`
      INSERT INTO signals_app_releases ${sql.insert({
        component,
        environment,
        release,
        first_seen: tallies.span.first,
        last_seen: tallies.span.last,
      })}
      ON CONFLICT (component, environment, release) DO UPDATE SET
        first_seen = min(first_seen, excluded.first_seen),
        last_seen = max(last_seen, excluded.last_seen)`
    for (const [person, seen] of tallies.people) {
      const row = yield* rowOf(person)
      yield* sql`
        INSERT INTO signals_app_first_days ${sql.insert({ component, environment, person: row, day: dayNumberOf(seen.first) })}
        ON CONFLICT (component, environment, person) DO UPDATE SET day = min(day, excluded.day)`
    }
    for (const tally of tallies.days) {
      const person = yield* rowOf(tally.person)
      yield* sql`
        INSERT INTO signals_app_days ${sql.insert({
          day: tally.day,
          component,
          environment,
          release,
          installation,
          person,
          sessions: tally.sessions,
          foreground_ms: tally.foregroundMs,
        })}
        ON CONFLICT (day, component, environment, release, installation, person) DO UPDATE SET
          sessions = sessions + excluded.sessions,
          foreground_ms = foreground_ms + excluded.foreground_ms`
    }
    for (const tally of tallies.features) {
      const person = yield* rowOf(tally.person)
      yield* sql`
        INSERT INTO signals_app_feature_days ${sql.insert({
          day: tally.day,
          component,
          environment,
          release,
          feature: tally.feature,
          person,
          events: tally.events,
          screens: tally.screens,
        })}
        ON CONFLICT (day, component, environment, release, feature, person) DO UPDATE SET
          events = events + excluded.events,
          screens = screens + excluded.screens`
    }
    for (const tally of tallies.measures) {
      const key = { day: tally.day, component, environment, release, feature: tally.feature, measure: tally.measure }
      const stored = yield* findSketch(key)
      const sketches = [
        ...(Option.isSome(stored) && stored.value.sketch !== null ? [stored.value.sketch] : []),
        ...(tally.values.length === 0 ? [] : [sketchOf(tally.values)]),
      ]
      const sketch = yield* sketchJsonOf(sketches)
      yield* sql`
        INSERT INTO signals_app_measures ${sql.insert({ ...key, count: tally.count, sketch })}
        ON CONFLICT (day, component, environment, release, feature, measure) DO UPDATE SET
          count = count + excluded.count,
          sketch = excluded.sketch`
    }
    for (const tally of tallies.diagnostics) {
      yield* sql`
        INSERT INTO signals_app_diagnostics ${sql.insert({
          day: tally.day,
          component,
          environment,
          release: tally.release,
          kind: tally.kind,
          count: tally.count,
        })}
        ON CONFLICT (day, component, environment, release, kind) DO UPDATE SET count = count + excluded.count`
    }
    for (const session of tallies.sessions) {
      const person = yield* rowOf(session.person)
      yield* sql`
        INSERT INTO signals_app_sessions ${sql.insert({
          session: session.session,
          installation,
          person,
          component,
          environment,
          release,
          started_at: session.startedAt ?? null,
          ended_at: session.endedAt ?? null,
          foreground_ms: session.foregroundMs ?? null,
          seen_at: session.seenAt,
        })}
        ON CONFLICT (session) DO UPDATE SET
          started_at = coalesce(excluded.started_at, started_at),
          ended_at = coalesce(excluded.ended_at, ended_at),
          foreground_ms = coalesce(excluded.foreground_ms, foreground_ms),
          seen_at = min(seen_at, excluded.seen_at)`
    }
    const trimmed = new Set<number>()
    for (const entry of tallies.timeline) {
      const person = yield* rowOf(entry.person)
      const json = yield* encodeEntry({
        component,
        environment,
        release,
        installation: batch.installation,
        signal: entry.signal,
      })
      yield* sql`
        INSERT INTO signals_app_timeline ${sql.insert({ person, at: entry.at, signal: entry.signal.id, entry: json })}
        ON CONFLICT DO NOTHING`
      trimmed.add(person)
    }
    // Each person keeps their latest 1,000 signals; signals at the same moment as the 1,000th stay too.
    for (const person of trimmed) {
      yield* sql`
        DELETE FROM signals_app_timeline WHERE person = ${person} AND at < (
          SELECT at FROM signals_app_timeline WHERE person = ${person} ORDER BY at DESC LIMIT 1 OFFSET ${timelineKept - 1})`
    }
  })

  /** Removes what is older than it is kept. Runs inside the caller's transaction. */
  const cleanUp = Effect.fn("AppStore.cleanUp")(function* (now: number) {
    const day = dayNumberOf(now - Duration.toMillis(appDayRetention))
    for (const table of [
      "signals_app_days",
      "signals_app_feature_days",
      "signals_app_measures",
      "signals_app_diagnostics",
    ]) {
      yield* sql`DELETE FROM ${sql(table)} WHERE day < ${day}`
    }
    yield* sql`DELETE FROM signals_app_releases WHERE last_seen < ${now - Duration.toMillis(appDayRetention)}`
    yield* sql`DELETE FROM signals_app_timeline WHERE at < ${now - Duration.toMillis(appDayRetention)}`
    yield* sql`DELETE FROM signals_app_sessions WHERE seen_at < ${now - Duration.toMillis(sessionRetention)}`
    yield* sql`DELETE FROM signals_app_seen WHERE signal < ${firstIdAt(now - Duration.toMillis(seenRetention))}`
  })

  // --- Usage ---

  // The first day a component and environment sent anything, of those kept; with neither, the project.
  const findFirstDay = (query: AppQuery) => {
    const scope = scopeOf({ component: query.component, environment: query.environment })
    return SqlSchema.findOne({
      Request: Schema.Void,
      Result: Schema.Struct({ first: Schema.NullOr(Schema.Int) }),
      execute: () => sql`
        SELECT min(day) AS first FROM signals_app_days ${scope.length === 0 ? sql`` : sql`WHERE ${sql.and(scope)}`}`,
    })(undefined)
  }

  const DayRow = Schema.Struct({
    day: Schema.Int,
    people: Count,
    installations: Count,
    sessions: Count,
    foregroundMs: Schema.Finite,
  })

  const WindowRow = Schema.Struct({ day: Schema.Int, week: Count, month: Count })

  const TotalsRow = Schema.Struct({
    people: Count,
    installations: Count,
    sessions: Total,
    personDays: Count,
  })

  const ReleaseUsageRow = Schema.Struct({
    component: ComponentKey,
    environment: EnvironmentKey,
    release: ReleaseVersion,
    people: Count,
    installations: Count,
    sessions: Count,
  })

  /** Usage over `query`'s period, by day, at `now`. */
  const usage = Effect.fn("AppStore.usage")(function* (query: AppQuery, now: number) {
    const days = daysOf(query.period, now)
    const scope = scopeOf(query)
    const first = yield* findFirstDay(query)
    const countedFrom = first.first === null ? undefined : Math.max(first.first, days.keptFrom)
    const from = countedFrom === undefined ? days.from : Math.max(days.from, countedFrom)
    const nothing: AppUsage = { days: [], people: 0, installations: 0, sessions: 0, releases: [] }
    if (countedFrom === undefined || from > days.to) {
      return nothing
    }
    const inDays = [sql`day >= ${from}`, sql`day <= ${days.to}`, ...scope]
    const daily = yield* SqlSchema.findAll({
      Request: Schema.Void,
      Result: DayRow,
      execute: () => sql`
        SELECT day, count(DISTINCT person) AS people, count(DISTINCT installation) AS installations,
          sum(sessions) AS sessions, sum(foreground_ms) AS "foregroundMs"
        FROM signals_app_days WHERE ${sql.and(inDays)} GROUP BY day`,
    })(undefined)
    // Each day's people over the 7 and the 30 days ending with it, counted exactly.
    const windows = yield* SqlSchema.findAll({
      Request: Schema.Void,
      Result: WindowRow,
      execute: () => sql`
        WITH RECURSIVE asked(day) AS (SELECT ${from} UNION ALL SELECT day + 1 FROM asked WHERE day < ${days.to})
        SELECT asked.day,
          (SELECT count(DISTINCT person) FROM signals_app_days
            WHERE ${sql.and([sql`day > asked.day - 7`, sql`day <= asked.day`, ...scope])}) AS week,
          (SELECT count(DISTINCT person) FROM signals_app_days
            WHERE ${sql.and([sql`day > asked.day - 30`, sql`day <= asked.day`, ...scope])}) AS month
        FROM asked`,
    })(undefined)
    const totals = yield* SqlSchema.findOne({
      Request: Schema.Void,
      Result: TotalsRow,
      execute: () => sql`
        SELECT count(DISTINCT person) AS people, count(DISTINCT installation) AS installations,
          sum(sessions) AS sessions,
          (SELECT count(*) FROM (SELECT DISTINCT day, person FROM signals_app_days WHERE ${sql.and(inDays)})) AS "personDays"
        FROM signals_app_days WHERE ${sql.and(inDays)}`,
    })(undefined)
    const releases = yield* SqlSchema.findAll({
      Request: Schema.Void,
      Result: ReleaseUsageRow,
      execute: () => sql`
        SELECT component, environment, release, count(DISTINCT person) AS people,
          count(DISTINCT installation) AS installations, sum(sessions) AS sessions
        FROM signals_app_days WHERE ${sql.and(inDays)}
        GROUP BY component, environment, release ORDER BY people DESC, component, environment, release`,
    })(undefined)
    const byDay = new Map(daily.map((row) => [row.day, row] as const))
    const usageDays = windows.map((window): UsageDay => {
      const counted = byDay.get(window.day)
      return {
        day: calendarDayOfNumber(window.day),
        people: counted?.people ?? 0,
        installations: counted?.installations ?? 0,
        ...(window.day - 6 >= countedFrom ? { weekPeople: window.week } : {}),
        ...(window.day - 29 >= countedFrom ? { monthPeople: window.month } : {}),
        sessions: counted?.sessions ?? 0,
        foregroundMs: counted?.foregroundMs ?? 0,
      }
    })
    const sessions = totals.sessions ?? 0
    const coveredFrom = Math.max(DateTime.toEpochMillis(query.period.from), dayStartMillis(from))
    const coveredTo = Math.min(DateTime.toEpochMillis(query.period.to), now)
    const answer: AppUsage = {
      ...(coveredFrom < coveredTo
        ? { covered: new Period({ from: DateTime.makeUnsafe(coveredFrom), to: DateTime.makeUnsafe(coveredTo) }) }
        : {}),
      days: usageDays,
      people: totals.people,
      installations: totals.installations,
      sessions,
      ...(totals.people === 0 ? {} : { sessionsPerPerson: sessions / totals.people }),
      ...(totals.personDays === 0 ? {} : { sessionsPerPersonDay: sessions / totals.personDays }),
      releases,
    }
    return answer
  }, Effect.orDie)

  // --- Retention ---

  const CohortRow = Schema.Struct({ cohort: Schema.Int, people: Count })
  const ActiveRow = Schema.Struct({ cohort: Schema.Int, weeksAfter: Schema.Int, people: Count })

  /** Weekly cohorts of people first seen in the query's period, at `now`. */
  const retention = Effect.fn("AppStore.retention")(function* (query: RetentionQuery, now: number) {
    const days = daysOf(query.period, now)
    const scope = scopeOf(query)
    const currentWeek = weekOf(dayNumberOf(now))
    const firsts = sql`
      SELECT person, min(day) AS first FROM signals_app_first_days
      ${scope.length === 0 ? sql`` : sql`WHERE ${sql.and(scope)}`}
      GROUP BY person HAVING first >= ${days.from} AND first <= ${days.to}`
    const cohorts = yield* SqlSchema.findAll({
      Request: Schema.Void,
      Result: CohortRow,
      execute: () => sql`
        WITH cohort AS (${firsts})
        SELECT (first + 3) / 7 AS cohort, count(*) AS people FROM cohort GROUP BY cohort ORDER BY cohort`,
    })(undefined)
    const active = yield* SqlSchema.findAll({
      Request: Schema.Void,
      Result: ActiveRow,
      execute: () => sql`
        WITH cohort AS (${firsts}),
        weeks AS (
          SELECT DISTINCT a.person, (a.day + 3) / 7 AS week
          FROM signals_app_days a JOIN cohort c ON c.person = a.person
          WHERE ${sql.and([sql`a.day >= c.first`, ...scope])}
        )
        SELECT (c.first + 3) / 7 AS cohort, w.week - (c.first + 3) / 7 AS "weeksAfter", count(*) AS people
        FROM weeks w JOIN cohort c ON c.person = w.person
        GROUP BY cohort, "weeksAfter"`,
    })(undefined)
    const activeOf = new Map(active.map((row) => [`${row.cohort}:${row.weeksAfter}`, row.people] as const))
    const answer: AppRetention = {
      cohorts: cohorts.map((row): RetentionCohort => ({
        week: weekStart(row.cohort),
        people: row.people,
        active: Array.from({ length: currentWeek - row.cohort + 1 }, (_, after) =>
          after === 0 ? row.people : (activeOf.get(`${row.cohort}:${after}`) ?? 0),
        ),
      })),
      currentWeek: weekStart(currentWeek),
    }
    return answer
  }, Effect.orDie)

  // --- Releases and their health ---

  const ReleaseRow = Schema.Struct({
    component: ComponentKey,
    environment: EnvironmentKey,
    release: ReleaseVersion,
    firstSeen: Schema.Int,
    lastSeen: Schema.Int,
  })

  /** The releases that sent anything in the query's period, each with the release before it. */
  const releases = Effect.fn("AppStore.releases")(function* (query: AppReleaseQuery) {
    const scope = scopeOf(query)
    const rows = yield* SqlSchema.findAll({
      Request: Schema.Void,
      Result: ReleaseRow,
      execute: () => sql`
        SELECT component, environment, release, first_seen AS "firstSeen", last_seen AS "lastSeen"
        FROM signals_app_releases ${scope.length === 0 ? sql`` : sql`WHERE ${sql.and(scope)}`}
        ORDER BY first_seen DESC, component, environment, release`,
    })(undefined)
    const from = DateTime.toEpochMillis(query.period.from)
    const to = DateTime.toEpochMillis(query.period.to)
    const listed = rows.flatMap((row): ReadonlyArray<AppRelease> => {
      if (row.lastSeen < from || row.firstSeen >= to) {
        return []
      }
      const previous = rows.find(
        (other) =>
          other.component === row.component && other.environment === row.environment && other.firstSeen < row.firstSeen,
      )
      return [
        {
          component: row.component,
          environment: row.environment,
          release: row.release,
          firstSeen: DateTime.makeUnsafe(row.firstSeen),
          lastSeen: DateTime.makeUnsafe(row.lastSeen),
          ...(previous === undefined ? {} : { previous: previous.release }),
        },
      ]
    })
    const list: AppReleaseList = { releases: listed }
    return list
  }, Effect.orDie)

  const MeasureRow = Schema.Struct({ measure: Schema.String, count: Count, sketch: Schema.NullOr(SketchJson) })
  const KindRow = Schema.Struct({ kind: Schema.String, count: Count })
  const ReleaseActivityRow = Schema.Struct({ sessions: Total, people: Count })

  // A launch kind's times, from its measures; absent when it had none.
  const launchesOf = Effect.fn("AppStore.launchesOf")(function* (
    firstFrame: Sketch | undefined,
    ready: Sketch | undefined,
  ) {
    if (firstFrame === undefined || countOf(firstFrame) === 0) {
      return undefined
    }
    const firstFrameP50Ms = yield* quantile(firstFrame, p50)
    const firstFrameP95Ms = yield* quantile(firstFrame, p95)
    const times: LaunchTimes = { launches: countOf(firstFrame), firstFrameP50Ms, firstFrameP95Ms }
    if (ready === undefined || countOf(ready) === 0) {
      return times
    }
    const readyP50Ms = yield* quantile(ready, p50)
    const readyP95Ms = yield* quantile(ready, p95)
    const withReady: LaunchTimes = {
      ...times,
      ready: { launches: countOf(ready), p50Ms: readyP50Ms, p95Ms: readyP95Ms },
    }
    return withReady
  })

  // Memory, from its measures; absent when it was never measured.
  const memoryOf = Effect.fn("AppStore.memoryOf")(function* (peak: Sketch | undefined, footprint: Sketch | undefined) {
    if (peak === undefined || footprint === undefined || countOf(peak) === 0) {
      return undefined
    }
    const peakP95Bytes = yield* quantile(peak, p95)
    const footprintP95Bytes = yield* quantile(footprint, p95)
    const memory: MemoryUse = { samples: countOf(peak), peakP95Bytes, footprintP95Bytes }
    return memory
  })

  // Measures' rows merged by measure.
  const mergedOf = (rows: ReadonlyArray<typeof MeasureRow.Type>) => {
    const sketches = new Map<string, Array<Sketch>>()
    const counts = new Map<string, number>()
    for (const row of rows) {
      counts.set(row.measure, (counts.get(row.measure) ?? 0) + row.count)
      if (row.sketch !== null) {
        sketches.set(row.measure, [...(sketches.get(row.measure) ?? []), row.sketch])
      }
    }
    const sketchOfMeasure = (measure: string) => {
      const found = sketches.get(measure)
      return found === undefined ? undefined : mergeSketches(found)
    }
    return { sketchOf: sketchOfMeasure, countOf: (measure: string) => counts.get(measure) ?? 0 }
  }

  /** One release's health over everything kept of it. */
  const health = Effect.fn("AppStore.health")(function* (key: AppReleaseKey) {
    const where = sql`component = ${key.component} AND environment = ${key.environment} AND release = ${key.release}`
    const activity = yield* SqlSchema.findOne({
      Request: Schema.Void,
      Result: ReleaseActivityRow,
      execute: () =>
        sql`SELECT sum(sessions) AS sessions, count(DISTINCT person) AS people FROM signals_app_days WHERE ${where}`,
    })(undefined)
    const measured = yield* SqlSchema.findAll({
      Request: Schema.Void,
      Result: MeasureRow,
      execute: () => sql`SELECT measure, count, sketch FROM signals_app_measures WHERE ${where}`,
    })(undefined)
    const kinds = yield* SqlSchema.findAll({
      Request: Schema.Void,
      Result: KindRow,
      execute: () => sql`SELECT kind, sum(count) AS count FROM signals_app_diagnostics WHERE ${where} GROUP BY kind`,
    })(undefined)
    const merged = mergedOf(measured)
    const cold = yield* launchesOf(merged.sketchOf("launch.cold.first_frame"), merged.sketchOf("launch.cold.ready"))
    const warm = yield* launchesOf(merged.sketchOf("launch.warm.first_frame"), merged.sketchOf("launch.warm.ready"))
    const memory = yield* memoryOf(merged.sketchOf("memory.peak"), merged.sketchOf("memory.footprint"))
    const kind = (name: string) => kinds.find((row) => row.kind === name)?.count ?? 0
    const answer: AppHealth = {
      sessions: activity.sessions ?? 0,
      people: activity.people,
      ...(cold === undefined ? {} : { cold }),
      ...(warm === undefined ? {} : { warm }),
      prewarmed: merged.countOf("launch.prewarmed"),
      ...(memory === undefined ? {} : { memory }),
      ...(kind("report") === 0
        ? {}
        : {
            diagnostics: {
              reports: kind("report"),
              crashes: kind("crash"),
              hangs: kind("hang"),
              cpuExceptions: kind("cpu_exception"),
              diskWriteExceptions: kind("disk_write_exception"),
            },
          }),
    }
    return answer
  }, Effect.orDie)

  // --- Features ---

  const FeatureRow = Schema.Struct({
    feature: Schema.Union([Schema.Literal(""), FeatureKey]),
    people: Count,
    events: Count,
    screens: Count,
  })
  const FeatureMeasureRow = Schema.Struct({
    feature: Schema.Union([Schema.Literal(""), FeatureKey]),
    measure: Schema.String,
    count: Count,
    sketch: Schema.NullOr(SketchJson),
  })

  /** Each feature's use in the query's period, at `now`. */
  const features = Effect.fn("AppStore.features")(function* (query: AppQuery, now: number) {
    const days = daysOf(query.period, now)
    const inDays = [sql`day >= ${days.from}`, sql`day <= ${days.to}`, ...scopeOf(query)]
    const used = yield* SqlSchema.findAll({
      Request: Schema.Void,
      Result: FeatureRow,
      execute: () => sql`
        SELECT feature, count(DISTINCT person) AS people, sum(events) AS events, sum(screens) AS screens
        FROM signals_app_feature_days WHERE ${sql.and(inDays)}
        GROUP BY feature ORDER BY people DESC, feature`,
    })(undefined)
    const measured = yield* SqlSchema.findAll({
      Request: Schema.Void,
      Result: FeatureMeasureRow,
      execute: () => sql`
        SELECT feature, measure, count, sketch FROM signals_app_measures
        WHERE ${sql.and([...inDays, sql`measure IN ${sql.in(["memory.peak", "memory.footprint"])}`])}`,
    })(undefined)
    const rows = yield* Effect.forEach(used, (row) =>
      Effect.gen(function* () {
        const merged = mergedOf(measured.filter((each) => each.feature === row.feature))
        const memory = yield* memoryOf(merged.sketchOf("memory.peak"), merged.sketchOf("memory.footprint"))
        const use: FeatureUse = {
          ...(row.feature === "" ? {} : { feature: row.feature }),
          people: row.people,
          events: row.events,
          screens: row.screens,
          ...(memory === undefined ? {} : { memory }),
        }
        return use
      }),
    )
    const table: FeatureUseTable = { features: rows }
    return table
  }, Effect.orDie)

  // --- One person ---

  const PersonRow = Schema.Struct({ id: Schema.Int, person: PersonId, firstSeen: Schema.Int, lastSeen: Schema.Int })
  const InstallationRow = Schema.Struct({
    installation: InstallationId,
    component: ComponentKey,
    environment: EnvironmentKey,
    release: ReleaseVersion,
    device: DeviceJson,
    sdk: SdkJson,
    country: Schema.NullOr(CountryCodeSchema),
    firstSeen: Schema.Int,
    lastSeen: Schema.Int,
  })
  const PersonDayRow = Schema.Struct({ day: Schema.Int, sessions: Count, foregroundMs: Schema.Finite })

  const findPerson = (lookup: PersonLookup) =>
    SqlSchema.findOneOption({
      Request: Schema.Void,
      Result: PersonRow,
      execute: () =>
        lookup._tag === "ByPerson"
          ? sql`SELECT id, person, first_seen AS "firstSeen", last_seen AS "lastSeen" FROM signals_people
              WHERE person = ${lookup.person}`
          : sql`SELECT p.id, p.person, p.first_seen AS "firstSeen", p.last_seen AS "lastSeen"
              FROM signals_person_users u JOIN signals_people p ON p.id = u.person WHERE u.user = ${lookup.user}`,
    })(undefined)

  /** One person, by their ID or a user ID linked to them. Fails with `PersonNotFound`. */
  const person = Effect.fn("AppStore.person")(function* (lookup: PersonLookup) {
    const found = yield* findPerson(lookup).pipe(Effect.orDie)
    if (Option.isNone(found)) {
      return yield* new PersonNotFound()
    }
    const row = found.value
    const users = yield* SqlSchema.findAll({
      Request: Schema.Void,
      Result: Schema.Struct({ user: AppUserId }),
      execute: () => sql`SELECT user FROM signals_person_users WHERE person = ${row.id} ORDER BY user`,
    })(undefined).pipe(Effect.orDie)
    const installations = yield* SqlSchema.findAll({
      Request: Schema.Void,
      Result: InstallationRow,
      execute: () => sql`
        SELECT installation, component, environment, release, device, sdk, country,
          first_seen AS "firstSeen", last_seen AS "lastSeen"
        FROM signals_installations WHERE person = ${row.id} ORDER BY last_seen DESC LIMIT ${installationsShown}`,
    })(undefined).pipe(Effect.orDie)
    const activeDays = yield* SqlSchema.findAll({
      Request: Schema.Void,
      Result: PersonDayRow,
      execute: () => sql`
        SELECT day, sum(sessions) AS sessions, sum(foreground_ms) AS "foregroundMs"
        FROM signals_app_days WHERE person = ${row.id} GROUP BY day ORDER BY day DESC LIMIT ${daysShown}`,
    })(undefined).pipe(Effect.orDie)
    const timeline = yield* SqlSchema.findAll({
      Request: Schema.Void,
      Result: Schema.Struct({ entry: EntryJson }),
      execute: () => sql`
        SELECT entry FROM signals_app_timeline WHERE person = ${row.id}
        ORDER BY at DESC, signal DESC LIMIT ${timelineKept}`,
    })(undefined).pipe(Effect.orDie)
    const answer: AppPerson = {
      person: row.person,
      users: users.map((each) => each.user),
      firstSeen: DateTime.makeUnsafe(row.firstSeen),
      lastSeen: DateTime.makeUnsafe(row.lastSeen),
      installations: installations.map((each) => ({
        installation: each.installation,
        component: each.component,
        environment: each.environment,
        release: each.release,
        device: each.device,
        sdk: each.sdk,
        ...(each.country === null ? {} : { country: each.country }),
        firstSeen: DateTime.makeUnsafe(each.firstSeen),
        lastSeen: DateTime.makeUnsafe(each.lastSeen),
      })),
      days: activeDays.map((day) => ({
        day: calendarDayOfNumber(day.day),
        sessions: day.sessions,
        foregroundMs: day.foregroundMs,
      })),
      timeline: timeline.map((each) => each.entry),
    }
    return answer
  })

  return { seenOf, peopleOf, write, cleanUp, usage, retention, releases, health, features, person }
})
