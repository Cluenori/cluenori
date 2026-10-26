import { CalendarDay, FeatureKey, Instant, Period } from "@cluenori/foundation"
import { ErrorGroup, FeatureOperationDay, FeatureUseLife } from "@cluenori/signals"
import { Schema } from "effect"

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

/** One UTC day of a feature's warnings and errors, as its services sent them. */
export const FeatureLogDay = Schema.Struct({
  day: CalendarDay,
  warnings: Count,
  /** Errors and fatal records. */
  errors: Count,
}).annotate({ identifier: "FeatureLogDay" })
export type FeatureLogDay = typeof FeatureLogDay.Type

/**
 * A feature's warnings and errors from its services, kept 90 days: `covered` is the part kept; each
 * UTC day that had any, oldest first; and its errors, the most frequent first, at most 10.
 */
export const FeatureLogs = Schema.Struct({
  covered: Schema.optionalKey(Period),
  days: Schema.Array(FeatureLogDay),
  errors: Schema.Array(ErrorGroup),
}).annotate({ identifier: "FeatureLogs" })
export type FeatureLogs = typeof FeatureLogs.Type

/**
 * One feature's story, over everything kept of it, with no period: how the apps used it (each day's
 * people, events and screens, everyone, who used it last, its releases), and what its services sent
 * for it (its warnings and errors each day and its errors; the operations that ran for it each day).
 * Apps mark a feature on their signals; services name it in `cluenori.feature`. Each part is empty
 * when nothing of that kind named the feature.
 */
export const FeatureStory = Schema.Struct({
  feature: FeatureKey,
  /** When it was answered: today is the UTC day it is in, so far. */
  asOf: Instant,
  use: FeatureUseLife,
  logs: FeatureLogs,
  /** Every day kept (15 months), oldest first, by component and operation. */
  operations: Schema.Array(FeatureOperationDay),
}).annotate({ identifier: "FeatureStory" })
export type FeatureStory = typeof FeatureStory.Type

/** Nothing kept names this feature: no app marked it in 15 months, and no service sent it in 90 days or ran it in 15 months. */
export class FeatureNotFound extends Schema.TaggedError<FeatureNotFound>()("FeatureNotFound", {
  feature: FeatureKey,
}) {}
