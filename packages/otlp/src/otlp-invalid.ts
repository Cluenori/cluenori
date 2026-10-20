import { Schema } from "effect"

/** The body isn't the OTLP message it should be. `message` says what is wrong and where. */
export class OtlpInvalid extends Schema.TaggedError<OtlpInvalid>()("OtlpInvalid", {
  message: Schema.String,
}) {}
