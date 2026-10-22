import { assert, describe, it } from "@effect/vitest"
import { Effect, Redacted } from "effect"

import { verifyWebhook } from "../src/index.ts"
import { subtle, utf8 } from "./web-crypto.ts"

// GitHub's own example, from "Validating webhook deliveries".
const secret = Redacted.make("It's a Secret to Everybody")
const body = utf8("Hello, World!")
const signature = "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17"

describe("verifyWebhook", () => {
  it.effect("takes a delivery its secret signed, as GitHub's example has it", () =>
    Effect.gen(function* () {
      const verified = yield* verifyWebhook(subtle, secret, body, signature)
      assert.isTrue(verified)
    }),
  )

  it.effect("refuses a tampered body, a tampered signature, a wrong secret, and a signature of the wrong length", () =>
    Effect.gen(function* () {
      const tamperedSignature = `${signature.slice(0, -1)}8`
      const results = yield* Effect.all([
        verifyWebhook(subtle, secret, utf8("Hello, World?"), signature),
        verifyWebhook(subtle, secret, body, tamperedSignature),
        verifyWebhook(subtle, Redacted.make("Another secret"), body, signature),
        verifyWebhook(subtle, secret, body, signature.slice(0, -2)),
        verifyWebhook(subtle, secret, body, `${signature}00`),
        verifyWebhook(subtle, secret, body, signature.slice("sha256=".length)),
        verifyWebhook(subtle, secret, body, "sha256=not hex at all"),
      ])
      assert.deepStrictEqual(results, [false, false, false, false, false, false, false])
    }),
  )
})
