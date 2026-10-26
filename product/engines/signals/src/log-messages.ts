import { ComponentKey, EnvironmentKey, Instant, Period, ReleaseVersion } from "@cluenori/foundation"
import { Schema } from "effect"

import { ErrorGroup, IndexedLevel } from "./error-groups.ts"
import { LogLevel, LogMessageId } from "./log-entry.ts"

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

/**
 * One log message: lines that are the same message, a warning or an error from one logger with one
 * template, or the same text but for its values. What it is and when it was first and last seen
 * don't depend on the period; `lines` is how many of its lines the period holds.
 */
export const LogMessage = Schema.Struct({
  id: LogMessageId,
  /** The level of its latest line: `warn`, or `error` or `fatal`, as a message is a warning or an error. */
  level: LogLevel,
  /** Its template, or its latest line's text, first line only, at most 200 characters. */
  title: Schema.String,
  /** The logger that writes it. */
  category: Schema.String,
  /** How many of its lines the period asked about holds, of those asked about. */
  lines: Count,
  firstSeen: Instant,
  /** The release it was first seen in; absent when that line didn't say. */
  firstRelease: Schema.optionalKey(ReleaseVersion),
  lastSeen: Instant,
  lastComponent: ComponentKey,
  lastEnvironment: Schema.optionalKey(EnvironmentKey),
  lastRelease: Schema.optionalKey(ReleaseVersion),
}).annotate({ identifier: "LogMessage" })
export type LogMessage = typeof LogMessage.Type

/**
 * Which log messages to show: those with lines in `period` at `minimumLevel` or above (`warn` when
 * absent), optionally of one environment, component, or release, and with `search` in the line's
 * message or exception, ignoring case for ASCII. Only the lines that match are counted.
 */
export const LogMessageQuery = Schema.Struct({
  period: Period,
  minimumLevel: Schema.optionalKey(IndexedLevel),
  search: Schema.optionalKey(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200))),
  environment: Schema.optionalKey(EnvironmentKey),
  component: Schema.optionalKey(ComponentKey),
  release: Schema.optionalKey(ReleaseVersion),
})
export type LogMessageQuery = typeof LogMessageQuery.Type

/**
 * The log messages of a period, those with the most lines first: at most 100, with `unshown` saying
 * how many more matched. `lines` counts every matching line, of every message. `covered` is the part
 * of the period that is kept, 90 days; absent when nothing of it is.
 */
export const LogMessageTable = Schema.Struct({
  covered: Schema.optionalKey(Period),
  messages: Schema.Array(LogMessage),
  unshown: Count,
  lines: Count,
}).annotate({ identifier: "LogMessageTable" })
export type LogMessageTable = typeof LogMessageTable.Type

/**
 * One log message, whatever the period, with how many lines of it the period holds; and the errors
 * those lines are occurrences of, the most frequent first, when it is an error.
 */
export const LogMessageDetail = Schema.Struct({
  message: LogMessage,
  errors: Schema.Array(ErrorGroup),
}).annotate({ identifier: "LogMessageDetail" })
export type LogMessageDetail = typeof LogMessageDetail.Type

/** The project has no log message with this ID: it never had one, or forgot it 15 months after it was last seen. */
export class LogMessageNotFound extends Schema.TaggedError<LogMessageNotFound>()("LogMessageNotFound", {
  // Not `message`, which is every error's text.
  logMessage: LogMessageId,
}) {}
