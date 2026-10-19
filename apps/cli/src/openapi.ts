import { CluenoriApi } from "@cluenori/worker"
import { Effect, Schema } from "effect"
import { OpenApi } from "effect/http-api"

/** Where the committed OpenAPI document lives; the Swift and Kotlin SDKs build from it. */
export const openApiPath = "apps/worker/openapi.json"

const JsonText = Schema.fromJsonString(Schema.Unknown, { space: 2 })

/** The public API's OpenAPI document, as the text `bun run generate` writes. */
export const openApiDocument = Schema.encodeEffect(JsonText)(OpenApi.fromApi(CluenoriApi)).pipe(
  Effect.map((text) => `${text}\n`),
  // Plain JSON data always encodes.
  Effect.orDie,
)
