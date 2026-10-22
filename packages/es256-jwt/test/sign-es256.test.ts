import { assert, describe, it } from "@effect/vitest"
import { Effect, Redacted, Result } from "effect"
import { Base64, Base64Url } from "effect/encoding"

import type { Es256Signing } from "../src/index.ts"
import { signEs256 } from "../src/index.ts"

// The runtime's Web Crypto, which tests outside a runtime with its types can't name: the parts
// these tests use.
declare const crypto: {
  readonly subtle: Es256Signing & {
    generateKey(
      algorithm: { readonly name: "ECDSA"; readonly namedCurve: "P-256" | "P-384" },
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

// A key of the tests' own, as Apple's `.p8` file holds one: PKCS #8 in PEM, 64 characters a line.
const newKey = (namedCurve: "P-256" | "P-384") =>
  Effect.gen(function* () {
    const pair = yield* Effect.promise(() =>
      crypto.subtle.generateKey({ name: "ECDSA", namedCurve }, true, ["sign", "verify"]),
    )
    const der = new Uint8Array(yield* Effect.promise(() => crypto.subtle.exportKey("pkcs8", pair.privateKey)))
    const base64 = Base64.encode(der)
    const lines = base64.match(/.{1,64}/g) ?? []
    const pem = `-----BEGIN PRIVATE KEY-----\n${lines.join("\n")}\n-----END PRIVATE KEY-----\n`
    return { pem, base64, publicKey: pair.publicKey }
  })

const textOf = (base64Url: string | undefined) =>
  new TextDecoder().decode(Result.getOrElse(Base64Url.decode(base64Url ?? ""), () => new Uint8Array(0)))
const bytesOf = (base64Url: string | undefined) =>
  Result.getOrElse(Base64Url.decode(base64Url ?? ""), () => new Uint8Array(0))

// Whether `token`'s signature verifies with `publicKey`, as a JWS verifier checks it.
const verifies = (token: string, publicKey: unknown) => {
  const [header, claims, signature] = token.split(".")
  return Effect.promise(() =>
    crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      bytesOf(signature),
      Uint8Array.from(`${header}.${claims}`, (character) => character.charCodeAt(0)),
    ),
  )
}

describe("signEs256", () => {
  it.effect("signs a JWT whose header names ES256 first, whose claims are as given, and whose signature verifies", () =>
    Effect.gen(function* () {
      const key = yield* newKey("P-256")
      const token = yield* signEs256(
        crypto.subtle,
        Redacted.make(key.pem),
        { kid: "ABCDE12345", typ: "JWT" },
        { iss: "57246542-96fe-1a63-e053-0824d011072a", iat: 1792576800, exp: 1792578000, aud: "appstoreconnect-v1" },
      )

      const [header, claims, signature] = token.split(".")
      assert.strictEqual(textOf(header), '{"alg":"ES256","kid":"ABCDE12345","typ":"JWT"}')
      assert.strictEqual(
        textOf(claims),
        '{"iss":"57246542-96fe-1a63-e053-0824d011072a","iat":1792576800,"exp":1792578000,"aud":"appstoreconnect-v1"}',
      )
      // JWS takes ES256's signature as r‖s, 64 bytes, not DER.
      assert.strictEqual(bytesOf(signature).length, 64)
      assert.isTrue(yield* verifies(token, key.publicKey))
    }),
  )

  it.effect("signs with a key given as the base64 inside its file alone", () =>
    Effect.gen(function* () {
      const key = yield* newKey("P-256")
      const token = yield* signEs256(
        crypto.subtle,
        Redacted.make(key.base64),
        { kid: "ABCDE12345" },
        { iss: "TEAM123456" },
      )
      assert.isTrue(yield* verifies(token, key.publicKey))
    }),
  )

  it.effect("keeps ES256 as the algorithm whatever the header says, and encodes text as UTF-8", () =>
    Effect.gen(function* () {
      const key = yield* newKey("P-256")
      const token = yield* signEs256(
        crypto.subtle,
        Redacted.make(key.pem),
        { alg: "none", kid: "ABCDE12345" },
        { sub: "Zoë · Łódź", scope: ["GET /v1/apps"] },
      )
      const [header, claims] = token.split(".")
      assert.strictEqual(textOf(header), '{"alg":"ES256","kid":"ABCDE12345"}')
      assert.strictEqual(textOf(claims), '{"sub":"Zoë · Łódź","scope":["GET /v1/apps"]}')
      assert.isTrue(yield* verifies(token, key.publicKey))
    }),
  )

  it.effect("fails with InvalidSigningKey for a key that isn't base64, isn't a key, or isn't on P-256", () =>
    Effect.gen(function* () {
      const p384 = yield* newKey("P-384")
      const keys = [
        "-----BEGIN PRIVATE KEY-----\nnot base64 at all!\n-----END PRIVATE KEY-----",
        "-----BEGIN PRIVATE KEY-----\nbm90IGEga2V5\n-----END PRIVATE KEY-----",
        p384.pem,
      ]
      const failures = yield* Effect.forEach(keys, (text) =>
        signEs256(crypto.subtle, Redacted.make(text), { kid: "ABCDE12345" }, { iss: "TEAM123456" }).pipe(Effect.flip),
      )
      assert.deepStrictEqual(
        failures.map((failure) => failure._tag),
        ["InvalidSigningKey", "InvalidSigningKey", "InvalidSigningKey"],
      )
    }),
  )
})
