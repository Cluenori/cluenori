import type { QuantileSketch as Sketch } from "@bagatka/quantile-sketch"
import { mergeSketches, Quantile, QuantileSketch, quantileOf } from "@bagatka/quantile-sketch"
import { ComponentKey, EnvelopeName, EnvironmentKey, Period, TraceId } from "@cluenori/foundation"
import { DateTime, Duration, Effect, Option, Order, Schema } from "effect"
import { SqlClient, SqlSchema } from "effect/sql"

import type { KeptTrace, OperationCounts } from "./operation-counts.ts"
import { HttpStatus, keptPerHour } from "./operation-counts.ts"
import type {
  OperationRow,
  OperationTable,
  KeptTraceRow,
  KeptTraces,
  OperationQuery,
  LoadSeries,
  SeriesStep,
} from "./operation-queries.ts"
import { otherOperations, stepMillis } from "./operation-queries.ts"
import { countRetention } from "./read-traces.ts"

/** How long hourly counts are kept: 15 months, so a year compares with the one before. */
export const hourlyRetention = Duration.days(455)

const maxOperationsPerComponent = 500

// How many kept traces a question answers in each list.
const keptListed = 20

// Which list a trace is kept for: the slowest, or the slowest that failed.
const KeptFor = Schema.Literals(["slowest", "failed"])
type KeptFor = typeof KeptFor.Type

// Questions about this long or shorter read minutes; longer ones read hours.
const longestByMinute = Duration.days(2)

/** One store of counts: its table, how wide its buckets are, and how long it keeps them. */
interface Resolution {
  readonly table: "signals_minute_counts" | "signals_hour_counts"
  readonly width: number
  readonly kept: Duration.Duration
}

const byMinute: Resolution = { table: "signals_minute_counts", width: 60_000, kept: countRetention }
const byHour: Resolution = { table: "signals_hour_counts", width: 3_600_000, kept: hourlyRetention }

const floorTo = (millis: number, width: number) => millis - (((millis % width) + width) % width)
const ceilTo = (millis: number, width: number) => floorTo(millis + width - 1, width)

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

const CountsRow = Schema.Struct({
  bucket: Schema.Int,
  component: ComponentKey,
  operation: EnvelopeName,
  environment: Schema.Union([Schema.Literal(""), EnvironmentKey]),
  count: Count,
  errors: Count,
  totalMs: Schema.Finite,
  durations: Schema.fromJsonString(QuantileSketch),
})
type CountsRow = typeof CountsRow.Type

const KeptRow = Schema.Struct({
  component: ComponentKey,
  operation: EnvelopeName,
  environment: Schema.Union([Schema.Literal(""), EnvironmentKey]),
  trace: TraceId,
  start: Schema.Int,
  durationMs: Schema.Finite,
  failed: Schema.BooleanFromBit,
  status: Schema.NullOr(HttpStatus),
})

const keptRowOf = (row: typeof KeptRow.Type): KeptTraceRow => ({
  trace: row.trace,
  component: row.component,
  operation: row.operation,
  ...(row.environment === "" ? {} : { environment: row.environment }),
  start: DateTime.makeUnsafe(row.start),
  durationMs: row.durationMs,
  failed: row.failed,
  ...(row.status === null ? {} : { status: row.status }),
})

const byCountThenName = Order.combineAll<OperationRow>([
  Order.mapInput(Order.flip(Order.Number), (row) => row.count),
  Order.mapInput(Order.String, (row) => row.component),
  Order.mapInput(Order.String, (row) => row.environment ?? ""),
  Order.mapInput(Order.String, (row) => row.operation),
])

// Which store answers a question about `period`: minutes for two days or less, hours beyond.
const resolutionFor = (period: Period) =>
  DateTime.toEpochMillis(period.to) - DateTime.toEpochMillis(period.from) <= Duration.toMillis(longestByMinute)
    ? byMinute
    : byHour

// The period cut to what `resolution` keeps and to now, in its whole buckets: [from, to) in ms.
const coveredOf = (period: Period, resolution: Resolution, now: number) => {
  const keptFrom = ceilTo(now - Duration.toMillis(resolution.kept), resolution.width)
  const from = Math.max(floorTo(DateTime.toEpochMillis(period.from), resolution.width), keptFrom)
  const to = ceilTo(Math.min(DateTime.toEpochMillis(period.to), now), resolution.width)
  return from < to ? Option.some({ from, to }) : Option.none()
}

const percentile = (durations: Sketch, quantile: number) =>
  Option.match(quantileOf(durations, Quantile.make(quantile)), {
    onNone: () => Effect.die("A counted operation has no durations"),
    onSome: (value) => Effect.succeed(value),
  })

// A batch's counts added up into hours, so each hour, operation and environment is one write.
const hoursOf = (counts: ReadonlyArray<OperationCounts>): ReadonlyArray<OperationCounts> => {
  const hours = new Map<string, OperationCounts>()
  for (const entry of counts) {
    const hour = floorTo(DateTime.toEpochMillis(entry.bucket), byHour.width)
    // Names and keys hold no control characters, so NUL separates them unambiguously.
    const key = [hour, entry.operation, entry.environment ?? ""].join("\u0000")
    const earlier = hours.get(key)
    hours.set(
      key,
      earlier === undefined
        ? { ...entry, bucket: DateTime.makeUnsafe(hour) }
        : {
            ...earlier,
            count: earlier.count + entry.count,
            errors: earlier.errors + entry.errors,
            totalMs: earlier.totalMs + entry.totalMs,
            durations: mergeSketches([earlier.durations, entry.durations]),
          },
    )
  }
  return [...hours.values()]
}

/**
 * The project's operations, counted by name and environment, by the minute for 14 days and by the
 * hour for 15 months, and the traces kept so they open from them, 14 days. Part of Signals, which
 * owns the transaction each write runs in.
 */
export const operationStore = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  const encodeSketch = Schema.encodeEffect(Schema.fromJsonString(QuantileSketch))

  const findOperations = SqlSchema.findAll({
    Request: ComponentKey,
    Result: Schema.Struct({ id: Schema.Int, name: EnvelopeName }),
    execute: (component) => sql`SELECT id, name FROM signals_operations WHERE component = ${component}`,
  })

  const findDurations = (resolution: Resolution) =>
    SqlSchema.findOneOption({
      Request: Schema.Struct({ bucket: Schema.Int, operation: Schema.Int, environment: Schema.String }),
      Result: Schema.Struct({ durations: Schema.fromJsonString(QuantileSketch) }),
      execute: (key) =>
        sql`SELECT durations FROM ${sql(resolution.table)} WHERE bucket = ${key.bucket} AND operation = ${key.operation} AND environment = ${key.environment}`,
    })

  const findCounts = (resolution: Resolution) =>
    SqlSchema.findAll({
      Request: Schema.Struct({
        from: Schema.Int,
        to: Schema.Int,
        environment: Schema.optionalKey(EnvironmentKey),
        component: Schema.optionalKey(ComponentKey),
        operation: Schema.optionalKey(EnvelopeName),
      }),
      Result: CountsRow,
      execute: (asked) => sql`
        SELECT c.bucket, o.component, o.name AS operation, c.environment, c.count, c.errors,
          c.total_ms AS "totalMs", c.durations
        FROM ${sql(resolution.table)} c JOIN signals_operations o ON o.id = c.operation
        WHERE ${sql.and([
          sql`c.bucket >= ${asked.from}`,
          sql`c.bucket < ${asked.to}`,
          ...(asked.environment === undefined ? [] : [sql`c.environment = ${asked.environment}`]),
          ...(asked.component === undefined ? [] : [sql`o.component = ${asked.component}`]),
          ...(asked.operation === undefined ? [] : [sql`o.name = ${asked.operation}`]),
        ])}`,
    })

  const findKept = SqlSchema.findAll({
    Request: Schema.Struct({
      keptFor: KeptFor,
      from: Schema.Int,
      to: Schema.Int,
      environment: Schema.optionalKey(EnvironmentKey),
      component: Schema.optionalKey(ComponentKey),
      operation: Schema.optionalKey(EnvelopeName),
    }),
    Result: KeptRow,
    execute: (asked) => sql`
      SELECT o.component, o.name AS operation, k.environment, k.trace, k.start,
        k.duration_ms AS "durationMs", k.failed, k.status
      FROM signals_kept_traces k JOIN signals_operations o ON o.id = k.operation
      WHERE ${sql.and([
        sql`k.kept_for = ${asked.keptFor}`,
        sql`k.hour >= ${floorTo(asked.from, byHour.width)}`,
        sql`k.hour < ${asked.to}`,
        sql`k.start >= ${asked.from}`,
        sql`k.start < ${asked.to}`,
        ...(asked.environment === undefined ? [] : [sql`k.environment = ${asked.environment}`]),
        ...(asked.component === undefined ? [] : [sql`o.component = ${asked.component}`]),
        ...(asked.operation === undefined ? [] : [sql`o.name = ${asked.operation}`]),
      ])}
      ORDER BY ${asked.keptFor === "slowest" ? sql`k.duration_ms DESC` : sql`k.start DESC`}
      LIMIT ${keptListed}`,
  })

  // The operation's row ID, adding the operation when it is new; past the limit, `(other operations)`.
  const operationIdOf = Effect.fn("OperationStore.operationIdOf")(function* (
    component: ComponentKey,
    name: EnvelopeName,
    known: Map<string, number>,
  ) {
    const atLimit = known.size >= maxOperationsPerComponent
    const counted = atLimit && !known.has(name) ? otherOperations : name
    const existing = known.get(counted)
    if (existing !== undefined) {
      return existing
    }
    const [added] = yield* sql<{
      readonly id: number
    }>`INSERT INTO signals_operations (component, name) VALUES (${component}, ${counted}) RETURNING id`
    if (added === undefined) {
      return yield* Effect.die("Adding an operation returned no row")
    }
    known.set(counted, added.id)
    return added.id
  })

  const addTo = Effect.fn("OperationStore.addTo")(function* (
    resolution: Resolution,
    operation: number,
    counts: OperationCounts,
  ) {
    const bucket = floorTo(DateTime.toEpochMillis(counts.bucket), resolution.width)
    const environment = counts.environment ?? ""
    const stored = yield* findDurations(resolution)({ bucket, operation, environment })
    const durations = Option.match(stored, {
      onNone: () => counts.durations,
      onSome: (row) => mergeSketches([row.durations, counts.durations]),
    })
    const json = yield* encodeSketch(durations)
    yield* sql`
      INSERT INTO ${sql(resolution.table)} ${sql.insert({
        bucket,
        operation,
        environment,
        count: counts.count,
        errors: counts.errors,
        total_ms: counts.totalMs,
        durations: json,
      })}
      ON CONFLICT (bucket, operation, environment) DO UPDATE SET
        count = count + excluded.count,
        errors = errors + excluded.errors,
        total_ms = total_ms + excluded.total_ms,
        durations = excluded.durations`
  })

  // Keeps a batch's traces with those kept before, in the list or lists each is kept for, then
  // keeps of each operation, environment, hour and list only the slowest `keptPerHour`.
  const keep = Effect.fn("OperationStore.keep")(function* (
    component: ComponentKey,
    kept: ReadonlyArray<KeptTrace>,
    known: Map<string, number>,
  ) {
    const lists = new Map<
      string,
      { readonly operation: number; readonly environment: string; readonly hour: number; readonly keptFor: KeptFor }
    >()
    for (const trace of kept) {
      const operation = yield* operationIdOf(component, trace.operation, known)
      const start = DateTime.toEpochMillis(trace.start)
      const hour = floorTo(start, byHour.width)
      const environment = trace.environment ?? ""
      const keptFor: ReadonlyArray<KeptFor> = trace.failed ? ["slowest", "failed"] : ["slowest"]
      for (const list of keptFor) {
        yield* sql`INSERT INTO signals_kept_traces ${sql.insert({
          operation,
          environment,
          hour,
          kept_for: list,
          trace: trace.trace,
          start,
          duration_ms: trace.durationMs,
          failed: trace.failed ? 1 : 0,
          ...(trace.status === undefined ? {} : { status: trace.status }),
        })}`
        lists.set([operation, environment, hour, list].join("\u0000"), { operation, environment, hour, keptFor: list })
      }
    }
    for (const list of lists.values()) {
      yield* sql`
        DELETE FROM signals_kept_traces WHERE id IN (
          SELECT id FROM signals_kept_traces
          WHERE operation = ${list.operation} AND kept_for = ${list.keptFor} AND hour = ${list.hour}
            AND environment = ${list.environment}
          ORDER BY duration_ms DESC, id
          LIMIT -1 OFFSET ${keptPerHour})`
    }
  })

  // Adds a batch's counts by the minute and by the hour, and keeps its traces worth opening. Runs
  // inside the caller's transaction.
  const add = Effect.fn("OperationStore.add")(function* (
    component: ComponentKey,
    batch: ReadonlyArray<OperationCounts>,
    kept: ReadonlyArray<KeptTrace>,
  ) {
    const operations = yield* findOperations(component)
    const known = new Map(operations.map((operation) => [operation.name, operation.id] as const))
    for (const counts of batch) {
      const operation = yield* operationIdOf(component, counts.operation, known)
      yield* addTo(byMinute, operation, counts)
    }
    for (const counts of hoursOf(batch)) {
      const operation = yield* operationIdOf(component, counts.operation, known)
      yield* addTo(byHour, operation, counts)
    }
    yield* keep(component, kept, known)
  })

  // Removes minutes and kept traces older than 14 days, and hours older than 15 months.
  const cleanUp = Effect.fn("OperationStore.cleanUp")(function* (now: number) {
    yield* sql`DELETE FROM signals_minute_counts WHERE bucket < ${now - Duration.toMillis(byMinute.kept)}`
    yield* sql`DELETE FROM signals_kept_traces WHERE hour < ${now - Duration.toMillis(byMinute.kept)}`
    yield* sql`DELETE FROM signals_hour_counts WHERE bucket < ${now - Duration.toMillis(byHour.kept)}`
  })

  const countsIn = Effect.fn("OperationStore.countsIn")(function* (query: OperationQuery) {
    const current = yield* DateTime.now
    const now = DateTime.toEpochMillis(current)
    const resolution = resolutionFor(query.period)
    const covered = coveredOf(query.period, resolution, now)
    if (covered._tag === "None") {
      return { covered: Option.none<Period>(), rows: [], now, resolution }
    }
    const rows = yield* findCounts(resolution)({
      from: covered.value.from,
      to: covered.value.to,
      ...(query.environment === undefined ? {} : { environment: query.environment }),
      ...(query.component === undefined ? {} : { component: query.component }),
      ...(query.operation === undefined ? {} : { operation: query.operation }),
    }).pipe(Effect.orDie)
    const period = new Period({
      from: DateTime.makeUnsafe(covered.value.from),
      to: DateTime.makeUnsafe(covered.value.to),
    })
    return { covered: Option.some(period), rows, now, resolution }
  })

  const rowOf = Effect.fn("OperationStore.rowOf")(function* (rows: ReadonlyArray<CountsRow>) {
    const [first] = rows
    if (first === undefined) {
      return yield* Effect.die("An operation row needs counts")
    }
    const count = rows.reduce((total, counts) => total + counts.count, 0)
    const durations = mergeSketches(rows.map((counts) => counts.durations))
    const p50Ms = yield* percentile(durations, 0.5)
    const p80Ms = yield* percentile(durations, 0.8)
    const p95Ms = yield* percentile(durations, 0.95)
    const p99Ms = yield* percentile(durations, 0.99)
    const row: OperationRow = {
      component: first.component,
      ...(first.environment === "" ? {} : { environment: first.environment }),
      operation: first.operation,
      count,
      errors: rows.reduce((total, counts) => total + counts.errors, 0),
      averageMs: rows.reduce((total, counts) => total + counts.totalMs, 0) / count,
      p50Ms,
      p80Ms,
      p95Ms,
      p99Ms,
    }
    return row
  })

  const operations = Effect.fn("OperationStore.operations")(function* (query: OperationQuery) {
    const { covered, rows, now, resolution } = yield* countsIn(query)
    const byOperation = Map.groupBy(rows, (row) => [row.component, row.environment, row.operation].join("\u0000"))
    const operationRows = yield* Effect.forEach(byOperation.values(), rowOf)
    const newest = rows.reduce((latest, row) => Math.max(latest, row.bucket + resolution.width), 0)
    const table: OperationTable = {
      ...(covered._tag === "Some" ? { covered: covered.value } : {}),
      rows: operationRows.toSorted(byCountThenName),
      count: rows.reduce((total, row) => total + row.count, 0),
      errors: rows.reduce((total, row) => total + row.errors, 0),
      ...(rows.length === 0 ? {} : { dataUntil: DateTime.makeUnsafe(Math.min(newest, now)) }),
    }
    return table
  })

  const loadOverTime = Effect.fn("OperationStore.loadOverTime")(function* (query: OperationQuery, step: SeriesStep) {
    const { covered, rows, resolution } = yield* countsIn(query)
    const used: SeriesStep = stepMillis[step] < resolution.width ? "1h" : step
    const byStep = Map.groupBy(rows, (row) => floorTo(row.bucket, stepMillis[used]))
    const points = yield* Effect.forEach(byStep, ([start, inStep]) =>
      Effect.gen(function* () {
        const durations = mergeSketches(inStep.map((row) => row.durations))
        return {
          start: DateTime.makeUnsafe(start),
          count: inStep.reduce((total, row) => total + row.count, 0),
          errors: inStep.reduce((total, row) => total + row.errors, 0),
          p50Ms: yield* percentile(durations, 0.5),
          p80Ms: yield* percentile(durations, 0.8),
          p95Ms: yield* percentile(durations, 0.95),
          p99Ms: yield* percentile(durations, 0.99),
        }
      }),
    )
    const series: LoadSeries = {
      ...(covered._tag === "Some" ? { covered: covered.value } : {}),
      step: used,
      points: points.toSorted(
        (left, right) => DateTime.toEpochMillis(left.start) - DateTime.toEpochMillis(right.start),
      ),
    }
    return series
  })

  // The slowest and the failed of the traces kept in the query's period, cut to the 14 days they
  // are kept, as minutes are.
  const keptTraces = Effect.fn("OperationStore.keptTraces")(function* (query: OperationQuery) {
    const current = yield* DateTime.now
    const covered = coveredOf(query.period, byMinute, DateTime.toEpochMillis(current))
    if (covered._tag === "None") {
      const none: KeptTraces = { slowest: [], failed: [] }
      return none
    }
    const asked = {
      from: covered.value.from,
      to: covered.value.to,
      ...(query.environment === undefined ? {} : { environment: query.environment }),
      ...(query.component === undefined ? {} : { component: query.component }),
      ...(query.operation === undefined ? {} : { operation: query.operation }),
    }
    const slowest = yield* findKept({ keptFor: "slowest", ...asked }).pipe(Effect.orDie)
    const failed = yield* findKept({ keptFor: "failed", ...asked }).pipe(Effect.orDie)
    const answer: KeptTraces = {
      covered: new Period({ from: DateTime.makeUnsafe(covered.value.from), to: DateTime.makeUnsafe(covered.value.to) }),
      slowest: slowest.map(keptRowOf),
      failed: failed.map(keptRowOf),
    }
    return answer
  })

  return { add, cleanUp, operations, loadOverTime, keptTraces }
})
