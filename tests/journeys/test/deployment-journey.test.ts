import { assert, layer } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { HttpClient } from "effect/http"

import { baseUrl, CluenoriClient } from "./cluenori-client.ts"

// The first thing anyone does with a deployment: check that it serves, and see what it offers.
layer(CluenoriClient.layer)("deployment", (it) => {
  it.effect("answers its health check, unauthenticated, with its storage read and nothing said", () =>
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      yield* client.health()
      const http = yield* HttpClient.HttpClient
      const response = yield* http.get(`${baseUrl}/api/health`)
      assert.strictEqual(response.status, 204)
      assert.strictEqual(yield* response.text, "")
    }),
  )

  it.effect("describes its API in the OpenAPI document", () =>
    Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient
      const response = yield* http.get(`${baseUrl}/api/openapi.json`)
      const body = yield* response.json
      const document = yield* Schema.decodeUnknownEffect(
        Schema.Struct({ openapi: Schema.String, paths: Schema.Record(Schema.String, Schema.Unknown) }),
      )(body)
      assert.strictEqual(response.status, 200)
      assert.include(Object.keys(document.paths), "/api/health")
    }),
  )

  it.effect("answers 404 for a path the API doesn't have", () =>
    Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient
      const response = yield* http.get(`${baseUrl}/api/no-such-thing`)
      assert.strictEqual(response.status, 404)
    }),
  )
})
