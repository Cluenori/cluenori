import { assert, describe, it } from "@effect/vitest"
import { Effect, Redacted, Schema } from "effect"

import { appManifest, convertManifest, installLink } from "../src/index.ts"
import { factsOf, fakeGitHub } from "./fake-github.ts"
import { errorJson, manifestConversionJson } from "./github-answers.ts"

const decodeJson = Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown))

const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEAtestkeynotreal\n-----END RSA PRIVATE KEY-----\n"

describe("appManifest", () => {
  it.effect("builds the form that creates an app, with its webhook, for an organization", () =>
    Effect.gen(function* () {
      const form = yield* appManifest({
        name: "Cluenori for Notes",
        url: "https://cluenori.example",
        redirectUrl: "https://cluenori.example/github/created",
        callbackUrl: "https://cluenori.example/github/authorized",
        setupUrl: "https://cluenori.example/github/installed",
        webhookUrl: "https://cluenori.example/github/webhooks",
        permissions: { actions: "write", contents: "read", metadata: "read" },
        events: ["workflow_run"],
        public: false,
        state: "c2b1 f/e+=",
        organization: "octo-org",
      })
      assert.strictEqual(
        form.action,
        "https://github.com/organizations/octo-org/settings/apps/new?state=c2b1%20f%2Fe%2B%3D",
      )
      const manifest = yield* decodeJson(form.manifest)
      assert.deepStrictEqual(manifest, {
        name: "Cluenori for Notes",
        url: "https://cluenori.example",
        hook_attributes: { url: "https://cluenori.example/github/webhooks" },
        redirect_url: "https://cluenori.example/github/created",
        callback_urls: ["https://cluenori.example/github/authorized"],
        setup_url: "https://cluenori.example/github/installed",
        public: false,
        default_permissions: { actions: "write", contents: "read", metadata: "read" },
        default_events: ["workflow_run"],
      })
    }),
  )

  it.effect("leaves the webhook out of an app without a webhook URL, for a personal account", () =>
    Effect.gen(function* () {
      const form = yield* appManifest({
        name: "Cluenori",
        url: "https://cluenori.example",
        redirectUrl: "https://cluenori.example/github/created",
        permissions: { actions: "write" },
        public: false,
        state: "abc123",
      })
      assert.strictEqual(form.action, "https://github.com/settings/apps/new?state=abc123")
      const manifest = yield* decodeJson(form.manifest)
      assert.deepStrictEqual(manifest, {
        name: "Cluenori",
        url: "https://cluenori.example",
        redirect_url: "https://cluenori.example/github/created",
        public: false,
        default_permissions: { actions: "write" },
      })
    }),
  )

  it("links to the page that installs an app", () => {
    assert.strictEqual(installLink("cluenori-test"), "https://github.com/apps/cluenori-test/installations/new")
  })
})

describe("convertManifest", () => {
  it.effect("gets the app GitHub created for a code, unauthenticated, its secrets redacted", () =>
    Effect.gen(function* () {
      const code = "a180b1a3d263c81bc6441d7b990bae27d4c10679"
      const github = fakeGitHub({
        [`POST /app-manifests/${code}/conversions`]: [
          { status: 201, body: manifestConversionJson({ pem, webhookSecret: "test-webhook-secret-not-real" }) },
        ],
      })
      const created = yield* convertManifest(code).pipe(Effect.provide(github.layer))

      assert.deepStrictEqual(
        { id: created.id, slug: created.slug, name: created.name, url: created.url, clientId: created.clientId },
        {
          id: 123456,
          slug: "cluenori-test",
          name: "Cluenori Test",
          url: "https://github.com/apps/cluenori-test",
          clientId: "Iv23liTestClientNotReal",
        },
      )
      assert.isTrue(Redacted.isRedacted(created.privateKey))
      assert.strictEqual(Redacted.value(created.privateKey), pem)
      assert.strictEqual(Redacted.value(created.clientSecret), "test-client-secret-not-a-real-one")
      assert.strictEqual(
        created.webhookSecret === undefined ? undefined : Redacted.value(created.webhookSecret),
        "test-webhook-secret-not-real",
      )
      assert.strictEqual(github.asked[0]?.headers["authorization"], undefined)
    }),
  )

  it.effect("has no webhook secret when GitHub gives none", () =>
    Effect.gen(function* () {
      const github = fakeGitHub({
        "POST /app-manifests/abc123/conversions": [
          { status: 201, body: manifestConversionJson({ pem, webhookSecret: null }) },
        ],
      })
      const created = yield* convertManifest("abc123").pipe(Effect.provide(github.layer))
      assert.isFalse("webhookSecret" in created)
    }),
  )

  it.effect("refuses a code GitHub doesn't take, and one that isn't a code, asking only about the first", () =>
    Effect.gen(function* () {
      const github = fakeGitHub({})
      const refusals = yield* Effect.all([
        convertManifest("0000000000000000000000000000000000000000").pipe(Effect.flip),
        convertManifest("../../app").pipe(Effect.flip),
      ]).pipe(Effect.provide(github.layer))
      assert.deepStrictEqual(refusals.map(factsOf), [
        { _tag: "GitHubRefused", status: 404, reason: "Not Found" },
        { _tag: "GitHubRefused", status: 404, reason: "That isn't a code GitHub sends back from a manifest" },
      ])
      assert.strictEqual(github.asked.length, 1)
    }),
  )

  it.effect("refuses a code GitHub can't convert, with its message", () =>
    Effect.gen(function* () {
      const github = fakeGitHub({
        "POST /app-manifests/abc123/conversions": [{ status: 422, body: errorJson("Validation Failed", 422) }],
      })
      const refused = yield* convertManifest("abc123").pipe(Effect.flip, Effect.provide(github.layer))
      assert.deepStrictEqual(factsOf(refused), { _tag: "GitHubRefused", status: 422, reason: "Validation Failed" })
    }),
  )
})
