import { Schema, SchemaTransformation } from "effect"

/**
 * A moment in time: a `DateTime.Utc` in code, and on the wire and in storage an ISO 8601 UTC string,
 * `2026-10-21T10:00:00.000Z`, which the OpenAPI document marks `format: date-time` so other
 * languages' clients read it as a date. Decoding takes any date-time `DateTime.make` reads, one
 * without a zone as UTC.
 */
export const Instant = Schema.String.annotate({
  format: "date-time",
  expected: "an ISO 8601 date-time, such as 2026-10-21T10:00:00Z",
}).pipe(Schema.decodeTo(Schema.DateTimeUtc, SchemaTransformation.dateTimeUtcFromString))
