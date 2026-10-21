import { Schema } from "effect"

/**
 * The document has something no Swift client is generated for: `path` is where, as a JSON pointer
 * such as `#/components/schemas/Phone/properties/lastSeen`, and `reason` says what and how to change
 * it, such as naming an inline object as a component.
 */
export class UnsupportedOpenApi extends Schema.TaggedError<UnsupportedOpenApi>()("UnsupportedOpenApi", {
  path: Schema.String,
  reason: Schema.String,
}) {}
