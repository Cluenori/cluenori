import { assert, describe, it } from "@effect/vitest"
import { DateTime, Effect, Schema } from "effect"

import { Actor, Caller, Envelope } from "../src/index.ts"

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
      for (const kind of ["event", "operation", "span", "log", "error", "activity", "cost", "money", "uptime.check"]) {
        const envelope = yield* Schema.decodeEffect(Envelope)({ ...exportCompleted, kind })
        assert.strictEqual(envelope.kind, kind)
      }
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

describe("actors and callers", () => {
  it.effect("keeps each actor's tag and identity, and refuses missing identities or unknown tags", () =>
    Effect.gen(function* () {
      const id = "0199f7a2-5c1e-7d3a-9b2f-4e8a1c6d0f53"
      for (const _tag of ["Member", "Person", "AgentRun"] as const) {
        const actor = yield* Schema.decodeEffect(Actor)({ _tag, id })
        const encoded = yield* Schema.encodeEffect(Actor)(actor)
        assert.deepStrictEqual(encoded, { _tag, id })
        const refused = yield* Schema.decodeUnknownEffect(Actor)({ _tag }).pipe(Effect.flip)
        assert.strictEqual(refused._tag, "SchemaError")
      }
      const system = { _tag: "System", process: "releases.store-sync" } as const
      const actor = yield* Schema.decodeEffect(Actor)(system)
      const encoded = yield* Schema.encodeEffect(Actor)(actor)
      assert.deepStrictEqual(encoded, system)
      for (const invalid of [{ _tag: "System" }, { _tag: "System", process: "Bad Process" }, { _tag: "Unknown", id }]) {
        const refused = yield* Schema.decodeUnknownEffect(Actor)(invalid).pipe(Effect.flip)
        assert.strictEqual(refused._tag, "SchemaError")
      }
    }),
  )

  it.effect("keeps known caller context and leaves unknown context absent", () =>
    Effect.gen(function* () {
      for (const context of [{}, { address: "192.0.2.1", country: "PL", userAgent: "Cluenori/1.0 (12) iOS/27.1" }]) {
        const caller = yield* Schema.decodeEffect(Caller)(context)
        assert.deepStrictEqual(caller, context)
      }
    }),
  )
})
