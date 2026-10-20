/**
 * Reads OpenTelemetry's OTLP/HTTP exports, protobuf bodies, into plain data, and writes the answers
 * exporters expect. Traces for now.
 */
export { exportResponse, protobufContentType } from "./export-response.ts"
export { OtlpInvalid } from "./otlp-invalid.ts"
export type {
  AnyValue,
  Attributes,
  InstrumentationScope,
  ResourceSpans,
  ScopeSpans,
  Span,
  SpanEvent,
  SpanKind,
  SpanStatus,
} from "./traces.ts"
export { decodeTraces } from "./traces.ts"
