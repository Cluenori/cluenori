import { QuantileSketch } from "@bagatka/quantile-sketch"
import { EnvelopeName, EnvironmentKey, TraceId } from "@cluenori/foundation"
import { Schema } from "effect"

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const Milliseconds = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))

/** The requests of one endpoint in one environment and minute, added up. */
export const RequestCounts = Schema.Struct({
  /** The start of the minute the requests started in. */
  bucket: Schema.DateTimeUtcFromString,
  /** The request's name in its component, such as `GET /api/notes/{id}`. */
  endpoint: EnvelopeName,
  /** Absent when the component didn't say. */
  environment: Schema.optionalKey(EnvironmentKey),
  requests: Count,
  errors: Count,
  /** The sum of the requests' durations, in milliseconds, for their average. */
  totalMs: Milliseconds,
  /** The requests' durations in milliseconds, for their percentiles. */
  durations: QuantileSketch,
})
export type RequestCounts = typeof RequestCounts.Type

/** An HTTP response's status code. */
export const HttpStatus = Schema.Int.check(Schema.isBetween({ minimum: 100, maximum: 599 }))
export type HttpStatus = typeof HttpStatus.Type

/**
 * How many requests are kept of each endpoint, environment and hour: this many of the slowest, and
 * this many of the slowest that failed.
 */
export const keptPerHour = 5

/** A request kept so it can be opened, as an export brings it: its trace, and what it was. */
export const KeptRequest = Schema.Struct({
  trace: TraceId,
  endpoint: EnvelopeName,
  /** Absent when the component didn't say. */
  environment: Schema.optionalKey(EnvironmentKey),
  start: Schema.DateTimeUtcFromString,
  durationMs: Milliseconds,
  /** Its status was an error, as a request counts as failed. */
  failed: Schema.Boolean,
  /** The HTTP status it answered with; absent for a message or a job, or when its service didn't say. */
  status: Schema.optionalKey(HttpStatus),
})
export type KeptRequest = typeof KeptRequest.Type

/** The SHA-256 of an export's body, as hex: an exporter's retry has the same one. */
export const BatchDigest = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)).pipe(Schema.brand("BatchDigest"))
export type BatchDigest = typeof BatchDigest.Type
