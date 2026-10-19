import { assert, describe, it } from "@effect/vitest"
import { DateTime, Effect, Schema } from "effect"

import { Envelope } from "../src/index.ts"

// A product event as an SDK sends it: the scope keys it knows, and nothing it doesn't.
const exportCompleted = {
  id: "0199f7a2-5c1e-7d3a-9b2f-4e8a1c6d0f53",
  ts: "2026-10-19T08:15:30.250Z",
  kind: "event",
  name: "export.completed",
  workspace: "main",
  project: "notes",
  component: "notes-ios",
  environment: "production",
  release: "2.4.0+312",
  feature: "editor.export",
  person: "0199f7a1-0b7d-7c42-8e5a-3d9f1b2c4a60",
  installation: "0199f7a1-0b7d-7c42-8e5a-3d9f1b2c4a61",
  session: "0199f7a2-1111-7c42-8e5a-3d9f1b2c4a62",
  source: "sdk-ios",
  attrs: { format: "pdf", pages: 12, shared: false },
}

describe("Envelope", () => {
  it.effect("reads a product event as an SDK sends it, and writes it back unchanged", () =>
    Effect.gen(function* () {
      const envelope = yield* Schema.decodeEffect(Envelope)(exportCompleted)
      const written = yield* Schema.encodeEffect(Envelope)(envelope)

      assert.strictEqual(envelope.kind, "event")
      assert.isTrue(DateTime.Equivalence(envelope.ts, DateTime.makeUnsafe("2026-10-19T08:15:30.250Z")))
      assert.deepStrictEqual(written, exportCompleted)
    }),
  )

  it.effect("leaves an unknown key out, rather than guessing it", () =>
    Effect.gen(function* () {
      const envelope = yield* Schema.decodeEffect(Envelope)(exportCompleted)
      assert.notProperty(envelope, "account")
      assert.notProperty(envelope, "trace")
    }),
  )

  it.effect("accepts a kind a module adds, such as uptime.check", () =>
    Effect.gen(function* () {
      const envelope = yield* Schema.decodeEffect(Envelope)({ ...exportCompleted, kind: "uptime.check" })
      assert.strictEqual(envelope.kind, "uptime.check")
    }),
  )

  it.effect("refuses a kind nobody defined, such as metric", () =>
    Effect.gen(function* () {
      const error = yield* Schema.decodeEffect(Envelope)({ ...exportCompleted, kind: "metric" }).pipe(Effect.flip)
      assert.include(error.message, `at ["kind"]`)
    }),
  )

  it.effect("refuses an envelope without a workspace", () =>
    Effect.gen(function* () {
      const { workspace: _, ...withoutWorkspace } = exportCompleted
      const error = yield* Schema.decodeUnknownEffect(Envelope)(withoutWorkspace).pipe(Effect.flip)
      assert.include(error.message, `at ["workspace"]`)
    }),
  )
})
