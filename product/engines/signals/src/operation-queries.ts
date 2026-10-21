import { ComponentKey, EnvelopeName, EnvironmentKey, Period } from "@cluenori/foundation"
import { Schema } from "effect"

import { KeptTrace } from "./operation-counts.ts"

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const Milliseconds = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))

/**
 * What to count: the operations that ran in `period`, optionally of one environment, one
 * component, or one operation.
 */
export const OperationQuery = Schema.Struct({
  period: Period,
  environment: Schema.optionalKey(EnvironmentKey),
  component: Schema.optionalKey(ComponentKey),
  operation: Schema.optionalKey(EnvelopeName),
})
export type OperationQuery = typeof OperationQuery.Type

/** How wide each point of a series is. */
export const SeriesStep = Schema.Literals(["1m", "5m", "1h", "1d"])
export type SeriesStep = typeof SeriesStep.Type

/** Each step's width in milliseconds. */
export const stepMillis: Readonly<Record<SeriesStep, number>> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "1h": 3_600_000,
  "1d": 86_400_000,
}

/** Where a component's operations are counted once it has 500: names past that are counted here. */
export const otherOperations = EnvelopeName.make("(other operations)")

/** How many times one operation ran, and how long it took: one row of the operation table. */
export const OperationRow = Schema.Struct({
  component: ComponentKey,
  /** Absent when the component didn't say. */
  environment: Schema.optionalKey(EnvironmentKey),
  operation: EnvelopeName,
  count: Count,
  /** How many times its status was an error. */
  errors: Count,
  averageMs: Milliseconds,
  /** Percentiles of the durations by nearest rank, each within 2%: p99 of fewer than 100 is the slowest. */
  p50Ms: Milliseconds,
  p80Ms: Milliseconds,
  p95Ms: Milliseconds,
  p99Ms: Milliseconds,
})
export type OperationRow = typeof OperationRow.Type

/**
 * What a count covers: the asked-for period cut to the counts still kept and to now, widened to
 * whole buckets. Periods of two days or less are counted by the minute, kept 14 days; longer ones
 * by the hour, kept 15 months. Absent when nothing of the period is kept.
 */
const Covered = Schema.optionalKey(Period)

/** Every operation in a period, the most counted first. */
export const OperationTable = Schema.Struct({
  covered: Covered,
  rows: Schema.Array(OperationRow),
  count: Count,
  errors: Count,
  /** The end of the newest bucket with anything counted in it; absent when there is none. */
  dataUntil: Schema.optionalKey(Schema.DateTimeUtcFromString),
})
export type OperationTable = typeof OperationTable.Type

/** What started in one step of a series, with how long it took, as an operation's row says. */
export const LoadPoint = Schema.Struct({
  start: Schema.DateTimeUtcFromString,
  count: Count,
  errors: Count,
  p50Ms: Milliseconds,
  p80Ms: Milliseconds,
  p95Ms: Milliseconds,
  p99Ms: Milliseconds,
})
export type LoadPoint = typeof LoadPoint.Type

/**
 * The load over time: one point per step that had anything counted, oldest first. A step without a
 * point had nothing reported, which is not the same as nothing done: the sender may have been silent.
 */
export const LoadSeries = Schema.Struct({
  covered: Covered,
  /** The step used: the one asked for, or an hour when that is finer than the counts' buckets. */
  step: SeriesStep,
  points: Schema.Array(LoadPoint),
})
export type LoadSeries = typeof LoadSeries.Type

/** A kept trace, and the component whose operation it is. */
export const KeptTraceRow = Schema.Struct({ ...KeptTrace.fields, component: ComponentKey })
export type KeptTraceRow = typeof KeptTraceRow.Type

/**
 * Traces worth opening, from those kept: of each operation, environment and hour, the five slowest
 * and the five slowest that failed, 14 days. Each opens with its trace ID. `covered` is the period
 * cut to the 14 days and to now; absent when nothing of it is kept.
 */
export const KeptTraces = Schema.Struct({
  covered: Covered,
  /** The slowest, slowest first: at most 20. */
  slowest: Schema.Array(KeptTraceRow),
  /** The failed, newest first: at most 20. */
  failed: Schema.Array(KeptTraceRow),
})
export type KeptTraces = typeof KeptTraces.Type
