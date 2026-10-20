import { Effect } from "effect"

import type { AnyValue, Attributes, InstrumentationScope } from "./common.ts"
import { readKeyValue, readResource, readScope } from "./common.ts"
import { OtlpInvalid } from "./otlp-invalid.ts"
import type { Reader } from "./protobuf-reader.ts"
import {
  hexOf,
  readBytes,
  readerOf,
  readFixed32,
  readFixed64,
  readMessage,
  readString,
  readTag,
  readVarint,
  skip,
} from "./protobuf-reader.ts"

export type SpanKind = "unspecified" | "internal" | "server" | "client" | "producer" | "consumer"

const spanKinds: ReadonlyArray<SpanKind> = ["unspecified", "internal", "server", "client", "producer", "consumer"]

const statusCodes: ReadonlyArray<SpanStatus["code"]> = ["unset", "ok", "error"]

export interface SpanStatus {
  readonly code: "unset" | "ok" | "error"
  readonly message: string
}

export interface SpanEvent {
  readonly name: string
  readonly timeUnixNano: bigint
  readonly attributes: Attributes
}

/** One operation of a trace. IDs are lowercase hex of the bytes sent, which the caller validates. */
export interface Span {
  readonly traceId: string
  readonly spanId: string
  /** Absent for a trace's root span. */
  readonly parentSpanId: string | undefined
  readonly name: string
  readonly kind: SpanKind
  readonly startTimeUnixNano: bigint
  readonly endTimeUnixNano: bigint
  readonly attributes: Attributes
  readonly events: ReadonlyArray<SpanEvent>
  readonly status: SpanStatus
}

export interface ScopeSpans {
  readonly scope: InstrumentationScope
  readonly spans: ReadonlyArray<Span>
}

/** The spans of one resource, such as one instance of a service, with what describes it. */
export interface ResourceSpans {
  readonly resource: Attributes
  readonly scopeSpans: ReadonlyArray<ScopeSpans>
}

// Status: string message = 2; StatusCode code = 3.
const readStatus = (reader: Reader): SpanStatus => {
  let message = ""
  let code: SpanStatus["code"] = "unset"
  for (let tag = readTag(reader); tag !== undefined; tag = readTag(reader)) {
    if (tag.field === 2 && tag.wireType === 2) {
      message = readString(reader)
    } else if (tag.field === 3 && tag.wireType === 0) {
      code = statusCodes[readVarint(reader)] ?? "unset"
    } else {
      skip(reader, tag.wireType)
    }
  }
  return { code, message }
}

// Event: fixed64 time_unix_nano = 1; string name = 2; repeated KeyValue attributes = 3.
const readEvent = (reader: Reader): SpanEvent => {
  let name = ""
  let timeUnixNano = 0n
  const attributes = new Map<string, AnyValue>()
  for (let tag = readTag(reader); tag !== undefined; tag = readTag(reader)) {
    if (tag.field === 1 && tag.wireType === 1) {
      timeUnixNano = readFixed64(reader)
    } else if (tag.field === 2 && tag.wireType === 2) {
      name = readString(reader)
    } else if (tag.field === 3 && tag.wireType === 2) {
      readMessage(reader, (inner) => readKeyValue(inner, 0, attributes))
    } else {
      skip(reader, tag.wireType)
    }
  }
  return { name, timeUnixNano, attributes }
}

// Span: the fields below; trace_state, links, flags, and dropped counts are skipped.
const readSpan = (reader: Reader): Span => {
  let traceId = ""
  let spanId = ""
  let parentSpanId: string | undefined
  let name = ""
  let kind: SpanKind = "unspecified"
  let startTimeUnixNano = 0n
  let endTimeUnixNano = 0n
  let status: SpanStatus = { code: "unset", message: "" }
  const attributes = new Map<string, AnyValue>()
  const events: Array<SpanEvent> = []
  for (let tag = readTag(reader); tag !== undefined; tag = readTag(reader)) {
    if (tag.field === 1 && tag.wireType === 2) {
      traceId = hexOf(readBytes(reader))
    } else if (tag.field === 2 && tag.wireType === 2) {
      spanId = hexOf(readBytes(reader))
    } else if (tag.field === 4 && tag.wireType === 2) {
      const parent = readBytes(reader)
      parentSpanId = parent.length === 0 ? undefined : hexOf(parent)
    } else if (tag.field === 5 && tag.wireType === 2) {
      name = readString(reader)
    } else if (tag.field === 6 && tag.wireType === 0) {
      kind = spanKinds[readVarint(reader)] ?? "unspecified"
    } else if (tag.field === 7 && tag.wireType === 1) {
      startTimeUnixNano = readFixed64(reader)
    } else if (tag.field === 8 && tag.wireType === 1) {
      endTimeUnixNano = readFixed64(reader)
    } else if (tag.field === 9 && tag.wireType === 2) {
      readMessage(reader, (inner) => readKeyValue(inner, 0, attributes))
    } else if (tag.field === 11 && tag.wireType === 2) {
      events.push(readMessage(reader, readEvent))
    } else if (tag.field === 15 && tag.wireType === 2) {
      status = readMessage(reader, readStatus)
    } else if (tag.field === 16 && tag.wireType === 5) {
      readFixed32(reader)
    } else {
      skip(reader, tag.wireType)
    }
  }
  return { traceId, spanId, parentSpanId, name, kind, startTimeUnixNano, endTimeUnixNano, attributes, events, status }
}

// ScopeSpans: InstrumentationScope scope = 1; repeated Span spans = 2.
const readScopeSpans = (reader: Reader): ScopeSpans => {
  let scope: InstrumentationScope = { name: "", version: "" }
  const spans: Array<Span> = []
  for (let tag = readTag(reader); tag !== undefined; tag = readTag(reader)) {
    if (tag.field === 1 && tag.wireType === 2) {
      scope = readMessage(reader, readScope)
    } else if (tag.field === 2 && tag.wireType === 2) {
      spans.push(readMessage(reader, readSpan))
    } else {
      skip(reader, tag.wireType)
    }
  }
  return { scope, spans }
}

// ResourceSpans: Resource resource = 1; repeated ScopeSpans scope_spans = 2.
const readResourceSpans = (reader: Reader): ResourceSpans => {
  let resource: Attributes = new Map()
  const scopeSpans: Array<ScopeSpans> = []
  for (let tag = readTag(reader); tag !== undefined; tag = readTag(reader)) {
    if (tag.field === 1 && tag.wireType === 2) {
      resource = readMessage(reader, readResource)
    } else if (tag.field === 2 && tag.wireType === 2) {
      scopeSpans.push(readMessage(reader, readScopeSpans))
    } else {
      skip(reader, tag.wireType)
    }
  }
  return { resource, scopeSpans }
}

/**
 * Reads the body of an OTLP/HTTP trace export, `ExportTraceServiceRequest` as protobuf, into plain
 * data. Fails with `OtlpInvalid` when the bytes aren't such a message. Unknown fields are skipped, so
 * newer exporters still decode. Reads the whole body at once: the caller bounds its size.
 */
export const decodeTraces = (body: Uint8Array): Effect.Effect<ReadonlyArray<ResourceSpans>, OtlpInvalid> =>
  Effect.suspend(() => {
    const reader = readerOf(body)
    const resourceSpans: Array<ResourceSpans> = []
    for (let tag = readTag(reader); tag !== undefined; tag = readTag(reader)) {
      if (tag.field === 1 && tag.wireType === 2) {
        resourceSpans.push(readMessage(reader, readResourceSpans))
      } else {
        skip(reader, tag.wireType)
      }
    }
    return reader.problem === undefined
      ? Effect.succeed(resourceSpans)
      : Effect.fail(new OtlpInvalid({ message: reader.problem }))
  })
