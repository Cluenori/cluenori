/**
 * Reads OpenTelemetry's OTLP/HTTP exports, protobuf bodies, into plain data, writes such data back
 * as exports, and writes the answers exporters expect. Traces and logs; metrics only by their framing, for now.
 */
export type { AnyValue, Attributes, InstrumentationScope } from "./common.ts"
export { encodeLogs, encodeTraces } from "./encode.ts"
export { exportResponse, protobufContentType } from "./export-response.ts"
export type { LogRecord, ResourceLogs, ScopeLogs } from "./logs.ts"
export { decodeLogs } from "./logs.ts"
export { countResourceMetrics } from "./metrics.ts"
export { OtlpInvalid } from "./otlp-invalid.ts"
export type { ResourceSpans, ScopeSpans, Span, SpanEvent, SpanKind, SpanStatus } from "./traces.ts"
export { decodeTraces } from "./traces.ts"
