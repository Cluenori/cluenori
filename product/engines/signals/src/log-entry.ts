import { ComponentKey, EnvironmentKey, Instant, ReleaseVersion, TraceId } from "@cluenori/foundation"
import { Schema } from "effect"

/** How serious a log record is, from OTLP's severity: trace, debug, info, warn, error, fatal. */
export const LogLevel = Schema.Literals(["trace", "debug", "info", "warn", "error", "fatal"]).annotate({
  identifier: "LogLevel",
})
export type LogLevel = typeof LogLevel.Type

/** One operation of a trace: 16 lowercase hex digits, as OpenTelemetry sends it. */
export const SpanId = Schema.String.check(
  Schema.isPattern(/^(?!0{16}$)[0-9a-f]{16}$/, { expected: "16 lowercase hex digits, not all zero" }),
).pipe(Schema.brand("SpanId"))
export type SpanId = typeof SpanId.Type

/** An error group's ID: 16 hex digits of its fingerprint, the same in every project. */
export const ErrorGroupId = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{16}$/, { expected: "an error's ID: 16 lowercase hex digits" }),
).pipe(Schema.brand("ErrorGroupId"))
export type ErrorGroupId = typeof ErrorGroupId.Type

/** The exception a log record carries. */
export const LogException = Schema.Struct({
  type: Schema.String,
  message: Schema.String,
  stack: Schema.optionalKey(Schema.String),
}).annotate({ identifier: "LogException" })
export type LogException = typeof LogException.Type

/**
 * One log record, with secrets and personal data already removed: when it happened, how serious it
 * is, the logger that wrote it (its category), and what it said.
 */
export const LogEntry = Schema.Struct({
  time: Instant,
  level: LogLevel,
  category: Schema.String,
  message: Schema.String,
  /** The message before its values were filled in, such as `Export {ExportId} failed`, when sent. */
  template: Schema.optionalKey(Schema.String),
  environment: Schema.optionalKey(EnvironmentKey),
  release: Schema.optionalKey(ReleaseVersion),
  trace: Schema.optionalKey(TraceId),
  span: Schema.optionalKey(SpanId),
  exception: Schema.optionalKey(LogException),
  /** The error group of an error or fatal record. */
  error: Schema.optionalKey(ErrorGroupId),
  /** Everything else the record carried. */
  attributes: Schema.JsonObject,
})
export type LogEntry = typeof LogEntry.Type

/**
 * A log message's ID: a number from 1, larger for each message the project sees for the first
 * time, not always the next one; the same message has another ID in another project.
 */
export const LogMessageId = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).pipe(Schema.brand("LogMessageId"))
export type LogMessageId = typeof LogMessageId.Type

/**
 * A stored log record, with the component that sent it and the log message it is a line of. `id`
 * orders records as they were stored.
 */
export const LogLine = Schema.Struct({
  id: Schema.Int,
  component: ComponentKey,
  messageId: LogMessageId,
  ...LogEntry.fields,
}).annotate({ identifier: "LogLine" })
export type LogLine = typeof LogLine.Type
