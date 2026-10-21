import { Schema } from "effect"

/**
 * A trace, one run and what it caused across services: a W3C trace ID as OpenTelemetry sends it, 32
 * lowercase hex digits, not all zero.
 */
export const TraceId = Schema.String.check(
  Schema.isPattern(/^(?!0{32}$)[0-9a-f]{32}$/, { expected: "32 lowercase hex digits, not all zero" }),
).pipe(Schema.brand("TraceId"))
export type TraceId = typeof TraceId.Type
