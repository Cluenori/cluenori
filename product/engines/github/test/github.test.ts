import { Repository } from "@bagatka/github"
import type { Actor } from "@cluenori/foundation"
import { ActivityLog, MemberId, ProjectKey } from "@cluenori/foundation"
import type { Access } from "@cluenori/members"
import { assert, describe, it } from "@effect/vitest"
import { DateTime, Effect, Layer, Redacted, Schema } from "effect"
import { Base64 } from "effect/encoding"
import { HttpClient, HttpClientResponse } from "effect/http"
import { TestClock } from "effect/testing"

import { GitHubAccount, GitHubConnection, GitHubStatus, ManifestCode } from "../src/index.ts"
import { inWorkspace } from "./in-workspace.ts"

// 2026-10-21T10:00:00Z.
const start = 1792576800000
const hour = 3_600_000

const owner: Actor = { _tag: "Member", id: MemberId.make("0199f7a2-5c1e-7d3a-9b2f-4e8a1c6d0f53") }
const everything: Access = { _tag: "Everything" }
const someProjects: Access = { _tag: "Projects", projects: [ProjectKey.make("notes")] }
const deployment = "https://example.cluenori.dev"
const reached = Repository.make("octo-org/notes-api")
const elsewhere = Repository.make("someone/else")

// An RSA key, as GitHub generates for an app, in PKCS #8 PEM.
const privateKeyPem = Effect.gen(function* () {
  const pair = yield* Effect.promise(() =>
    crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["sign", "verify"],
    ),
  )
  if (!("privateKey" in pair)) {
    return yield* Effect.die("generateKey made no key pair")
  }
  const exported = yield* Effect.promise(() => crypto.subtle.exportKey("pkcs8", pair.privateKey))
  if (!(exported instanceof ArrayBuffer)) {
    return yield* Effect.die("exportKey made no PKCS #8")
  }
  const lines = Base64.encode(new Uint8Array(exported)).match(/.{1,64}/g) ?? []
  return `-----BEGIN PRIVATE KEY-----\n${lines.join("\n")}\n-----END PRIVATE KEY-----\n`
})

const jsonText = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))

// GitHub as the manifest flow and the app's tokens need it: one code it converts, one installation
// on octo-org, which reaches octo-org/notes-api. `asked` lists each request as `METHOD path`.
const fakeGitHub = (pem: string, asked: Array<string>) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request, url) =>
      Effect.gen(function* () {
        const path = url.pathname
        asked.push(`${request.method} ${path}`)
        const json = (status: number, body: unknown) =>
          jsonText(body).pipe(
            Effect.orDie,
            Effect.map((text) =>
              HttpClientResponse.fromWeb(
                request,
                new Response(text, { status, headers: { "content-type": "application/json" } }),
              ),
            ),
          )
        const installation = {
          id: 77,
          account: { login: "octo-org" },
          target_type: "Organization",
          repository_selection: "selected",
          html_url: "https://github.com/organizations/octo-org/settings/installations/77",
        }
        if (request.method === "POST" && path === "/app-manifests/good-code/conversions") {
          return yield* json(201, {
            id: 4242,
            slug: "cluenori-example",
            name: "Cluenori example",
            html_url: "https://github.com/apps/cluenori-example",
            client_id: "Iv23liExample",
            client_secret: "client-secret",
            webhook_secret: null,
            pem,
          })
        }
        if (request.method === "GET" && path === "/app/installations") {
          return yield* json(200, [installation])
        }
        if (request.method === "GET" && path === `/repos/${reached}/installation`) {
          return yield* json(200, installation)
        }
        if (request.method === "POST" && path === "/app/installations/77/access_tokens") {
          return yield* json(201, {
            token: "ghs_installationtoken",
            expires_at: DateTime.formatIso(DateTime.makeUnsafe(start + hour)),
          })
        }
        return yield* json(404, { message: "Not Found" })
      }),
    ),
  )

// The state GitHub sends back: the one in the form's action.
const stateOf = (action: string) => new URL(action).searchParams.get("state") ?? ""

describe("GitHub's connection", () => {
  it.effect("connects in one step: a form for GitHub, then its code, once, for an owner", () =>
    Effect.gen(function* () {
      const pem = yield* privateKeyPem
      const asked: Array<string> = []
      yield* inWorkspace(
        "connect",
        start,
        fakeGitHub(pem, asked),
        Effect.gen(function* () {
          const connection = yield* GitHubConnection
          const before = yield* connection.status(everything)
          const form = yield* connection.startConnecting(owner, everything, deployment, GitHubAccount.make("octo-org"))
          const manifest = yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown))(form.manifest)
          const app = yield* connection.finishConnecting(ManifestCode.make("good-code"), stateOf(form.action))
          const reused = yield* connection
            .finishConnecting(ManifestCode.make("good-code"), stateOf(form.action))
            .pipe(Effect.flip)
          const status = yield* connection.status(everything)
          const again = yield* connection.startConnecting(owner, everything, deployment, undefined).pipe(Effect.flip)
          const log = yield* ActivityLog
          const [connected] = yield* log.latest

          assert.isUndefined(before.app)
          assert.isTrue(form.action.startsWith("https://github.com/organizations/octo-org/settings/apps/new?state="))
          assert.deepInclude(manifest, {
            name: "Cluenori example",
            url: deployment,
            redirect_url: `${deployment}/api/github/connected`,
            setup_url: `${deployment}/github`,
            public: true,
            default_permissions: {
              contents: "write",
              pull_requests: "read",
              actions: "write",
              metadata: "read",
              organization_self_hosted_runners: "read",
            },
          })
          assert.deepInclude(app, {
            name: "Cluenori example",
            slug: "cluenori-example",
            url: "https://github.com/apps/cluenori-example",
            installUrl: "https://github.com/apps/cluenori-example/installations/new",
            organization: GitHubAccount.make("octo-org"),
          })
          assert.strictEqual(reused._tag, "ConnectRejected")
          assert.deepStrictEqual(status.installations, [
            {
              account: "octo-org",
              accountType: "Organization",
              repositories: "selected",
              url: "https://github.com/organizations/octo-org/settings/installations/77",
            },
          ])
          assert.strictEqual(again._tag, "GitHubAlreadyConnected")
          assert.strictEqual(connected?.name, "github_app.connected")
          assert.deepStrictEqual(connected?.actor, owner)
          // The private key never leaves: not in activity, nor in what an owner sees.
          const seen = yield* jsonText([connected?.attrs, yield* Schema.encodeEffect(GitHubStatus)(status)])
          assert.notInclude(seen, "PRIVATE KEY")
        }),
      )
    }),
  )

  it.effect("lets only an owner connect, disconnect, or see it, and refuses a state it didn't start", () =>
    Effect.gen(function* () {
      const pem = yield* privateKeyPem
      yield* inWorkspace(
        "owners",
        start,
        fakeGitHub(pem, []),
        Effect.gen(function* () {
          const connection = yield* GitHubConnection
          const seen = yield* connection.status(someProjects).pipe(Effect.flip)
          const started = yield* connection
            .startConnecting(owner, someProjects, deployment, undefined)
            .pipe(Effect.flip)
          const disconnected = yield* connection.disconnect(owner, someProjects).pipe(Effect.flip)
          const forged = yield* connection.finishConnecting(ManifestCode.make("good-code"), "made-up").pipe(Effect.flip)

          assert.strictEqual(seen._tag, "NotAllowed")
          assert.strictEqual(started._tag, "NotAllowed")
          assert.strictEqual(disconnected._tag, "NotAllowed")
          assert.strictEqual(forged._tag, "ConnectRejected")
          assert.isUndefined((yield* connection.status(everything)).app)
        }),
      )
    }),
  )

  it.effect("expires a state after an hour", () =>
    Effect.gen(function* () {
      const pem = yield* privateKeyPem
      yield* inWorkspace(
        "expired",
        start,
        fakeGitHub(pem, []),
        Effect.gen(function* () {
          const connection = yield* GitHubConnection
          const form = yield* connection.startConnecting(owner, everything, deployment, undefined)
          yield* TestClock.setTime(start + hour + 1)
          const late = yield* connection
            .finishConnecting(ManifestCode.make("good-code"), stateOf(form.action))
            .pipe(Effect.flip)

          assert.isTrue(form.action.startsWith("https://github.com/settings/apps/new?state="))
          assert.strictEqual(late._tag, "ConnectRejected")
        }),
      )
    }),
  )

  it.effect("hands out tokens for the repositories its app reaches, and says what to do elsewhere", () =>
    Effect.gen(function* () {
      const pem = yield* privateKeyPem
      const asked: Array<string> = []
      yield* inWorkspace(
        "tokens",
        start,
        fakeGitHub(pem, asked),
        Effect.gen(function* () {
          const connection = yield* GitHubConnection
          const unconnected = yield* connection.tokenFor(reached).pipe(Effect.flip)
          const form = yield* connection.startConnecting(owner, everything, deployment, undefined)
          yield* connection.finishConnecting(ManifestCode.make("good-code"), stateOf(form.action))
          const issued = yield* connection.tokenFor(reached)
          const uninstalled = yield* connection.tokenFor(elsewhere).pipe(Effect.flip)
          yield* connection.disconnect(owner, everything)
          const forgotten = yield* connection.tokenFor(reached).pipe(Effect.flip)

          assert.include(unconnected.reason, "isn't connected to GitHub")
          assert.strictEqual(Redacted.value(issued.token), "ghs_installationtoken")
          assert.include(uninstalled.reason, "install it")
          assert.include(forgotten.reason, "isn't connected to GitHub")
          assert.include(asked, "POST /app/installations/77/access_tokens")
        }),
      )
    }),
  )
})
