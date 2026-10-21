import { QuantileSketch } from "@bagatka/quantile-sketch"
import { EnvelopeName, EnvironmentKey, Instant, TraceId } from "@cluenori/foundation"
import { Schema } from "effect"

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const Milliseconds = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))

/** How many times one operation ran in one environment and minute, and how long it took. */
export const OperationCounts = Schema.Struct({
  /** The start of the minute they started in. */
  bucket: Instant,
  /** The operation's name in its component, such as `GET /api/notes/{id}`. */
  operation: EnvelopeName,
  /** Absent when the component didn't say. */
  environment: Schema.optionalKey(EnvironmentKey),
  count: Count,
  errors: Count,
  /** The sum of their durations, in milliseconds, for their average. */
  totalMs: Milliseconds,
  /** Their durations in milliseconds, for their percentiles. */
  durations: QuantileSketch,
})
export type OperationCounts = typeof OperationCounts.Type

/** An HTTP response's status code. */
export const HttpStatus = Schema.Int.check(Schema.isBetween({ minimum: 100, maximum: 599 }))
export type HttpStatus = typeof HttpStatus.Type

/**
 * How many traces are kept of each operation, environment and hour: this many of the slowest, and
 * this many of the slowest that failed.
 */
export const keptPerHour = 5

/**
 * A trace kept so it opens from its operation, as an export brings it: its ID, and when the
 * operation's span in it started, how long it took, and how it ended.
 */
export const KeptTrace = Schema.Struct({
  trace: TraceId,
  operation: EnvelopeName,
  /** Absent when the component didn't say. */
  environment: Schema.optionalKey(EnvironmentKey),
  start: Instant,
  durationMs: Milliseconds,
  /** Its status was an error, as a failure is counted. */
  failed: Schema.Boolean,
  /** The HTTP status it answered with; absent for a message or a job, or when its service didn't say. */
  status: Schema.optionalKey(HttpStatus),
})
export type KeptTrace = typeof KeptTrace.Type

/** The SHA-256 of an export's body, as hex: an exporter's retry has the same one. */
export const BatchDigest = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)).pipe(Schema.brand("BatchDigest"))
export type BatchDigest = typeof BatchDigest.Type
