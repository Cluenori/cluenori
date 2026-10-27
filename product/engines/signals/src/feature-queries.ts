import { CalendarDay, ComponentKey, EnvelopeName, EnvironmentKey, FeatureKey } from "@cluenori/foundation"
import { Schema } from "effect"

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

/**
 * How many times one operation ran and failed for one feature on one UTC day, in one environment:
 * what a trace export counts of the spans that named their feature in `cluenori.feature`.
 */
export const FeatureOperationCounts = Schema.Struct({
  /** The UTC day they started on, as days since 1970-01-01. */
  day: Schema.Int,
  feature: FeatureKey,
  operation: EnvelopeName,
  /** Absent when the component didn't say. */
  environment: Schema.optionalKey(EnvironmentKey),
  count: Count,
  errors: Count,
})
export type FeatureOperationCounts = typeof FeatureOperationCounts.Type

/** Which feature's operations to count: that key exactly, optionally in one environment, or of one component. */
export const FeatureQuery = Schema.Struct({
  feature: FeatureKey,
  environment: Schema.optionalKey(EnvironmentKey),
  component: Schema.optionalKey(ComponentKey),
}).annotate({ identifier: "FeatureQuery" })
export type FeatureQuery = typeof FeatureQuery.Type

/** How many times one operation of a component ran for a feature on one UTC day, and how many failed. */
export const FeatureOperationDay = Schema.Struct({
  day: CalendarDay,
  component: ComponentKey,
  operation: EnvelopeName,
  count: Count,
  errors: Count,
}).annotate({ identifier: "FeatureOperationDay" })
export type FeatureOperationDay = typeof FeatureOperationDay.Type
