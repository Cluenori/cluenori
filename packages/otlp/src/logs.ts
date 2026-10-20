import { Effect } from "effect"

import type { AnyValue, Attributes, InstrumentationScope } from "./common.ts"
import { readAnyValue, readKeyValue, readResource, readScope } from "./common.ts"
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

/** One log record. IDs are lowercase hex of the bytes sent, which the caller validates. */
export interface LogRecord {
  /** When it happened, in nanoseconds; 0 when the sender didn't say. */
  readonly timeUnixNano: bigint
  /** When the sender's SDK saw it; 0 when it didn't say. */
  readonly observedTimeUnixNano: bigint
  /** OTLP's severity, 1 to 24: 1–4 trace, 5–8 debug, 9–12 info, 13–16 warn, 17–20 error, 21–24 fatal; 0 when unknown. */
  readonly severityNumber: number
  /** The level as the sender names it, such as `Warning`; empty when it didn't. */
  readonly severityText: string
  /** What was logged; for most SDKs the formatted message as text. */
  readonly body: AnyValue
  readonly attributes: Attributes
  /** Absent when the record belongs to no trace. */
  readonly traceId: string | undefined
  readonly spanId: string | undefined
  /** The record's event name, such as .NET's event ID name `ApplicationError`; empty when none. */
  readonly eventName: string
}

export interface ScopeLogs {
  /** The logger, such as .NET's category `Microsoft.AspNetCore.Server.Kestrel`. */
  readonly scope: InstrumentationScope
  readonly logRecords: ReadonlyArray<LogRecord>
}

/** The log records of one resource, such as one instance of a service, with what describes it. */
export interface ResourceLogs {
  readonly resource: Attributes
  readonly scopeLogs: ReadonlyArray<ScopeLogs>
}

const idOf = (bytes: Uint8Array) => (bytes.length === 0 ? undefined : hexOf(bytes))

// LogRecord: the fields below; dropped counts are skipped.
const readLogRecord = (reader: Reader): LogRecord => {
  let timeUnixNano = 0n
  let observedTimeUnixNano = 0n
  let severityNumber = 0
  let severityText = ""
  let body: AnyValue = null
  let traceId: string | undefined
  let spanId: string | undefined
  let eventName = ""
  const attributes = new Map<string, AnyValue>()
  for (let tag = readTag(reader); tag !== undefined; tag = readTag(reader)) {
    if (tag.field === 1 && tag.wireType === 1) {
      timeUnixNano = readFixed64(reader)
    } else if (tag.field === 11 && tag.wireType === 1) {
      observedTimeUnixNano = readFixed64(reader)
    } else if (tag.field === 2 && tag.wireType === 0) {
      severityNumber = readVarint(reader)
    } else if (tag.field === 3 && tag.wireType === 2) {
      severityText = readString(reader)
    } else if (tag.field === 5 && tag.wireType === 2) {
      body = readMessage(reader, (inner) => readAnyValue(inner, 0))
    } else if (tag.field === 6 && tag.wireType === 2) {
      readMessage(reader, (inner) => readKeyValue(inner, 0, attributes))
    } else if (tag.field === 8 && tag.wireType === 5) {
      readFixed32(reader)
    } else if (tag.field === 9 && tag.wireType === 2) {
      traceId = idOf(readBytes(reader))
    } else if (tag.field === 10 && tag.wireType === 2) {
      spanId = idOf(readBytes(reader))
    } else if (tag.field === 12 && tag.wireType === 2) {
      eventName = readString(reader)
    } else {
      skip(reader, tag.wireType)
    }
  }
  return {
    timeUnixNano,
    observedTimeUnixNano,
    severityNumber,
    severityText,
    body,
    attributes,
    traceId,
    spanId,
    eventName,
  }
}

// ScopeLogs: InstrumentationScope scope = 1; repeated LogRecord log_records = 2.
const readScopeLogs = (reader: Reader): ScopeLogs => {
  let scope: InstrumentationScope = { name: "", version: "" }
  const logRecords: Array<LogRecord> = []
  for (let tag = readTag(reader); tag !== undefined; tag = readTag(reader)) {
    if (tag.field === 1 && tag.wireType === 2) {
      scope = readMessage(reader, readScope)
    } else if (tag.field === 2 && tag.wireType === 2) {
      logRecords.push(readMessage(reader, readLogRecord))
    } else {
      skip(reader, tag.wireType)
    }
  }
  return { scope, logRecords }
}

// ResourceLogs: Resource resource = 1; repeated ScopeLogs scope_logs = 2.
const readResourceLogs = (reader: Reader): ResourceLogs => {
  let resource: Attributes = new Map()
  const scopeLogs: Array<ScopeLogs> = []
  for (let tag = readTag(reader); tag !== undefined; tag = readTag(reader)) {
    if (tag.field === 1 && tag.wireType === 2) {
      resource = readMessage(reader, readResource)
    } else if (tag.field === 2 && tag.wireType === 2) {
      scopeLogs.push(readMessage(reader, readScopeLogs))
    } else {
      skip(reader, tag.wireType)
    }
  }
  return { resource, scopeLogs }
}

/**
 * Reads the body of an OTLP/HTTP log export, `ExportLogsServiceRequest` as protobuf, into plain
 * data. Fails with `OtlpInvalid` when the bytes aren't such a message. Unknown fields are skipped.
 * Reads the whole body at once: the caller bounds its size.
 */
export const decodeLogs = (body: Uint8Array): Effect.Effect<ReadonlyArray<ResourceLogs>, OtlpInvalid> =>
  Effect.suspend(() => {
    const reader = readerOf(body)
    const resourceLogs: Array<ResourceLogs> = []
    for (let tag = readTag(reader); tag !== undefined; tag = readTag(reader)) {
      if (tag.field === 1 && tag.wireType === 2) {
        resourceLogs.push(readMessage(reader, readResourceLogs))
      } else {
        skip(reader, tag.wireType)
      }
    }
    return reader.problem === undefined
      ? Effect.succeed(resourceLogs)
      : Effect.fail(new OtlpInvalid({ message: reader.problem }))
  })
