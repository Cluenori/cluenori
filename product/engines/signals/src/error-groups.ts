import { ComponentKey, EnvironmentKey, Period, ReleaseVersion, TraceId } from "@cluenori/foundation"
import { Schema } from "effect"

import type { LogLevel } from "./log-entry.ts"
import { ErrorGroupId, LogLine } from "./log-entry.ts"

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

/** One error, as it shows in a list: what it is, where it happens, and how often. */
export const ErrorGroup = Schema.Struct({
  id: ErrorGroupId,
  /** `exception` when grouped by type and stack, `log` when by logger and message. */
  kind: Schema.Literals(["exception", "log"]),
  title: Schema.String,
  /** Where it happens: the top frame of its stack, or the logger. */
  culprit: Schema.String,
  /** How often it happened in the period asked about. */
  occurrences: Count,
  firstSeen: Schema.DateTimeUtcFromString,
  lastSeen: Schema.DateTimeUtcFromString,
  lastComponent: ComponentKey,
  lastEnvironment: Schema.optionalKey(EnvironmentKey),
  lastRelease: Schema.optionalKey(ReleaseVersion),
})
export type ErrorGroup = typeof ErrorGroup.Type

/** Which errors to show: those that happened in `period`, optionally of one environment or component. */
export const ErrorQuery = Schema.Struct({
  period: Period,
  environment: Schema.optionalKey(EnvironmentKey),
  component: Schema.optionalKey(ComponentKey),
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
})
export type ErrorTable = typeof ErrorTable.Type

/** One error, and its latest occurrences in the period, newest first: at most 10. */
export const ErrorDetail = Schema.Struct({
  group: ErrorGroup,
  latest: Schema.Array(LogLine),
})
export type ErrorDetail = typeof ErrorDetail.Type

/** The project has no error with this ID. */
export class ErrorGroupNotFound extends Schema.TaggedError<ErrorGroupNotFound>()("ErrorGroupNotFound", {
  error: ErrorGroupId,
}) {}

/** The levels a search of warnings and errors can start from. */
export const IndexedLevel = Schema.Literals(["warn", "error", "fatal"])
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
})
export type LogPage = typeof LogPage.Type

export const levelsFrom: Readonly<Record<IndexedLevel, ReadonlyArray<LogLevel>>> = {
  warn: ["warn", "error", "fatal"],
  error: ["error", "fatal"],
  fatal: ["fatal"],
}
