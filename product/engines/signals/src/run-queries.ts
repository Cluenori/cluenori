import { ComponentKey, EnvelopeName, EnvironmentKey, Period } from "@cluenori/foundation"
import { Schema } from "effect"

import { KeptRun } from "./run-counts.ts"

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const Milliseconds = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))

/**
 * Which runs to count: those that started in `period`, optionally of one environment, one
 * component, or one operation.
 */
export const RunQuery = Schema.Struct({
  period: Period,
  environment: Schema.optionalKey(EnvironmentKey),
  component: Schema.optionalKey(ComponentKey),
  operation: Schema.optionalKey(EnvelopeName),
})
export type RunQuery = typeof RunQuery.Type

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

/** Where a component's runs are counted once it has 500 operations: names past that are counted here. */
export const otherOperations = EnvelopeName.make("(other operations)")

/** Runs by operation, with how long they took: one row of the operation table. */
export const OperationRow = Schema.Struct({
  component: ComponentKey,
  /** Absent when the component didn't say. */
  environment: Schema.optionalKey(EnvironmentKey),
  operation: EnvelopeName,
  runs: Count,
  /** Runs whose status was an error. */
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

/** Every operation's runs in a period, the most runs first. */
export const OperationTable = Schema.Struct({
  covered: Covered,
  rows: Schema.Array(OperationRow),
  runs: Count,
  errors: Count,
  /** The end of the newest bucket with runs in it; absent when there are none. */
  dataUntil: Schema.optionalKey(Schema.DateTimeUtcFromString),
})
export type OperationTable = typeof OperationTable.Type

/** Runs that started in one step of a series, with how long they took, as an operation's row says. */
export const RunPoint = Schema.Struct({
  start: Schema.DateTimeUtcFromString,
  runs: Count,
  errors: Count,
  p50Ms: Milliseconds,
  p80Ms: Milliseconds,
  p95Ms: Milliseconds,
  p99Ms: Milliseconds,
})
export type RunPoint = typeof RunPoint.Type

/**
 * Runs over time, one point per step that has runs, oldest first. A step without a point had no
 * runs reported, which is not the same as having none: the sender may have been silent.
 */
export const RunSeries = Schema.Struct({
  covered: Covered,
  /** The step used: the one asked for, or an hour when that is finer than the counts' buckets. */
  step: SeriesStep,
  points: Schema.Array(RunPoint),
})
export type RunSeries = typeof RunSeries.Type

/** A kept run, and the component that ran it. */
export const KeptRunRow = Schema.Struct({ ...KeptRun.fields, component: ComponentKey })
export type KeptRunRow = typeof KeptRunRow.Type

/**
 * Runs worth opening, from those kept: of each operation, environment and hour, the five slowest
 * and the five slowest that failed, 14 days. Each opens with its trace ID. `covered` is the period
 * cut to the 14 days and to now; absent when nothing of it is kept.
 */
export const KeptRuns = Schema.Struct({
  covered: Covered,
  /** The slowest, slowest first: at most 20. */
  slowest: Schema.Array(KeptRunRow),
  /** The failed, newest first: at most 20. */
  failed: Schema.Array(KeptRunRow),
})
export type KeptRuns = typeof KeptRuns.Type
