import { ComponentKey, Instant, Period, TraceId } from "@cluenori/foundation"
import { Schema } from "effect"

import { LogEntry, LogLevel, SpanId } from "./log-entry.ts"

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

/** What a span is, as OpenTelemetry says: `server` for a request it answered, `consumer` for a message. */
const SpanKind = Schema.Literals(["unspecified", "internal", "server", "client", "producer", "consumer"]).annotate({
  identifier: "SpanKind",
})

/** Something that happened during a span, at a moment: an exception it recorded, a retry. */
const SpanEvent = Schema.Struct({ name: Schema.String, time: Instant, attributes: Schema.JsonObject }).annotate({
  identifier: "SpanEvent",
})

/** One operation of a trace, placed in its tree: `depth` 0 for a root, 1 for its children, and on. */
export const TraceSpan = Schema.Struct({
  span: SpanId,
  parent: Schema.optionalKey(SpanId),
  depth: Count,
  name: Schema.String,
  kind: SpanKind,
  component: ComponentKey,
  start: Instant,
  durationMs: Schema.Finite,
  failed: Schema.Boolean,
  statusMessage: Schema.optionalKey(Schema.String),
  attributes: Schema.JsonObject,
  events: Schema.Array(SpanEvent),
}).annotate({ identifier: "TraceSpan" })
export type TraceSpan = typeof TraceSpan.Type

/** A log record of a trace, at any level; absent when the sender gave none. */
export const TraceLog = Schema.Struct({
  ...LogEntry.fields,
  level: Schema.optionalKey(LogLevel),
  component: ComponentKey,
}).annotate({ identifier: "TraceLog" })
export type TraceLog = typeof TraceLog.Type

/** How many of the archive files that hold a trace were read, and how many weren't. */
const SearchedFiles = Schema.Struct({ read: Count, unread: Count }).annotate({ identifier: "SearchedFiles" })

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
  files: SearchedFiles,
}).annotate({ identifier: "TraceView" })
export type TraceView = typeof TraceView.Type
