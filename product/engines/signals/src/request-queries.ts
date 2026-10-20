import { ComponentKey, EnvelopeName, EnvironmentKey, Period } from "@cluenori/foundation"
import { Schema } from "effect"

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const Milliseconds = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))

/** Which requests to count: those that started in `period`, optionally of one environment or component. */
export const RequestQuery = Schema.Struct({
  period: Period,
  environment: Schema.optionalKey(EnvironmentKey),
  component: Schema.optionalKey(ComponentKey),
})
export type RequestQuery = typeof RequestQuery.Type

/** How wide each point of a series is. */
export const SeriesStep = Schema.Literals(["1m", "5m", "1h", "1d"])
export type SeriesStep = typeof SeriesStep.Type

/** Requests by endpoint, with how long they took: one row of the endpoint table. */
export const EndpointRow = Schema.Struct({
  component: ComponentKey,
  /** Absent when the component didn't say. */
  environment: Schema.optionalKey(EnvironmentKey),
  endpoint: EnvelopeName,
  requests: Count,
  /** Requests whose status was an error. */
  errors: Count,
  averageMs: Milliseconds,
  /** Percentiles of the durations by nearest rank, each within 2%: p99 of fewer than 100 is the slowest. */
  p50Ms: Milliseconds,
  p80Ms: Milliseconds,
  p95Ms: Milliseconds,
  p99Ms: Milliseconds,
})
export type EndpointRow = typeof EndpointRow.Type

/**
 * What a count covers: the asked-for period cut to the counts still kept and to now, widened to
 * whole buckets. Periods of two days or less are counted by the minute, kept 14 days; longer ones
 * by the hour, kept 15 months. Absent when nothing of the period is kept.
 */
const Covered = Schema.optionalKey(Period)

/** Every endpoint's requests in a period, most requested first. */
export const EndpointTable = Schema.Struct({
  covered: Covered,
  rows: Schema.Array(EndpointRow),
  requests: Count,
  errors: Count,
  /** The end of the newest bucket with requests in it; absent when there are none. */
  dataUntil: Schema.optionalKey(Schema.DateTimeUtcFromString),
})
export type EndpointTable = typeof EndpointTable.Type

/** Requests that started in one step of a series. */
export const RequestPoint = Schema.Struct({
  start: Schema.DateTimeUtcFromString,
  requests: Count,
  errors: Count,
})
export type RequestPoint = typeof RequestPoint.Type

/**
 * Requests over time, one point per step that has requests, oldest first. A step without a point
 * had no requests reported, which is not the same as having none: the sender may have been silent.
 */
export const RequestSeries = Schema.Struct({
  covered: Covered,
  /** The step used: the one asked for, or an hour when that is finer than the counts' buckets. */
  step: SeriesStep,
  points: Schema.Array(RequestPoint),
})
export type RequestSeries = typeof RequestSeries.Type
