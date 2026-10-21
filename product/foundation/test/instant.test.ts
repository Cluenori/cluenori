import { assert, describe, it } from "@effect/vitest"
import { DateTime, Effect, Schema } from "effect"

import { Instant } from "../src/index.ts"

describe("Instant", () => {
  it.effect("is an ISO 8601 UTC string on the wire, read as UTC from any zone", () =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeEffect(Instant)("2026-10-21T12:00:00+02:00")
      assert.strictEqual(DateTime.toEpochMillis(decoded), 1792576800000)
      assert.strictEqual(yield* Schema.encodeEffect(Instant)(decoded), "2026-10-21T10:00:00.000Z")
      assert.isTrue((yield* Schema.decodeEffect(Instant)("yesterday").pipe(Effect.flip))._tag === "SchemaError")
    }),
  )

  it("tells other languages it is a date-time", () => {
    assert.deepStrictEqual(Schema.toJsonSchemaDocument(Instant).schema, { type: "string", format: "date-time" })
  })
})
