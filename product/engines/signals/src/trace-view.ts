import type { Attributes, ResourceLogs, ResourceSpans, Span, SpanKind } from "@bagatka/otlp"
import { decodeLogs, decodeTraces } from "@bagatka/otlp"
import { ComponentKey, Period, TraceId } from "@cluenori/foundation"
import { DateTime, Effect, Schema } from "effect"

import type { ExportSignal } from "./exports.ts"
import { LogEntry, LogLevel, SpanId } from "./log-entry.ts"
import { entryOf, jsonOf, levelOf, timeOf } from "./read-logs.ts"

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
 * One request across services, from the archive: its spans in tree order, each subtree by start
 * time, and its logs, oldest first. `searched` is the time the archive was read for, around the time
 * asked about; `files` says how many of the archive's files for it were read, and how many weren't
 * because there were too many.
 */
export const TraceView = Schema.Struct({
  trace: TraceId,
  searched: Period,
  spans: Schema.Array(TraceSpan),
  logs: Schema.Array(TraceLog),
  files: Schema.Struct({ read: Count, unread: Count }),
})
export type TraceView = typeof TraceView.Type

/** One file of the archive, read back: which kind of export, from which component. */
export interface ArchiveFile {
  readonly signal: ExportSignal
  readonly component: ComponentKey
  readonly bytes: Uint8Array
}

const millisOf = (nanos: bigint) => Number(nanos / 1_000_000n)

const jsonAttributes = (attributes: Attributes) =>
  Object.fromEntries(Array.from(attributes, ([key, value]) => [key, jsonOf(value)] as const))

// Spans in tree order: each root by start time, then its subtree, depth first.
const treeOf = (spans: ReadonlyArray<{ readonly span: Span; readonly component: ComponentKey }>) => {
  const byStart = spans.toSorted((left, right) => Number(left.span.startTimeUnixNano - right.span.startTimeUnixNano))
  const ids = new Set(byStart.map((entry) => entry.span.spanId))
  const children = Map.groupBy(byStart, (entry) => entry.span.parentSpanId ?? "")
  const placed: Array<TraceSpan> = []
  const place = (entry: { readonly span: Span; readonly component: ComponentKey }, depth: number) => {
    const { span } = entry
    if (!Schema.is(SpanId)(span.spanId)) {
      return
    }
    const parent = span.parentSpanId
    placed.push({
      span: span.spanId,
      ...(parent !== undefined && Schema.is(SpanId)(parent) ? { parent } : {}),
      depth,
      name: span.name,
      kind: span.kind satisfies SpanKind,
      component: entry.component,
      start: DateTime.makeUnsafe(millisOf(span.startTimeUnixNano)),
      durationMs: Number(span.endTimeUnixNano - span.startTimeUnixNano) / 1_000_000,
      failed: span.status.code === "error",
      ...(span.status.message === "" ? {} : { statusMessage: span.status.message }),
      attributes: jsonAttributes(span.attributes),
      events: span.events.map((event) => ({
        name: event.name,
        time: DateTime.makeUnsafe(millisOf(event.timeUnixNano)),
        attributes: jsonAttributes(event.attributes),
      })),
    })
    for (const child of children.get(span.spanId) ?? []) {
      place(child, depth + 1)
    }
  }
  const roots = byStart.filter((entry) => entry.span.parentSpanId === undefined || !ids.has(entry.span.parentSpanId))
  for (const root of roots) {
    place(root, 0)
  }
  return placed
}

/**
 * The view of trace `trace` from archive files: its spans and logs, from every file given. Files are
 * Cluenori's own, so one that doesn't decode is a defect.
 */
export const traceViewOf = Effect.fn("traceViewOf")(function* (
  trace: TraceId,
  searched: Period,
  files: ReadonlyArray<ArchiveFile>,
  unread: number,
) {
  const spans: Array<{ readonly span: Span; readonly component: ComponentKey }> = []
  const logs: Array<TraceLog> = []
  for (const file of files) {
    if (file.signal === "traces") {
      const resources: ReadonlyArray<ResourceSpans> = yield* decodeTraces(file.bytes).pipe(Effect.orDie)
      for (const span of resources.flatMap((resource) => resource.scopeSpans.flatMap((scope) => scope.spans))) {
        if (span.traceId === trace) {
          spans.push({ span, component: file.component })
        }
      }
    }
    if (file.signal === "logs") {
      const resources: ReadonlyArray<ResourceLogs> = yield* decodeLogs(file.bytes).pipe(Effect.orDie)
      for (const { resource, scopeLogs } of resources) {
        for (const { scope, logRecords } of scopeLogs) {
          for (const record of logRecords.filter((candidate) => candidate.traceId === trace)) {
            const entry = yield* entryOf(record, timeOf(record, 0), scope.name, resource)
            const level = levelOf(record)
            logs.push({ ...entry, ...(level === undefined ? {} : { level }), component: file.component })
          }
        }
      }
    }
  }
  const view: TraceView = {
    trace,
    searched,
    spans: treeOf(spans),
    logs: logs.toSorted((left, right) => DateTime.toEpochMillis(left.time) - DateTime.toEpochMillis(right.time)),
    files: { read: files.length, unread },
  }
  return view
})
