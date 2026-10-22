import { ComponentKey, EnvironmentKey, Instant, Period, ReleaseVersion, TraceId } from "@cluenori/foundation"
import { Schema } from "effect"

import type { LogLevel } from "./log-entry.ts"
import { ErrorGroupId, LogLine } from "./log-entry.ts"
import { SeriesStep } from "./operation-queries.ts"

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

/** How an error group is grouped: `exception` by type and stack, `log` by logger and message. */
const ErrorKind = Schema.Literals(["exception", "log"]).annotate({ identifier: "ErrorKind" })

/** One error, as it shows in a list: what it is, where it happens, and how often. */
export const ErrorGroup = Schema.Struct({
  id: ErrorGroupId,
  kind: ErrorKind,
  title: Schema.String,
  /** Where it happens: the top frame of its stack, or the logger. */
  culprit: Schema.String,
  /** How often it happened in the period asked about. */
  occurrences: Count,
  firstSeen: Instant,
  /** The release it was first seen in; absent when that didn't say, or for errors first seen before October 2026. */
  firstRelease: Schema.optionalKey(ReleaseVersion),
  lastSeen: Instant,
  lastComponent: ComponentKey,
  lastEnvironment: Schema.optionalKey(EnvironmentKey),
  lastRelease: Schema.optionalKey(ReleaseVersion),
}).annotate({ identifier: "ErrorGroup" })
export type ErrorGroup = typeof ErrorGroup.Type

/**
 * Which errors to show: those that happened in `period`, optionally of one environment, component,
 * or release. Warnings and errors from before October 2026 without a release in their record have
 * none, so a release finds none of them.
 */
export const ErrorQuery = Schema.Struct({
  period: Period,
  environment: Schema.optionalKey(EnvironmentKey),
  component: Schema.optionalKey(ComponentKey),
  release: Schema.optionalKey(ReleaseVersion),
})
export type ErrorQuery = typeof ErrorQuery.Type

/**
 * The errors of a period, most frequent first. `covered` is the part of the period that is kept:
 * 90 days. Absent when nothing of the period is.
 */
export const ErrorTable = Schema.Struct({
  covered: Schema.optionalKey(Period),
  groups: Schema.Array(ErrorGroup),
  occurrences: Count,
}).annotate({ identifier: "ErrorTable" })
export type ErrorTable = typeof ErrorTable.Type

/** One error, and its latest occurrences in the period, newest first: at most 10. */
export const ErrorDetail = Schema.Struct({
  group: ErrorGroup,
  latest: Schema.Array(LogLine),
}).annotate({ identifier: "ErrorDetail" })
export type ErrorDetail = typeof ErrorDetail.Type

/** The project has no error with this ID. */
export class ErrorGroupNotFound extends Schema.TaggedError<ErrorGroupNotFound>()("ErrorGroupNotFound", {
  error: ErrorGroupId,
}) {}

/** The levels a search of warnings and errors can start from. */
export const IndexedLevel = Schema.Literals(["warn", "error", "fatal"]).annotate({ identifier: "IndexedLevel" })
export type IndexedLevel = typeof IndexedLevel.Type

/**
 * Which warnings and errors to show: those of `period` at `minimumLevel` or above (`warn` when
 * absent), with the filters given. `search` matches text in the message or the exception,
 * ignoring case for ASCII. `before` continues a page from an earlier answer's `next`.
 */
export const LogQuery = Schema.Struct({
  period: Period,
  minimumLevel: Schema.optionalKey(IndexedLevel),
  search: Schema.optionalKey(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200))),
  category: Schema.optionalKey(Schema.String),
  environment: Schema.optionalKey(EnvironmentKey),
  component: Schema.optionalKey(ComponentKey),
  release: Schema.optionalKey(ReleaseVersion),
  trace: Schema.optionalKey(TraceId),
  error: Schema.optionalKey(ErrorGroupId),
  before: Schema.optionalKey(Schema.Int),
})
export type LogQuery = typeof LogQuery.Type

/**
 * A page of warnings and errors, newest first: at most 100. `next` continues with older ones, when
 * there are more. Records below warning are kept only in the archive, which `trace` reads.
 */
export const LogPage = Schema.Struct({
  covered: Schema.optionalKey(Period),
  lines: Schema.Array(LogLine),
  next: Schema.optionalKey(Schema.Int),
}).annotate({ identifier: "LogPage" })
export type LogPage = typeof LogPage.Type

/** What warnings and errors are counted by: their level, their component, or their error group. */
export const LogCountsBy = Schema.Literals(["level", "component", "error"]).annotate({ identifier: "LogCountsBy" })
export type LogCountsBy = typeof LogCountsBy.Type

/**
 * Which warnings and errors to count over time: those of `period` at `minimumLevel` or above (`warn`
 * when absent), with the filters given, in steps of `step`, a series for each value of `by`.
 */
export const LogCountQuery = Schema.Struct({
  period: Period,
  step: SeriesStep,
  by: LogCountsBy,
  minimumLevel: Schema.optionalKey(IndexedLevel),
  environment: Schema.optionalKey(EnvironmentKey),
  component: Schema.optionalKey(ComponentKey),
  release: Schema.optionalKey(ReleaseVersion),
  error: Schema.optionalKey(ErrorGroupId),
})
export type LogCountQuery = typeof LogCountQuery.Type

/** How many warnings and errors there were in one step. */
export const LogCountPoint = Schema.Struct({ start: Instant, count: Count }).annotate({ identifier: "LogCountPoint" })
export type LogCountPoint = typeof LogCountPoint.Type

/**
 * One value's counts: a level (`warn`, `error`, or `fatal`), a component's key, or an error group's
 * ID, as `by` says; with its total, and a point for each step that had any, oldest first.
 */
export const LogCountSeries = Schema.Struct({
  key: Schema.String,
  total: Count,
  points: Schema.Array(LogCountPoint),
}).annotate({ identifier: "LogCountSeries" })
export type LogCountSeries = typeof LogCountSeries.Type

/**
 * Warnings and errors over time: a series for each value, the largest total first, at most 100. A step
 * without a point had none recorded. `covered` is the part of the period that is kept, 90 days; absent
 * when nothing of it is.
 */
export const LogCounts = Schema.Struct({
  covered: Schema.optionalKey(Period),
  step: SeriesStep,
  series: Schema.Array(LogCountSeries),
}).annotate({ identifier: "LogCounts" })
export type LogCounts = typeof LogCounts.Type

export const levelsFrom: Readonly<Record<IndexedLevel, ReadonlyArray<LogLevel>>> = {
  warn: ["warn", "error", "fatal"],
  error: ["error", "fatal"],
  fatal: ["fatal"],
}
