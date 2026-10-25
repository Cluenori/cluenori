import { EnvelopeName, EnvironmentKey, Instant, ReleaseVersion, TraceId } from "@cluenori/foundation"
import { Schema } from "effect"

const Milliseconds = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))

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
  /** The release that ran it; absent when the component didn't say. */
  release: Schema.optionalKey(ReleaseVersion),
  start: Instant,
  durationMs: Milliseconds,
  /** Its status was an error, as a failure is counted. */
  failed: Schema.Boolean,
  /** The HTTP status it answered with; absent for a message or a job, or when its service didn't say. */
  status: Schema.optionalKey(HttpStatus),
})
export type KeptTrace = typeof KeptTrace.Type
