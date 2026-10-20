import type { AnyValue, Attributes, InstrumentationScope } from "./common.ts"
import type { LogRecord, ResourceLogs, ScopeLogs } from "./logs.ts"
import type { Bytes } from "./protobuf-writer.ts"
import {
  bytesField,
  doubleField,
  fixed64Field,
  hexBytes,
  presentVarintField,
  stringField,
  textBytes,
  varintField,
} from "./protobuf-writer.ts"
import type { ResourceSpans, ScopeSpans, Span, SpanEvent, SpanKind, SpanStatus } from "./traces.ts"

const spanKinds: Readonly<Record<SpanKind, number>> = {
  unspecified: 0,
  internal: 1,
  server: 2,
  client: 3,
  producer: 4,
  consumer: 5,
}

const statusCodes: Readonly<Record<SpanStatus["code"], number>> = { unset: 0, ok: 1, error: 2 }

const isAttributes = (value: AnyValue): value is Attributes => value instanceof Map

// AnyValue is a oneof: string 1, bool 2, int 3, double 4, array 5, kvlist 6, bytes 7. An integer
// becomes an int and any other number a double, since decoding made both numbers.
const anyValue = (value: AnyValue): Bytes => {
  if (value === null) {
    return []
  }
  if (typeof value === "string") {
    return bytesField(1, textBytes(value))
  }
  if (typeof value === "boolean") {
    return presentVarintField(2, value ? 1 : 0)
  }
  if (typeof value === "number") {
    return Number.isSafeInteger(value) ? presentVarintField(3, BigInt(value)) : doubleField(4, value)
  }
  if (value instanceof Uint8Array) {
    return bytesField(7, value)
  }
  if (isAttributes(value)) {
    return bytesField(6, attributeList(value))
  }
  return bytesField(
    5,
    value.flatMap((item) => bytesField(1, anyValue(item))),
  )
}

// KeyValue: string key = 1; AnyValue value = 2. A list of them is `repeated KeyValue = 1`.
const keyValue = (field: number, key: string, value: AnyValue): Bytes =>
  bytesField(field, [...stringField(1, key), ...bytesField(2, anyValue(value))])

const attributeList = (attributes: Attributes): Bytes =>
  [...attributes].flatMap(([key, value]) => keyValue(1, key, value))

const attributesField = (field: number, attributes: Attributes): Bytes =>
  [...attributes].flatMap(([key, value]) => keyValue(field, key, value))

const scope = (instrumentation: InstrumentationScope): Bytes =>
  bytesField(1, [...stringField(1, instrumentation.name), ...stringField(2, instrumentation.version)])

const status = (spanStatus: SpanStatus): Bytes =>
  spanStatus.code === "unset" && spanStatus.message === ""
    ? []
    : bytesField(15, [...stringField(2, spanStatus.message), ...varintField(3, statusCodes[spanStatus.code])])

const event = (spanEvent: SpanEvent): Bytes =>
  bytesField(11, [
    ...fixed64Field(1, spanEvent.timeUnixNano),
    ...stringField(2, spanEvent.name),
    ...attributesField(3, spanEvent.attributes),
  ])

const span = (one: Span): Bytes =>
  bytesField(2, [
    ...bytesField(1, hexBytes(one.traceId)),
    ...bytesField(2, hexBytes(one.spanId)),
    ...(one.parentSpanId === undefined ? [] : bytesField(4, hexBytes(one.parentSpanId))),
    ...stringField(5, one.name),
    ...varintField(6, spanKinds[one.kind]),
    ...fixed64Field(7, one.startTimeUnixNano),
    ...fixed64Field(8, one.endTimeUnixNano),
    ...attributesField(9, one.attributes),
    ...one.events.flatMap(event),
    ...status(one.status),
  ])

const scopeSpans = (spans: ScopeSpans): Bytes => bytesField(2, [...scope(spans.scope), ...spans.spans.flatMap(span)])

/**
 * The protobuf body of an OTLP/HTTP trace export of `resourceSpans`: what `decodeTraces` reads, so
 * decoding it gives the same data back. Fields `decodeTraces` skips (trace state, links, flags,
 * dropped counts, schema URLs) aren't written.
 */
export const encodeTraces = (resourceSpans: ReadonlyArray<ResourceSpans>): Uint8Array =>
  Uint8Array.from(
    resourceSpans.flatMap((resource) =>
      bytesField(1, [
        ...bytesField(1, attributesField(1, resource.resource)),
        ...resource.scopeSpans.flatMap(scopeSpans),
      ]),
    ),
  )

const logRecord = (record: LogRecord): Bytes =>
  bytesField(2, [
    ...fixed64Field(1, record.timeUnixNano),
    ...varintField(2, record.severityNumber),
    ...stringField(3, record.severityText),
    ...(record.body === null ? [] : bytesField(5, anyValue(record.body))),
    ...attributesField(6, record.attributes),
    ...(record.traceId === undefined ? [] : bytesField(9, hexBytes(record.traceId))),
    ...(record.spanId === undefined ? [] : bytesField(10, hexBytes(record.spanId))),
    ...fixed64Field(11, record.observedTimeUnixNano),
    ...stringField(12, record.eventName),
  ])

const scopeLogs = (logs: ScopeLogs): Bytes =>
  bytesField(2, [...scope(logs.scope), ...logs.logRecords.flatMap(logRecord)])

/**
 * The protobuf body of an OTLP/HTTP log export of `resourceLogs`: what `decodeLogs` reads, so
 * decoding it gives the same data back. Fields `decodeLogs` skips aren't written.
 */
export const encodeLogs = (resourceLogs: ReadonlyArray<ResourceLogs>): Uint8Array =>
  Uint8Array.from(
    resourceLogs.flatMap((resource) =>
      bytesField(1, [
        ...bytesField(1, attributesField(1, resource.resource)),
        ...resource.scopeLogs.flatMap(scopeLogs),
      ]),
    ),
  )
