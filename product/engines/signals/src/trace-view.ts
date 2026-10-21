import { ComponentKey, Period, TraceId } from "@cluenori/foundation"
import { Schema } from "effect"

import { LogEntry, LogLevel, SpanId } from "./log-entry.ts"

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

/** One operation of a trace, placed in its tree: `depth` 0 for a root, 1 for its children, and on. */
export const TraceSpan = Schema.Struct({
  span: SpanId,
  parent: Schema.optionalKey(SpanId),
  depth: Count,
  name: Schema.String,
  kind: Schema.Literals(["unspecified", "internal", "server", "client", "producer", "consumer"]),
  component: ComponentKey,
  start: Schema.DateTimeUtcFromString,
  durationMs: Schema.Finite,
  failed: Schema.Boolean,
  statusMessage: Schema.optionalKey(Schema.String),
  attributes: Schema.JsonObject,
  events: Schema.Array(
    Schema.Struct({ name: Schema.String, time: Schema.DateTimeUtcFromString, attributes: Schema.JsonObject }),
  ),
})
export type TraceSpan = typeof TraceSpan.Type

/** A log record of a trace, at any level; absent when the sender gave none. */
export const TraceLog = Schema.Struct({
  ...LogEntry.fields,
  level: Schema.optionalKey(LogLevel),
  component: ComponentKey,
})
export type TraceLog = typeof TraceLog.Type

/**
 * One trace across services, from the archive: its spans in tree order, each subtree by start
 * time, and its logs, oldest first. `searched` is when the records of the archive files that hold
 * it span, or, when none is kept, the 90 days the archive keeps; `files` says how many of those
 * files were read, and how many weren't because there were too many.
 */
export const TraceView = Schema.Struct({
  trace: TraceId,
  searched: Period,
  spans: Schema.Array(TraceSpan),
  logs: Schema.Array(TraceLog),
  files: Schema.Struct({ read: Count, unread: Count }),
})
export type TraceView = typeof TraceView.Type
