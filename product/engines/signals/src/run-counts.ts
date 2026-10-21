import { QuantileSketch } from "@bagatka/quantile-sketch"
import { EnvelopeName, EnvironmentKey, TraceId } from "@cluenori/foundation"
import { Schema } from "effect"

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const Milliseconds = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))

/** The runs of one operation in one environment and minute, added up. */
export const RunCounts = Schema.Struct({
  /** The start of the minute the runs started in. */
  bucket: Schema.DateTimeUtcFromString,
  /** The operation's name in its component, such as `GET /api/notes/{id}`. */
  operation: EnvelopeName,
  /** Absent when the component didn't say. */
  environment: Schema.optionalKey(EnvironmentKey),
  runs: Count,
  errors: Count,
  /** The sum of the runs' durations, in milliseconds, for their average. */
  totalMs: Milliseconds,
  /** The runs' durations in milliseconds, for their percentiles. */
  durations: QuantileSketch,
})
export type RunCounts = typeof RunCounts.Type

/** An HTTP response's status code. */
export const HttpStatus = Schema.Int.check(Schema.isBetween({ minimum: 100, maximum: 599 }))
export type HttpStatus = typeof HttpStatus.Type

/**
 * How many runs are kept of each operation, environment and hour: this many of the slowest, and
 * this many of the slowest that failed.
 */
export const keptPerHour = 5

/** A run kept so it can be opened, as an export brings it: its trace, and what it was. */
export const KeptRun = Schema.Struct({
  trace: TraceId,
  operation: EnvelopeName,
  /** Absent when the component didn't say. */
  environment: Schema.optionalKey(EnvironmentKey),
  start: Schema.DateTimeUtcFromString,
  durationMs: Milliseconds,
  /** Its status was an error, as a run counts as failed. */
  failed: Schema.Boolean,
  /** The HTTP status it answered with; absent for a message or a job, or when its service didn't say. */
  status: Schema.optionalKey(HttpStatus),
})
export type KeptRun = typeof KeptRun.Type

/** The SHA-256 of an export's body, as hex: an exporter's retry has the same one. */
export const BatchDigest = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)).pipe(Schema.brand("BatchDigest"))
export type BatchDigest = typeof BatchDigest.Type
