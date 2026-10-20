import { ComponentKey, EnvironmentKey, Period, ReleaseVersion } from "@cluenori/foundation"
import { DateTime, Duration, Effect, Option, Schema } from "effect"
import { SqlClient, SqlSchema } from "effect/sql"

import type { ErrorDetail, ErrorGroup, ErrorQuery, ErrorTable, LogPage, LogQuery } from "./error-groups.ts"
import { ErrorGroupNotFound, levelsFrom } from "./error-groups.ts"
import type { ErrorGroupShape } from "./exports.ts"
import type { LogLine } from "./log-entry.ts"
import { ErrorGroupId, LogEntry } from "./log-entry.ts"
import { logRetention } from "./read-logs.ts"

// Error groups outlive their occurrences, so an error that comes back after months is known again.
const groupRetention = Duration.days(455)

const pageSize = 100
const latestOccurrences = 10

const EntryJson = Schema.fromJsonString(LogEntry)

const LineRow = Schema.Struct({ id: Schema.Int, component: ComponentKey, entry: EntryJson })

const GroupRow = Schema.Struct({
  id: ErrorGroupId,
  kind: Schema.Literals(["exception", "log"]),
  title: Schema.String,
  culprit: Schema.String,
  firstSeen: Schema.Int,
  lastSeen: Schema.Int,
  lastComponent: ComponentKey,
  lastEnvironment: Schema.Union([Schema.Literal(""), EnvironmentKey]),
  lastRelease: Schema.Union([Schema.Literal(""), ReleaseVersion]),
  occurrences: Schema.Int,
})
type GroupRow = typeof GroupRow.Type

// A period cut to what is kept, 90 days, and to now: [from, to) in ms.
const coveredOf = (period: Period, now: number) => {
  const from = Math.max(DateTime.toEpochMillis(period.from), now - Duration.toMillis(logRetention))
  const to = Math.min(DateTime.toEpochMillis(period.to), now)
  return from < to ? Option.some({ from, to }) : Option.none()
}

const periodOf = (covered: { readonly from: number; readonly to: number }) =>
  new Period({ from: DateTime.makeUnsafe(covered.from), to: DateTime.makeUnsafe(covered.to) })

// `%` and `_` in what people search for are themselves, not patterns.
const likePattern = (text: string) => `%${text.replace(/[!%_]/g, (character) => `!${character}`)}%`

const lineOf = (row: typeof LineRow.Type): LogLine => ({ id: row.id, component: row.component, ...row.entry })

const groupOf = (row: GroupRow): ErrorGroup => ({
  id: row.id,
  kind: row.kind,
  title: row.title,
  culprit: row.culprit,
  occurrences: row.occurrences,
  firstSeen: DateTime.makeUnsafe(row.firstSeen),
  lastSeen: DateTime.makeUnsafe(row.lastSeen),
  lastComponent: row.lastComponent,
  ...(row.lastEnvironment === "" ? {} : { lastEnvironment: row.lastEnvironment }),
  ...(row.lastRelease === "" ? {} : { lastRelease: row.lastRelease }),
})

/**
 * The project's warnings and errors, kept 90 days, and the error groups they belong to. Part of
 * Signals, which owns the transaction each write runs in.
 */
export const logStore = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const encodeEntry = Schema.encodeEffect(EntryJson)

  // Adds a batch's warnings and errors, and creates or updates their error groups. A group's title
  // and culprit follow its latest occurrence, so they improve with the code that derives them.
  const add = Effect.fn("LogStore.add")(function* (
    component: ComponentKey,
    entries: ReadonlyArray<LogEntry>,
    groups: ReadonlyArray<ErrorGroupShape>,
  ) {
    for (const entry of entries) {
      const time = DateTime.toEpochMillis(entry.time)
      const json = yield* encodeEntry(entry)
      const text = [entry.message, entry.exception?.type ?? "", entry.exception?.message ?? ""].join("\n")
      yield* sql`INSERT INTO signals_logs ${sql.insert({
        time,
        component,
        environment: entry.environment ?? "",
        level: entry.level,
        category: entry.category,
        error: entry.error ?? null,
        trace: entry.trace ?? null,
        text,
        entry: json,
      })}`
    }
    for (const group of groups) {
      const occurrences = entries.filter((entry) => entry.error === group.id)
      const [first] = occurrences
      if (first === undefined) {
        return yield* Effect.die(`Error group ${group.id} came with no occurrence`)
      }
      const firstSeen = occurrences.reduce(
        (least, entry) => Math.min(least, DateTime.toEpochMillis(entry.time)),
        Infinity,
      )
      const latest = occurrences.reduce(
        (newest, entry) => (DateTime.toEpochMillis(entry.time) > DateTime.toEpochMillis(newest.time) ? entry : newest),
        first,
      )
      yield* sql`
        INSERT INTO signals_error_groups ${sql.insert({
          id: group.id,
          kind: group.kind,
          title: group.title,
          culprit: group.culprit,
          first_seen: firstSeen,
          last_seen: DateTime.toEpochMillis(latest.time),
          last_component: component,
          last_environment: latest.environment ?? "",
          last_release: latest.release ?? "",
        })}
        ON CONFLICT (id) DO UPDATE SET
          first_seen = min(first_seen, excluded.first_seen),
          title = CASE WHEN excluded.last_seen >= last_seen THEN excluded.title ELSE title END,
          culprit = CASE WHEN excluded.last_seen >= last_seen THEN excluded.culprit ELSE culprit END,
          last_component = CASE WHEN excluded.last_seen >= last_seen THEN excluded.last_component ELSE last_component END,
          last_environment = CASE WHEN excluded.last_seen >= last_seen THEN excluded.last_environment ELSE last_environment END,
          last_release = CASE WHEN excluded.last_seen >= last_seen THEN excluded.last_release ELSE last_release END,
          last_seen = max(last_seen, excluded.last_seen)`
    }
  })

  // Removes warnings and errors older than 90 days, and groups unseen for 15 months.
  const cleanUp = Effect.fn("LogStore.cleanUp")(function* (now: number) {
    yield* sql`DELETE FROM signals_logs WHERE time < ${now - Duration.toMillis(logRetention)}`
    yield* sql`DELETE FROM signals_error_groups WHERE last_seen < ${now - Duration.toMillis(groupRetention)}`
  })

  const filtersOf = (
    covered: { readonly from: number; readonly to: number },
    query: { readonly environment?: EnvironmentKey; readonly component?: ComponentKey },
  ) => [
    sql`l.time >= ${covered.from}`,
    sql`l.time < ${covered.to}`,
    ...(query.environment === undefined ? [] : [sql`l.environment = ${query.environment}`]),
    ...(query.component === undefined ? [] : [sql`l.component = ${query.component}`]),
  ]

  const findGroups = (
    covered: { readonly from: number; readonly to: number },
    query: ErrorQuery,
    only?: ErrorGroupId,
  ) =>
    SqlSchema.findAll({
      Request: Schema.Void,
      Result: GroupRow,
      execute: () => sql`
        SELECT g.id, g.kind, g.title, g.culprit, g.first_seen AS "firstSeen", g.last_seen AS "lastSeen",
          g.last_component AS "lastComponent", g.last_environment AS "lastEnvironment",
          g.last_release AS "lastRelease", count(*) AS occurrences
        FROM signals_logs l JOIN signals_error_groups g ON g.id = l.error
        WHERE ${sql.and([...filtersOf(covered, query), ...(only === undefined ? [] : [sql`l.error = ${only}`])])}
        GROUP BY g.id
        ORDER BY occurrences DESC, g.last_seen DESC`,
    })(undefined)

  const errors = Effect.fn("LogStore.errors")(function* (query: ErrorQuery, now: number) {
    const covered = coveredOf(query.period, now)
    if (Option.isNone(covered)) {
      const empty: ErrorTable = { groups: [], occurrences: 0 }
      return empty
    }
    const rows = yield* findGroups(covered.value, query).pipe(Effect.orDie)
    const table: ErrorTable = {
      covered: periodOf(covered.value),
      groups: rows.map(groupOf),
      occurrences: rows.reduce((total, row) => total + row.occurrences, 0),
    }
    return table
  })

  const findLines = (covered: { readonly from: number; readonly to: number }, query: LogQuery, limit: number) =>
    SqlSchema.findAll({
      Request: Schema.Void,
      Result: LineRow,
      execute: () => sql`
        SELECT l.id, l.component, l.entry FROM signals_logs l
        WHERE ${sql.and([
          ...filtersOf(covered, query),
          sql`l.level IN ${sql.in(levelsFrom[query.minimumLevel ?? "warn"])}`,
          ...(query.search === undefined ? [] : [sql`l.text LIKE ${likePattern(query.search)} ESCAPE '!'`]),
          ...(query.category === undefined ? [] : [sql`l.category = ${query.category}`]),
          ...(query.trace === undefined ? [] : [sql`l.trace = ${query.trace}`]),
          ...(query.error === undefined ? [] : [sql`l.error = ${query.error}`]),
          ...(query.before === undefined ? [] : [sql`l.id < ${query.before}`]),
        ])}
        ORDER BY l.id DESC
        LIMIT ${limit}`,
    })(undefined)

  const error = Effect.fn("LogStore.error")(function* (id: ErrorGroupId, query: ErrorQuery, now: number) {
    const covered = coveredOf(query.period, now)
    if (Option.isNone(covered)) {
      return yield* new ErrorGroupNotFound({ error: id })
    }
    const [row] = yield* findGroups(covered.value, query, id).pipe(Effect.orDie)
    if (row === undefined) {
      return yield* new ErrorGroupNotFound({ error: id })
    }
    const lineRows = yield* findLines(
      covered.value,
      { ...query, minimumLevel: "error", error: id },
      latestOccurrences,
    ).pipe(Effect.orDie)
    const detail: ErrorDetail = { group: groupOf(row), latest: lineRows.map(lineOf) }
    return detail
  })

  const logs = Effect.fn("LogStore.logs")(function* (query: LogQuery, now: number) {
    const covered = coveredOf(query.period, now)
    if (Option.isNone(covered)) {
      const empty: LogPage = { lines: [] }
      return empty
    }
    const rows = yield* findLines(covered.value, query, pageSize + 1).pipe(Effect.orDie)
    const lines = rows.slice(0, pageSize).map(lineOf)
    const last = lines.at(-1)
    const page: LogPage = {
      covered: periodOf(covered.value),
      lines,
      ...(rows.length > pageSize && last !== undefined ? { next: last.id } : {}),
    }
    return page
  })

  return { add, cleanUp, error, errors, logs }
})
