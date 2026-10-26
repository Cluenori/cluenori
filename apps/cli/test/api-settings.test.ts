import { assert, describe, it } from "@effect/vitest"
import { Effect, Schema } from "effect"

import { CloudflareAccountId, Hostname, Jurisdiction, SavedDeployment } from "../src/api-settings.ts"

describe("deployment settings", () => {
  it.effect("accepts hostnames at the label and total-length limits", () =>
    Effect.gen(function* () {
      const hostnames = [
        "a.co",
        "app.example.com",
        "notes-2.example.com",
        "1.example.com",
        `${"a".repeat(63)}.example.com`,
        `app.${"z".repeat(63)}`,
        `${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(61)}`,
      ]
      for (const hostname of hostnames) {
        const decoded = yield* Schema.decodeEffect(Hostname)(hostname)
        assert.strictEqual(decoded, hostname)
      }
    }),
  )

  it.effect("refuses URLs, malformed labels, and hostnames just beyond either length limit", () =>
    Effect.gen(function* () {
      const hostnames = [
        "https://app.example.com",
        "!app.example.com",
        "app.example.com!",
        "App.example.com",
        "localhost",
        "app..example.com",
        "-app.example.com",
        "app-.example.com",
        "app_name.example.com",
        "app.c",
        "app.12",
        `${"a".repeat(64)}.example.com`,
        `app.${"z".repeat(64)}`,
        `${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(62)}`,
      ]
      for (const hostname of hostnames) {
        const refused = yield* Schema.decodeEffect(Hostname)(hostname).pipe(Effect.flip)
        assert.strictEqual(refused._tag, "SchemaError")
      }
    }),
  )

  it.effect("accepts only a whole, lowercase, 32-digit hexadecimal Cloudflare account ID", () =>
    Effect.gen(function* () {
      const account = "0123456789abcdef0123456789abcdef"
      const decoded = yield* Schema.decodeEffect(CloudflareAccountId)(account)
      assert.strictEqual(decoded, account)
      for (const invalid of [
        "",
        account.slice(1),
        `0${account}`,
        `!${account}`,
        `${account}!`,
        account.toUpperCase(),
        "g".repeat(32),
      ]) {
        const refused = yield* Schema.decodeEffect(CloudflareAccountId)(invalid).pipe(Effect.flip)
        assert.strictEqual(refused._tag, "SchemaError")
      }
    }),
  )

  it.effect("keeps the chosen jurisdiction and optional deployment fields when encoded again", () =>
    Effect.gen(function* () {
      for (const jurisdiction of ["global", "eu"] as const) {
        const minimal = yield* Schema.decodeEffect(SavedDeployment)({ jurisdiction })
        const minimalEncoded = yield* Schema.encodeEffect(SavedDeployment)(minimal)
        assert.deepStrictEqual(minimalEncoded, { jurisdiction })
        const saved = {
          jurisdiction,
          account: "0123456789abcdef0123456789abcdef",
          domain: "app.example.com",
          url: "https://app.example.com",
          token: "made-up-test-token",
        }
        const deployment = yield* Schema.decodeEffect(SavedDeployment)(saved)
        const encoded = yield* Schema.encodeEffect(SavedDeployment)(deployment)
        assert.deepStrictEqual(encoded, saved)
      }
      for (const jurisdiction of ["", "EU", "us"]) {
        const refused = yield* Schema.decodeUnknownEffect(Jurisdiction)(jurisdiction).pipe(Effect.flip)
        assert.strictEqual(refused._tag, "SchemaError")
      }
    }),
  )

  it.effect("does not bypass field validation when reading a saved deployment", () =>
    Effect.gen(function* () {
      for (const saved of [
        {},
        { jurisdiction: "us" },
        { jurisdiction: "eu", account: "not-an-account" },
        { jurisdiction: "eu", domain: "not a hostname" },
        { jurisdiction: "eu", url: 42 },
        { jurisdiction: "eu", token: 42 },
      ]) {
        const refused = yield* Schema.decodeUnknownEffect(SavedDeployment)(saved).pipe(Effect.flip)
        assert.strictEqual(refused._tag, "SchemaError")
      }
    }),
  )
})
