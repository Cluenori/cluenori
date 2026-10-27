import { ComponentKey, EnvelopeName, EnvironmentKey, Instant, Period, ReleaseVersion } from "@cluenori/foundation"
import { Schema } from "effect"

import { KeptTrace } from "./kept-trace.ts"

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const Milliseconds = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))

/**
 * What to count: the operations that ran in `period`, optionally of one environment, one
 * component, one operation, or one release. Counts from before October 2026 have no release, so a
 * release finds none of them.
 */
export const OperationQuery = Schema.Struct({
  period: Period,
  environment: Schema.optionalKey(EnvironmentKey),
  component: Schema.optionalKey(ComponentKey),
  operation: Schema.optionalKey(EnvelopeName),
  release: Schema.optionalKey(ReleaseVersion),
})
export type OperationQuery = typeof OperationQuery.Type

/** Which releases to list: those that ran in `period`, optionally of one environment or component. */
export const ReleaseQuery = Schema.Struct({
  period: Period,
  environment: Schema.optionalKey(EnvironmentKey),
  component: Schema.optionalKey(ComponentKey),
})
export type ReleaseQuery = typeof ReleaseQuery.Type

/**
 * One release of a component in one environment, as its operations show it: from the start of the
 * first minute an operation of it ran in to the end of the last, over everything counted, not only
 * the period asked about.
 */
export const ReleaseRow = Schema.Struct({
  component: ComponentKey,
  /** Absent when the component didn't say. */
  environment: Schema.optionalKey(EnvironmentKey),
  release: ReleaseVersion,
  firstSeen: Instant,
  lastSeen: Instant,
}).annotate({ identifier: "ReleaseRow" })
export type ReleaseRow = typeof ReleaseRow.Type

/** The releases that ran in a period, the latest first seen first. */
export const ReleaseTable = Schema.Struct({
  rows: Schema.Array(ReleaseRow),
}).annotate({ identifier: "ReleaseTable" })
export type ReleaseTable = typeof ReleaseTable.Type

/** How wide each point of a series is. */
export const SeriesStep = Schema.Literals(["1m", "5m", "1h", "1d"]).annotate({ identifier: "SeriesStep" })
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
}).annotate({ identifier: "OperationRow" })
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
  dataUntil: Schema.optionalKey(Instant),
  /**
   * When the operations asked about last ran, whatever the period: the end of the last minute any
   * of them was counted in, of the component and operation asked about, in any environment and
   * release. Absent when none ever ran.
   */
  lastSeen: Schema.optionalKey(Instant),
}).annotate({ identifier: "OperationTable" })
export type OperationTable = typeof OperationTable.Type

/** What started in one step of a series, with how long it took, as an operation's row says. */
export const LoadPoint = Schema.Struct({
  start: Instant,
  count: Count,
  errors: Count,
  p50Ms: Milliseconds,
  p80Ms: Milliseconds,
  p95Ms: Milliseconds,
  p99Ms: Milliseconds,
}).annotate({ identifier: "LoadPoint" })
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
}).annotate({ identifier: "LoadSeries" })
export type LoadSeries = typeof LoadSeries.Type

/** A kept trace, and the component whose operation it is. */
export const KeptTraceRow = Schema.Struct({ ...KeptTrace.fields, component: ComponentKey }).annotate({
  identifier: "KeptTraceRow",
})
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
}).annotate({ identifier: "KeptTraces" })
export type KeptTraces = typeof KeptTraces.Type

/**
 * The minutes one operation ran in, oldest first: the start of each minute it ran in at least once.
 * A job's schedule shows in them.
 */
export const MinutesRan = Schema.Struct({
  component: ComponentKey,
  /** Absent when the component didn't say. */
  environment: Schema.optionalKey(EnvironmentKey),
  operation: EnvelopeName,
  minutes: Schema.Array(Instant),
})
export type MinutesRan = typeof MinutesRan.Type

/**
 * How many times one operation ran and failed in one hour and environment for the client that asked
 * for it: what a trace export counts of the spans whose baggage named their origin in
 * `cluenori.origin.component`. Spans that named none aren't counted here: they are the rest of the
 * operation's count.
 */
export const OriginOperationCounts = Schema.Struct({
  /** The start of the UTC hour they started in. */
  hour: Instant,
  /** The component the request came from, such as `notes-ios`. */
  origin: ComponentKey,
  operation: EnvelopeName,
  /** Absent when the component didn't say. */
  environment: Schema.optionalKey(EnvironmentKey),
  count: Count,
  errors: Count,
  totalMs: Milliseconds,
})
export type OriginOperationCounts = typeof OriginOperationCounts.Type

/** Which operations to split by origin: those that ran in `period`, optionally of one environment, component, or operation. */
export const OriginQuery = Schema.Struct({
  period: Period,
  environment: Schema.optionalKey(EnvironmentKey),
  component: Schema.optionalKey(ComponentKey),
  operation: Schema.optionalKey(EnvelopeName),
})
export type OriginQuery = typeof OriginQuery.Type

/** One operation's runs for one client over a period: how many, how many failed, and their average. */
export const OriginRow = Schema.Struct({
  component: ComponentKey,
  operation: EnvelopeName,
  origin: ComponentKey,
  count: Count,
  errors: Count,
  averageMs: Milliseconds,
}).annotate({ identifier: "OriginRow" })
export type OriginRow = typeof OriginRow.Type

/**
 * Operations split by the client that asked for them, the most first. `covered` is the period as
 * counted: whole UTC hours, so it may start before the period and end after it; absent when nothing
 * of it is kept (15 months).
 */
export const OriginTable = Schema.Struct({
  covered: Schema.optionalKey(Period),
  rows: Schema.Array(OriginRow),
}).annotate({ identifier: "OriginTable" })
export type OriginTable = typeof OriginTable.Type
