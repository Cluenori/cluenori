import { QuantileSketch } from "@bagatka/quantile-sketch"
import { EnvelopeName, EnvironmentKey } from "@cluenori/foundation"
import { Schema } from "effect"

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

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
  totalMs: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
  /** The requests' durations in milliseconds, for their percentiles. */
  durations: QuantileSketch,
})
export type RequestCounts = typeof RequestCounts.Type

/** The SHA-256 of an export's body, as hex: an exporter's retry has the same one. */
export const BatchDigest = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)).pipe(Schema.brand("BatchDigest"))
export type BatchDigest = typeof BatchDigest.Type

/** The requests of one export, added up: what ingest sends a project's object. */
export const RequestBatch = Schema.Struct({
  digest: BatchDigest,
  counts: Schema.Array(RequestCounts),
})
export type RequestBatch = typeof RequestBatch.Type
