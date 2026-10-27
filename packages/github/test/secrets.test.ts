import { assert, describe, it } from "@effect/vitest"
import { hsalsa, xsalsa20poly1305 } from "@noble/ciphers/salsa.js"
import { x25519 } from "@noble/curves/ed25519.js"
import { blake2b } from "@noble/hashes/blake2.js"
import { Effect, Layer, Redacted, Result, Schema } from "effect"
import { Base64 } from "effect/encoding"

import { GitHub, Repository } from "../src/index.ts"
import { factsOf, fakeGitHub } from "./fake-github.ts"
import { errorJson } from "./github-answers.ts"

const repository = Repository.make("octo-org/watch")
const repo = "/repos/octo-org/watch"

// libsodium's `crypto_box_seal_open`, written from its documentation for these tests: the
// ephemeral key is the box's first 32 bytes, the nonce BLAKE2b-24 of it and the recipient's key.
const words = (bytes: Uint8Array) => new Uint32Array(Uint8Array.from(bytes).buffer)

const open = (box: Uint8Array, recipient: { readonly publicKey: Uint8Array; readonly secretKey: Uint8Array }) => {
  const ephemeral = box.slice(0, 32)
  const shared = x25519.getSharedSecret(recipient.secretKey, ephemeral)
  const key = new Uint32Array(8)
  hsalsa(words(Uint8Array.from("expand 32-byte k", (c) => c.charCodeAt(0))), words(shared), new Uint32Array(4), key)
  const nonce = blake2b(Uint8Array.from([...ephemeral, ...recipient.publicKey]), { dkLen: 24 })
  return xsalsa20poly1305(new Uint8Array(key.buffer), nonce).decrypt(box.slice(32))
}

const PutBody = Schema.Struct({ encrypted_value: Schema.String, key_id: Schema.String })

const withGitHub = <A, E>(github: ReturnType<typeof fakeGitHub>, program: Effect.Effect<A, E, GitHub>) =>
  program.pipe(
    Effect.provide(
      GitHub.layer({ token: Redacted.make("test-token-not-a-real-one") }).pipe(Layer.provide(github.layer)),
    ),
  )

describe("GitHub's Actions secrets", () => {
  it.effect("seals the value with the repository's key, so only its secret key opens it", () =>
    Effect.gen(function* () {
      const recipient = x25519.keygen()
      const value = `{"key":"-----BEGIN PRIVATE KEY-----\\nMIGT…","city":"Zürich 🔔"}`
      const github = fakeGitHub({
        [`GET ${repo}/actions/secrets/public-key`]: [
          { status: 200, body: { key_id: "568250167242549743", key: Base64.encode(recipient.publicKey) } },
        ],
        [`PUT ${repo}/actions/secrets/CLUENORI_PHONES`]: [{ status: 201 }, { status: 204 }],
      })
      yield* withGitHub(
        github,
        Effect.gen(function* () {
          const gitHub = yield* GitHub
          yield* gitHub.setActionsSecret(repository, "CLUENORI_PHONES", Redacted.make(value))
          // Replacing it is the same call, which GitHub answers 204.
          yield* gitHub.setActionsSecret(repository, "CLUENORI_PHONES", Redacted.make(value))
        }),
      )
      const puts = github.asked.filter((question) => question.method === "PUT")
      assert.strictEqual(puts.length, 2)
      const bodies = yield* Effect.forEach(puts, (put) => Schema.decodeUnknownEffect(PutBody)(put.body))
      const [first, second] = bodies
      assert.strictEqual(first?.key_id, "568250167242549743")
      const opened = open(Result.getOrThrow(Base64.decode(first?.encrypted_value ?? "")), recipient)
      assert.strictEqual(Result.getOrThrow(Base64.decodeString(Base64.encode(opened))), value)
      // Each seal is its own: the same value never seals to the same text twice.
      assert.notStrictEqual(first?.encrypted_value, second?.encrypted_value)
      for (const body of bodies) {
        assert.notInclude(`${body.encrypted_value} ${body.key_id}`, "BEGIN PRIVATE KEY")
      }
    }),
  )

  it.effect("says the token lacks Secrets: write when GitHub refuses, and writes nothing", () =>
    Effect.gen(function* () {
      const github = fakeGitHub({
        [`GET ${repo}/actions/secrets/public-key`]: [
          { status: 403, body: errorJson("Resource not accessible by integration", 403) },
        ],
      })
      const refused = yield* withGitHub(
        github,
        Effect.gen(function* () {
          const gitHub = yield* GitHub
          return yield* gitHub.setActionsSecret(repository, "CLUENORI_PHONES", Redacted.make("{}")).pipe(Effect.flip)
        }),
      )
      assert.deepStrictEqual(factsOf(refused), {
        _tag: "GitHubRefused",
        status: 403,
        reason:
          "octo-org/watch's Actions secrets can't be written: the token lacks Secrets: write there (Resource not accessible by integration)",
      })
      assert.isFalse(github.asked.some((question) => question.method === "PUT"))
    }),
  )
})
