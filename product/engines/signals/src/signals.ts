import type { QuantileSketch as Sketch } from "@bagatka/quantile-sketch"
import { mergeSketches, Quantile, QuantileSketch, quantileOf } from "@bagatka/quantile-sketch"
import { ComponentKey, EnvelopeName, EnvironmentKey, Period } from "@cluenori/foundation"
import { Context, DateTime, Duration, Effect, Layer, Option, Order, Ref, Schema } from "effect"
import { SqlClient, SqlSchema } from "effect/sql"

import { requestRetention } from "./read-requests.ts"
import type { RequestBatch, RequestCounts } from "./request-counts.ts"
import { BatchDigest } from "./request-counts.ts"
import type { EndpointRow, EndpointTable, RequestQuery, RequestSeries, SeriesStep } from "./request-queries.ts"
import { migrateSignals } from "./signals-migrations.ts"

/** Where a component's requests are counted once it has 500 endpoints: names past that are counted here. */
export const otherEndpoints = EnvelopeName.make("(other endpoints)")

/** How long hourly counts are kept: 15 months, so a year compares with the one before. */
export const hourlyRetention = Duration.days(455)

const maxEndpointsPerComponent = 500

// An exporter retries a failed export within seconds; an hour of digests catches every retry.
const batchWindow = Duration.hours(1)

// Old buckets and digests are removed while recording, at most this often.
const cleanupInterval = Duration.minutes(10)

// Questions about this long or shorter read minutes; longer ones read hours.
const longestByMinute = Duration.days(2)

/** One store of counts: its table, how wide its buckets are, and how long it keeps them. */
interface Resolution {
  readonly table: "signals_minute_counts" | "signals_hour_counts"
  readonly width: number
  readonly kept: Duration.Duration
}

const byMinute: Resolution = { table: "signals_minute_counts", width: 60_000, kept: requestRetention }
const byHour: Resolution = { table: "signals_hour_counts", width: 3_600_000, kept: hourlyRetention }

const stepMillis: Readonly<Record<SeriesStep, number>> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "1h": 3_600_000,
  "1d": 86_400_000,
}

const floorTo = (millis: number, width: number) => millis - (((millis % width) + width) % width)
const ceilTo = (millis: number, width: number) => floorTo(millis + width - 1, width)

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

const CountsRow = Schema.Struct({
  bucket: Schema.Int,
  component: ComponentKey,
  endpoint: EnvelopeName,
  environment: Schema.Union([Schema.Literal(""), EnvironmentKey]),
  requests: Count,
  errors: Count,
  totalMs: Schema.Finite,
  durations: Schema.fromJsonString(QuantileSketch),
})
type CountsRow = typeof CountsRow.Type

const byRequestsThenName = Order.combineAll<EndpointRow>([
  Order.mapInput(Order.flip(Order.Number), (row) => row.requests),
  Order.mapInput(Order.String, (row) => row.component),
  Order.mapInput(Order.String, (row) => row.environment ?? ""),
  Order.mapInput(Order.String, (row) => row.endpoint),
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
    onNone: () => Effect.die("A counted endpoint has no durations"),
    onSome: (value) => Effect.succeed(value),
  })

// A batch's counts added up into hours, so each hour, endpoint and environment is one write.
const hoursOf = (counts: ReadonlyArray<RequestCounts>): ReadonlyArray<RequestCounts> => {
  const hours = new Map<string, RequestCounts>()
  for (const entry of counts) {
    const hour = floorTo(DateTime.toEpochMillis(entry.bucket), byHour.width)
    // Names and keys hold no control characters, so NUL separates them unambiguously.
    const key = [hour, entry.endpoint, entry.environment ?? ""].join("\u0000")
    const earlier = hours.get(key)
    hours.set(
      key,
      earlier === undefined
        ? { ...entry, bucket: DateTime.makeUnsafe(hour) }
        : {
            ...earlier,
            requests: earlier.requests + entry.requests,
            errors: earlier.errors + entry.errors,
            totalMs: earlier.totalMs + entry.totalMs,
            durations: mergeSketches([earlier.durations, entry.durations]),
          },
    )
  }
  return [...hours.values()]
}

/**
 * The requests of one project, counted by endpoint and environment, by the minute for 14 days and
 * by the hour for 15 months, and the questions asked of them. Runs inside the Durable Object that
 * holds the project's database. Each component counts at most 500 endpoints, the rest as
 * `(other endpoints)`.
 */
export class Signals extends Context.Service<
  Signals,
  {
    /**
     * Adds a batch's requests to the counts of `component`, in one transaction, once: a batch with a
     * digest recorded in the last hour, an exporter's retry, is skipped and reported as a duplicate.
     * Writes one row per endpoint, environment and minute in the batch, and one per hour.
     */
    readonly record: (component: ComponentKey, batch: RequestBatch) => Effect.Effect<"recorded" | "duplicate">
    /**
     * Every endpoint's requests in the query's period, most requested first: by the minute for two
     * days or less, by the hour beyond. Reads only.
     */
    readonly endpoints: (query: RequestQuery) => Effect.Effect<EndpointTable>
    /**
     * Requests and errors over the query's period, one point per step that has requests. A step
     * finer than the counts' buckets (by the hour past two days) is widened to them; the answer
     * says which step it used. Reads only.
     */
    readonly requestsOverTime: (query: RequestQuery, step: SeriesStep) => Effect.Effect<RequestSeries>
  }
>()("@cluenori/signals/signals") {
  /** Builds the engine on the object's database, first creating or updating its tables. */
  static readonly layer = Layer.effect(
    Signals,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* migrateSignals.pipe(Effect.orDie)
      const lastCleanup = yield* Ref.make(0)

      const encodeSketch = Schema.encodeEffect(Schema.fromJsonString(QuantileSketch))

      const findBatch = SqlSchema.findOneOption({
        Request: BatchDigest,
        Result: Schema.Struct({ digest: BatchDigest }),
        execute: (digest) => sql`SELECT digest FROM signals_batches WHERE digest = ${digest}`,
      })

      const findEndpoints = SqlSchema.findAll({
        Request: ComponentKey,
        Result: Schema.Struct({ id: Schema.Int, name: EnvelopeName }),
        execute: (component) => sql`SELECT id, name FROM signals_endpoints WHERE component = ${component}`,
      })

      const findDurations = (resolution: Resolution) =>
        SqlSchema.findOneOption({
          Request: Schema.Struct({ bucket: Schema.Int, endpoint: Schema.Int, environment: Schema.String }),
          Result: Schema.Struct({ durations: Schema.fromJsonString(QuantileSketch) }),
          execute: (key) =>
            sql`SELECT durations FROM ${sql(resolution.table)} WHERE bucket = ${key.bucket} AND endpoint = ${key.endpoint} AND environment = ${key.environment}`,
        })

      const findCounts = (resolution: Resolution) =>
        SqlSchema.findAll({
          Request: Schema.Struct({
            from: Schema.Int,
            to: Schema.Int,
            environment: Schema.optionalKey(EnvironmentKey),
            component: Schema.optionalKey(ComponentKey),
          }),
          Result: CountsRow,
          execute: (request) => sql`
            SELECT c.bucket, e.component, e.name AS endpoint, c.environment, c.requests, c.errors,
              c.total_ms AS "totalMs", c.durations
            FROM ${sql(resolution.table)} c JOIN signals_endpoints e ON e.id = c.endpoint
            WHERE ${sql.and([
              sql`c.bucket >= ${request.from}`,
              sql`c.bucket < ${request.to}`,
              ...(request.environment === undefined ? [] : [sql`c.environment = ${request.environment}`]),
              ...(request.component === undefined ? [] : [sql`e.component = ${request.component}`]),
            ])}`,
        })

      // The endpoint's row ID, adding the endpoint when it is new; past the limit, `(other endpoints)`.
      const endpointIdOf = Effect.fn("Signals.endpointIdOf")(function* (
        component: ComponentKey,
        name: EnvelopeName,
        known: Map<string, number>,
      ) {
        const atLimit = known.size >= maxEndpointsPerComponent
        const counted = atLimit && !known.has(name) ? otherEndpoints : name
        const existing = known.get(counted)
        if (existing !== undefined) {
          return existing
        }
        const [added] = yield* sql<{
          readonly id: number
        }>`INSERT INTO signals_endpoints (component, name) VALUES (${component}, ${counted}) RETURNING id`
        if (added === undefined) {
          return yield* Effect.die("Adding an endpoint returned no row")
        }
        known.set(counted, added.id)
        return added.id
      })

      const add = Effect.fn("Signals.add")(function* (resolution: Resolution, endpoint: number, counts: RequestCounts) {
        const bucket = floorTo(DateTime.toEpochMillis(counts.bucket), resolution.width)
        const environment = counts.environment ?? ""
        const stored = yield* findDurations(resolution)({ bucket, endpoint, environment })
        const durations = Option.match(stored, {
          onNone: () => counts.durations,
          onSome: (row) => mergeSketches([row.durations, counts.durations]),
        })
        const json = yield* encodeSketch(durations)
        yield* sql`
          INSERT INTO ${sql(resolution.table)} ${sql.insert({
            bucket,
            endpoint,
            environment,
            requests: counts.requests,
            errors: counts.errors,
            total_ms: counts.totalMs,
            durations: json,
          })}
          ON CONFLICT (bucket, endpoint, environment) DO UPDATE SET
            requests = requests + excluded.requests,
            errors = errors + excluded.errors,
            total_ms = total_ms + excluded.total_ms,
            durations = excluded.durations`
      })

      const cleanUp = Effect.fn("Signals.cleanUp")(function* (now: number) {
        const last = yield* Ref.get(lastCleanup)
        if (now - last < Duration.toMillis(cleanupInterval)) {
          return
        }
        yield* sql`DELETE FROM signals_minute_counts WHERE bucket < ${now - Duration.toMillis(byMinute.kept)}`
        yield* sql`DELETE FROM signals_hour_counts WHERE bucket < ${now - Duration.toMillis(byHour.kept)}`
        yield* sql`DELETE FROM signals_batches WHERE received_at < ${now - Duration.toMillis(batchWindow)}`
        yield* Ref.set(lastCleanup, now)
      })

      const recordOnce = Effect.fn("Signals.recordOnce")(function* (component: ComponentKey, batch: RequestBatch) {
        const current = yield* DateTime.now
        const now = DateTime.toEpochMillis(current)
        const seen = yield* findBatch(batch.digest)
        if (seen._tag === "Some") {
          return "duplicate" as const
        }
        yield* sql`INSERT INTO signals_batches ${sql.insert({ digest: batch.digest, received_at: now })}`
        const endpoints = yield* findEndpoints(component)
        const known = new Map(endpoints.map((endpoint) => [endpoint.name, endpoint.id] as const))
        for (const counts of batch.counts) {
          const endpoint = yield* endpointIdOf(component, counts.endpoint, known)
          yield* add(byMinute, endpoint, counts)
        }
        for (const counts of hoursOf(batch.counts)) {
          const endpoint = yield* endpointIdOf(component, counts.endpoint, known)
          yield* add(byHour, endpoint, counts)
        }
        yield* cleanUp(now)
        return "recorded" as const
      })

      const record = Effect.fn("Signals.record")(function* (component: ComponentKey, batch: RequestBatch) {
        return yield* sql.withTransaction(recordOnce(component, batch)).pipe(Effect.orDie)
      })

      const countsIn = Effect.fn("Signals.countsIn")(function* (query: RequestQuery) {
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
        }).pipe(Effect.orDie)
        const period = new Period({
          from: DateTime.makeUnsafe(covered.value.from),
          to: DateTime.makeUnsafe(covered.value.to),
        })
        return { covered: Option.some(period), rows, now, resolution }
      })

      const rowOf = Effect.fn("Signals.rowOf")(function* (rows: ReadonlyArray<CountsRow>) {
        const [first] = rows
        if (first === undefined) {
          return yield* Effect.die("An endpoint row needs counts")
        }
        const requests = rows.reduce((total, counts) => total + counts.requests, 0)
        const durations = mergeSketches(rows.map((counts) => counts.durations))
        const p50Ms = yield* percentile(durations, 0.5)
        const p80Ms = yield* percentile(durations, 0.8)
        const p95Ms = yield* percentile(durations, 0.95)
        const p99Ms = yield* percentile(durations, 0.99)
        const row: EndpointRow = {
          component: first.component,
          ...(first.environment === "" ? {} : { environment: first.environment }),
          endpoint: first.endpoint,
          requests,
          errors: rows.reduce((total, counts) => total + counts.errors, 0),
          averageMs: rows.reduce((total, counts) => total + counts.totalMs, 0) / requests,
          p50Ms,
          p80Ms,
          p95Ms,
          p99Ms,
        }
        return row
      })

      const endpoints = Effect.fn("Signals.endpoints")(function* (query: RequestQuery) {
        const { covered, rows, now, resolution } = yield* countsIn(query)
        const byEndpoint = Map.groupBy(rows, (row) => [row.component, row.environment, row.endpoint].join("\u0000"))
        const endpointRows = yield* Effect.forEach(byEndpoint.values(), rowOf)
        const newest = rows.reduce((latest, row) => Math.max(latest, row.bucket + resolution.width), 0)
        const table: EndpointTable = {
          ...(covered._tag === "Some" ? { covered: covered.value } : {}),
          rows: endpointRows.toSorted(byRequestsThenName),
          requests: rows.reduce((total, row) => total + row.requests, 0),
          errors: rows.reduce((total, row) => total + row.errors, 0),
          ...(rows.length === 0 ? {} : { dataUntil: DateTime.makeUnsafe(Math.min(newest, now)) }),
        }
        return table
      })

      const requestsOverTime = Effect.fn("Signals.requestsOverTime")(function* (query: RequestQuery, step: SeriesStep) {
        const { covered, rows, resolution } = yield* countsIn(query)
        const used: SeriesStep = stepMillis[step] < resolution.width ? "1h" : step
        const byStep = Map.groupBy(rows, (row) => floorTo(row.bucket, stepMillis[used]))
        const points = Array.from(byStep, ([start, inStep]) => ({
          start: DateTime.makeUnsafe(start),
          requests: inStep.reduce((total, row) => total + row.requests, 0),
          errors: inStep.reduce((total, row) => total + row.errors, 0),
        }))
        const series: RequestSeries = {
          ...(covered._tag === "Some" ? { covered: covered.value } : {}),
          step: used,
          points: points.toSorted(
            (left, right) => DateTime.toEpochMillis(left.start) - DateTime.toEpochMillis(right.start),
          ),
        }
        return series
      })

      return Signals.of({ record, endpoints, requestsOverTime })
    }),
  )
}
