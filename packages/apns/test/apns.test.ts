import { assert, describe, it } from "@effect/vitest"
import { Effect, Layer, Redacted, Result } from "effect"
import { Base64, Base64Url } from "effect/encoding"
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/http"
import { TestClock } from "effect/testing"

import type { ApnsPush, ApnsSigning } from "../src/index.ts"
import { Apns } from "../src/index.ts"

// The runtime's Web Crypto and `Response`, which tests outside a runtime with their types can't
// name: the parts these tests use.
declare const crypto: {
  readonly subtle: ApnsSigning & {
    generateKey(
      algorithm: { readonly name: "ECDSA"; readonly namedCurve: "P-256" },
      extractable: true,
      keyUsages: Array<"sign" | "verify">,
    ): Promise<{ readonly privateKey: unknown; readonly publicKey: unknown }>
    exportKey(format: "pkcs8", key: unknown): Promise<ArrayBuffer>
    verify(
      algorithm: { readonly name: "ECDSA"; readonly hash: "SHA-256" },
      key: unknown,
      signature: Uint8Array,
      data: Uint8Array,
    ): Promise<boolean>
  }
}
declare const TextDecoder: new () => { readonly decode: (input: Uint8Array) => string }
declare const Response: new (
  body: string | null,
  init: { readonly status: number; readonly headers?: Readonly<Record<string, string>> },
) => object

// A key of the tests' own, as Apple's `.p8` file holds one.
const newKey = Effect.gen(function* () {
  const pair = yield* Effect.promise(() =>
    crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]),
  )
  const der = new Uint8Array(yield* Effect.promise(() => crypto.subtle.exportKey("pkcs8", pair.privateKey)))
  const pem = `-----BEGIN PRIVATE KEY-----\n${Base64.encode(der)}\n-----END PRIVATE KEY-----\n`
  return { pem, publicKey: pair.publicKey }
})

const textOf = (bytes: Uint8Array) => new TextDecoder().decode(bytes)
const bytesOf = (base64Url: string | undefined) =>
  Result.getOrElse(Base64Url.decode(base64Url ?? ""), () => new Uint8Array(0))

interface Asked {
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
  readonly body: string
}

// A fake APNs: answers each push with the next of `answers`, and keeps what it was asked.
const fakeApns = (answers: Array<{ readonly status: number; readonly body?: string } | "no answer">) => {
  const asked: Array<Asked> = []
  const client = HttpClient.make((request, url) =>
    Effect.gen(function* () {
      const body = request.body._tag === "Uint8Array" ? textOf(request.body.body) : ""
      asked.push({ url: url.href, headers: request.headers, body })
      const answer = answers.shift() ?? { status: 200 }
      if (answer === "no answer") {
        return yield* new HttpClientError.HttpClientError({
          reason: new HttpClientError.TransportError({ request, description: "No route" }),
        })
      }
      return HttpClientResponse.fromWeb(
        request,
        new Response(answer.body ?? null, {
          status: answer.status,
          headers: { "apns-id": "4f0e5d2c-8b1a-4c3e-9d7f-1a2b3c4d5e6f" },
        }),
      )
    }),
  )
  return { asked, layer: Layer.succeed(HttpClient.HttpClient, client) }
}

const push: ApnsPush = {
  deviceToken: "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90",
  environment: "development",
  topic: "com.example.notes",
  priority: 10,
  payload: { aps: { alert: { title: "Notes · Down", body: "https://notes.example/health is down" } } },
  collapseId: "incident-1",
}

// Runs `program` with APNs on `pem`, through `apns`, the clock at a fixed time.
const withApns = <A, E>(pem: string, apns: ReturnType<typeof fakeApns>, program: Effect.Effect<A, E, Apns>) =>
  program.pipe(
    Effect.provide(
      Apns.layer({ key: Redacted.make(pem), keyId: "ABCDE12345", teamId: "TEAM123456" }, crypto.subtle).pipe(
        Layer.provide(apns.layer),
      ),
    ),
  )

const send = () =>
  Effect.gen(function* () {
    const apns = yield* Apns
    return yield* apns.send(push)
  })

describe("Apns", () => {
  it.effect("sends to the development APNs with a provider token its key signed", () =>
    Effect.gen(function* () {
      const key = yield* newKey
      const apns = fakeApns([{ status: 200 }])
      const answer = yield* withApns(key.pem, apns, send())

      assert.deepStrictEqual(answer, { _tag: "Accepted", apnsId: "4f0e5d2c-8b1a-4c3e-9d7f-1a2b3c4d5e6f" })
      const asked = apns.asked[0]
      assert.strictEqual(asked?.url, `https://api.sandbox.push.apple.com/3/device/${push.deviceToken}`)
      assert.strictEqual(asked?.headers["apns-topic"], "com.example.notes")
      assert.strictEqual(asked?.headers["apns-push-type"], "alert")
      assert.strictEqual(asked?.headers["apns-collapse-id"], "incident-1")
      assert.strictEqual(
        asked?.body,
        '{"aps":{"alert":{"title":"Notes · Down","body":"https://notes.example/health is down"}}}',
      )

      // An ES256 JWT: its header names the key, its claims the team, and its signature verifies.
      const [header, claims, signature] = (asked?.headers["authorization"] ?? "").replace("bearer ", "").split(".")
      assert.strictEqual(textOf(bytesOf(header)), '{"alg":"ES256","kid":"ABCDE12345"}')
      assert.match(textOf(bytesOf(claims)), /^\{"iss":"TEAM123456","iat":\d+\}$/)
      const verified = yield* Effect.promise(() =>
        crypto.subtle.verify(
          { name: "ECDSA", hash: "SHA-256" },
          key.publicKey,
          bytesOf(signature),
          Uint8Array.from(`${header}.${claims}`, (character) => character.charCodeAt(0)),
        ),
      )
      assert.isTrue(verified)
    }),
  )

  it.effect("reuses its provider token for 50 minutes, then signs another", () =>
    Effect.gen(function* () {
      const key = yield* newKey
      const apns = fakeApns([])
      yield* withApns(
        key.pem,
        apns,
        Effect.gen(function* () {
          yield* send()
          yield* TestClock.adjust("49 minutes")
          yield* send()
          yield* TestClock.adjust("2 minutes")
          yield* send()
        }),
      )
      const tokens = apns.asked.map((asked) => asked.headers["authorization"])
      assert.strictEqual(tokens[0], tokens[1])
      assert.notStrictEqual(tokens[1], tokens[2])
    }),
  )

  it.effect("says why APNs refused a push, and fails when it may take it later", () =>
    Effect.gen(function* () {
      const key = yield* newKey
      const apns = fakeApns([
        { status: 400, body: '{"reason":"BadDeviceToken"}' },
        { status: 410, body: '{"reason":"Unregistered","timestamp":1792576800000}' },
        { status: 503, body: '{"reason":"ServiceUnavailable"}' },
        "no answer",
      ])
      const answers = yield* withApns(
        key.pem,
        apns,
        Effect.all([send(), send(), send().pipe(Effect.flip), send().pipe(Effect.flip)]),
      )
      assert.deepStrictEqual(answers[0], { _tag: "Rejected", status: 400, reason: "BadDeviceToken" })
      assert.deepStrictEqual(answers[1], { _tag: "Rejected", status: 410, reason: "Unregistered" })
      assert.strictEqual(answers[2].reason, "ServiceUnavailable")
      assert.strictEqual(answers[3].reason, "APNs didn't answer")
    }),
  )

  it.effect("renews a provider token APNs calls expired, and sends once more", () =>
    Effect.gen(function* () {
      const key = yield* newKey
      const apns = fakeApns([{ status: 403, body: '{"reason":"ExpiredProviderToken"}' }, { status: 200 }])
      const answer = yield* withApns(key.pem, apns, send())
      assert.strictEqual(answer._tag, "Accepted")
      assert.strictEqual(apns.asked.length, 2)
    }),
  )

  it.effect("signs with a key given as the base64 inside its file alone, as .dev.vars holds it", () =>
    Effect.gen(function* () {
      const key = yield* newKey
      const apns = fakeApns([{ status: 200 }])
      const base64 = key.pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "")
      const answer = yield* withApns(base64, apns, send())
      assert.strictEqual(answer._tag, "Accepted")
    }),
  )

  it.effect("rejects every push of a key that isn't one, sending none", () =>
    Effect.gen(function* () {
      const apns = fakeApns([])
      const answer = yield* withApns(
        "-----BEGIN PRIVATE KEY-----\nbm90IGEga2V5\n-----END PRIVATE KEY-----",
        apns,
        send(),
      )
      assert.deepStrictEqual(answer, { _tag: "Rejected", status: 0, reason: "InvalidSigningKey" })
      assert.strictEqual(apns.asked.length, 0)
    }),
  )
})
