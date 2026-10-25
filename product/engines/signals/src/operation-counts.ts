import { QuantileSketch } from "@bagatka/quantile-sketch"
import { EnvelopeName, EnvironmentKey, Instant, ReleaseVersion } from "@cluenori/foundation"
import { Schema } from "effect"

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const Milliseconds = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))

/** How many times one operation ran in one environment, release and minute, and how long it took. */
export const OperationCounts = Schema.Struct({
  /** The start of the minute they started in. */
  bucket: Instant,
  /** The operation's name in its component, such as `GET /api/notes/{id}`. */
  operation: EnvelopeName,
  /** Absent when the component didn't say. */
  environment: Schema.optionalKey(EnvironmentKey),
  /** The release that ran it, from `service.version`; absent when the component didn't say. */
  release: Schema.optionalKey(ReleaseVersion),
  count: Count,
  errors: Count,
  /** The sum of their durations, in milliseconds, for their average. */
  totalMs: Milliseconds,
  /** Their durations in milliseconds, for their percentiles. */
  durations: QuantileSketch,
})
export type OperationCounts = typeof OperationCounts.Type

/** The SHA-256 of an export's body, as hex: an exporter's retry has the same one. */
export const BatchDigest = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)).pipe(Schema.brand("BatchDigest"))
export type BatchDigest = typeof BatchDigest.Type
