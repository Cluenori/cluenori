import { BunCrypto } from "@effect/platform-bun"
import { assert, describe, it } from "@effect/vitest"
import { ConfigProvider, Effect, FileSystem, Layer, Option, Path, Redacted, Schema } from "effect"

import {
  apiTarget,
  CloudflareAccountId,
  ensureLocalApiSettings,
  Hostname,
  Jurisdiction,
  saveDeployment,
  savedDeployment,
  SavedDeployment,
} from "../src/api-settings.ts"

const devVars = "apps/worker/.dev.vars"
const localToken = "existing-local-token=="
const owner = "01953e30-0000-7000-8000-000000000001"
const localSettings = `CLUENORI_API_TOKEN=${localToken}\nCLUENORI_OWNER=${owner}\nCLUENORI_PLAIN_HTTP=local\n`

// Only the filesystem and environment are fake; settings are parsed, generated and saved normally.
const settingsLayer = (files: Map<string, string>, env: Readonly<Record<string, string>>) =>
  Layer.mergeAll(
    BunCrypto.layer,
    Path.layer,
    ConfigProvider.layer(ConfigProvider.fromEnvRecord(env)),
    FileSystem.layerNoop({
      exists: (path) => Effect.succeed(files.has(path)),
      readFileString: (path) =>
        Effect.sync(() => {
          const text = files.get(path)
          assert.isDefined(text, `Missing test file: ${path}`)
          return text
        }),
      makeDirectory: () => Effect.void,
      writeFileString: (path, text) => Effect.sync(() => void files.set(path, text)),
    }),
  )

describe("deployment settings", () => {
  it.effect("adds only missing local settings, preserving other lines and credentials across repeated runs", () =>
    Effect.gen(function* () {
      const cases = [
        undefined,
        "",
        "OTHER=kept",
        "\nOTHER=kept",
        "OTHER=kept\n",
        `  #CLUENORI_API_TOKEN=commented\n  CLUENORI_API_TOKEN=${localToken}  \nignored line`,
        `CLUENORI_OWNER=${owner}\n`,
        "CLUENORI_PLAIN_HTTP=custom\n",
        localSettings,
      ]
      for (const initial of cases) {
        const files = new Map(initial === undefined ? [] : [[devVars, initial]])
        yield* Effect.gen(function* () {
          yield* ensureLocalApiSettings
          const text = files.get(devVars)
          assert.isDefined(text)
          assert.isTrue(text.startsWith(initial ?? ""))
          const token =
            initial?.includes(`CLUENORI_API_TOKEN=${localToken}`) === true
              ? `CLUENORI_API_TOKEN=${localToken}`
              : "CLUENORI_API_TOKEN=[A-Za-z0-9_-]{43}"
          assert.match(text, new RegExp(`^\\s*${token} *$`, "m"))
          assert.match(text, /^CLUENORI_OWNER=[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/m)
          if (initial?.includes(`CLUENORI_OWNER=${owner}`) === true) {
            assert.include(text, `CLUENORI_OWNER=${owner}`)
          }
          assert.include(
            text,
            initial?.includes("CLUENORI_PLAIN_HTTP=custom") === true
              ? "CLUENORI_PLAIN_HTTP=custom"
              : "CLUENORI_PLAIN_HTTP=local",
          )
          assert.isTrue(text.endsWith("\n"))
          yield* ensureLocalApiSettings
          assert.strictEqual(files.get(devVars), text)
          const target = yield* apiTarget(true)
          assert.strictEqual(target.url, "http://localhost:8787")
          assert.isTrue(target.local)
          assert.strictEqual(Redacted.value(target.token), text.match(/^\s*CLUENORI_API_TOKEN=(.*)$/m)?.[1]?.trim())
        }).pipe(Effect.provide(settingsLayer(files, { HOME: "/test-home" })))
      }
    }),
  )

  it.effect("uses a complete saved deployment unless local is requested, and otherwise falls back to local", () =>
    Effect.gen(function* () {
      for (const saved of [
        undefined,
        { jurisdiction: "eu" },
        { jurisdiction: "eu", url: "https://cluenori.example" },
        { jurisdiction: "eu", token: "saved-test-token" },
        { jurisdiction: "eu", url: "https://cluenori.example", token: "saved-test-token" },
      ] as const) {
        for (const local of [false, true]) {
          const files = new Map([[devVars, localSettings]])
          if (saved !== undefined) {
            const text = yield* Schema.encodeEffect(Schema.fromJsonString(SavedDeployment))(saved)
            files.set("/test-config/cluenori/deployment.json", text)
          }
          const target = yield* apiTarget(local).pipe(
            Effect.provide(settingsLayer(files, { HOME: "/test-home", XDG_CONFIG_HOME: "/test-config" })),
          )
          const remote = !local && saved !== undefined && "url" in saved && "token" in saved
          assert.strictEqual(target.url, remote ? "https://cluenori.example" : "http://localhost:8787")
          assert.strictEqual(Redacted.value(target.token), remote ? "saved-test-token" : localToken)
          assert.strictEqual(target.local, !remote)
          assert.strictEqual(files.get(devVars), localSettings)
        }
      }
    }),
  )

  it.effect("round-trips deployment settings in XDG_CONFIG_HOME or HOME without losing self telemetry", () =>
    Effect.gen(function* () {
      const saved = {
        jurisdiction: "eu",
        account: "0123456789abcdef0123456789abcdef",
        domain: "app.example.com",
        url: "https://app.example.com",
        token: "saved-test-token",
        selfTelemetry: { project: "folio", ingestKey: "made-up-ingest-key", measuring: false },
      } as const
      const deployment = yield* Schema.decodeEffect(SavedDeployment)(saved)
      for (const configHome of [undefined, "/test-config"]) {
        const files = new Map<string, string>()
        yield* Effect.gen(function* () {
          assert.isTrue(Option.isNone(yield* savedDeployment))
          const file = yield* saveDeployment(deployment)
          assert.strictEqual(file, `${configHome ?? "/test-home/.config"}/cluenori/deployment.json`)
          const text = files.get(file)
          assert.isDefined(text)
          assert.deepStrictEqual(yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown))(text), saved)
          const read = yield* savedDeployment
          assert(Option.isSome(read))
          assert.deepStrictEqual(yield* Schema.encodeEffect(SavedDeployment)(read.value), saved)
        }).pipe(
          Effect.provide(
            settingsLayer(files, {
              HOME: "/test-home",
              ...(configHome === undefined ? {} : { XDG_CONFIG_HOME: configHome }),
            }),
          ),
        )
      }
    }),
  )

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
        { jurisdiction: "eu", selfTelemetry: {} },
        { jurisdiction: "eu", selfTelemetry: { project: "Not a key", ingestKey: "test-key", measuring: true } },
        { jurisdiction: "eu", selfTelemetry: { project: "folio", ingestKey: 42, measuring: true } },
        { jurisdiction: "eu", selfTelemetry: { project: "folio", ingestKey: "test-key", measuring: "false" } },
      ]) {
        const refused = yield* Schema.decodeUnknownEffect(SavedDeployment)(saved).pipe(Effect.flip)
        assert.strictEqual(refused._tag, "SchemaError")
      }
    }),
  )
})
