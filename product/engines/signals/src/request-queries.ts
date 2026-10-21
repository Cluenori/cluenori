import { ComponentKey, EnvelopeName, EnvironmentKey, Period } from "@cluenori/foundation"
import { Schema } from "effect"

import { KeptRequest } from "./request-counts.ts"

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const Milliseconds = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))

/**
 * Which requests to count: those that started in `period`, optionally of one environment, one
 * component, or one endpoint.
 */
export const RequestQuery = Schema.Struct({
  period: Period,
  environment: Schema.optionalKey(EnvironmentKey),
  component: Schema.optionalKey(ComponentKey),
  endpoint: Schema.optionalKey(EnvelopeName),
})
export type RequestQuery = typeof RequestQuery.Type

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

/** Where a component's requests are counted once it has 500 endpoints: names past that are counted here. */
export const otherEndpoints = EnvelopeName.make("(other endpoints)")

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

/** Requests that started in one step of a series, with how long they took, as an endpoint's row says. */
export const RequestPoint = Schema.Struct({
  start: Schema.DateTimeUtcFromString,
  requests: Count,
  errors: Count,
  p50Ms: Milliseconds,
  p80Ms: Milliseconds,
  p95Ms: Milliseconds,
  p99Ms: Milliseconds,
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

/** A kept request, and the component that answered it. */
export const KeptRequestRow = Schema.Struct({ ...KeptRequest.fields, component: ComponentKey })
export type KeptRequestRow = typeof KeptRequestRow.Type

/**
 * Requests worth opening, from those kept: of each endpoint, environment and hour, the five slowest
 * and the five slowest that failed, 14 days. Each opens with its trace ID. `covered` is the period
 * cut to the 14 days and to now; absent when nothing of it is kept.
 */
export const KeptRequests = Schema.Struct({
  covered: Covered,
  /** The slowest, slowest first: at most 20. */
  slowest: Schema.Array(KeptRequestRow),
  /** The failed, newest first: at most 20. */
  failed: Schema.Array(KeptRequestRow),
})
export type KeptRequests = typeof KeptRequests.Type
