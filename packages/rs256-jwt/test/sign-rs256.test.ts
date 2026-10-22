import { assert, describe, it } from "@effect/vitest"
import { Effect, Redacted, Result } from "effect"
import { Base64, Base64Url } from "effect/encoding"

import type { Rs256Signing } from "../src/index.ts"
import { signRs256 } from "../src/index.ts"

// The runtime's Web Crypto, which tests outside a runtime with its types can't name: the parts
// these tests use.
declare const crypto: {
  readonly subtle: Rs256Signing & {
    generateKey(
      algorithm:
        | {
            readonly name: "RSASSA-PKCS1-v1_5"
            readonly modulusLength: number
            readonly publicExponent: Uint8Array
            readonly hash: "SHA-256"
          }
        | { readonly name: "ECDSA"; readonly namedCurve: "P-256" },
      extractable: true,
      keyUsages: Array<"sign" | "verify">,
    ): Promise<{ readonly privateKey: unknown; readonly publicKey: unknown }>
    exportKey(format: "pkcs8", key: unknown): Promise<ArrayBuffer>
    verify(
      algorithm: { readonly name: "RSASSA-PKCS1-v1_5" },
      key: unknown,
      signature: Uint8Array,
      data: Uint8Array,
    ): Promise<boolean>
  }
}
declare const TextDecoder: new () => { readonly decode: (input: Uint8Array) => string }

// PEM text, 64 characters a line, as GitHub and OpenSSL write it.
const pemOf = (label: string, der: Uint8Array) => {
  const lines = Base64.encode(der).match(/.{1,64}/g) ?? []
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`
}

// One DER element at `at`: where its content starts and where it ends.
const elementAt = (der: Uint8Array, at: number) => {
  const firstLengthByte = der[at + 1] ?? 0
  const lengthBytes = firstLengthByte < 0x80 ? 0 : firstLengthByte & 0x7f
  const length =
    lengthBytes === 0
      ? firstLengthByte
      : Array.from(der.subarray(at + 2, at + 2 + lengthBytes)).reduce((value, byte) => value * 256 + byte, 0)
  const contentStart = at + 2 + lengthBytes
  return { tag: der[at], contentStart, end: contentStart + length }
}

// The PKCS #1 key inside a PKCS #8 one, as `openssl rsa -traditional` writes it: the content of
// PrivateKeyInfo's third element, after its version and its algorithm.
const pkcs1Of = (pkcs8: Uint8Array) => {
  const info = elementAt(pkcs8, 0)
  const version = elementAt(pkcs8, info.contentStart)
  const algorithm = elementAt(pkcs8, version.end)
  const key = elementAt(pkcs8, algorithm.end)
  assert.strictEqual(key.tag, 0x04)
  return pkcs8.subarray(key.contentStart, key.end)
}

// An RSA key of the tests' own, in PKCS #8 and PKCS #1 PEMs, and its public half.
const newKey = Effect.gen(function* () {
  const pair = yield* Effect.promise(() =>
    crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: Uint8Array.of(1, 0, 1), hash: "SHA-256" },
      true,
      ["sign", "verify"],
    ),
  )
  const pkcs8 = new Uint8Array(yield* Effect.promise(() => crypto.subtle.exportKey("pkcs8", pair.privateKey)))
  const pkcs1 = pkcs1Of(pkcs8)
  return {
    pkcs8: pemOf("PRIVATE KEY", pkcs8),
    pkcs1: pemOf("RSA PRIVATE KEY", pkcs1),
    pkcs1Base64: Base64.encode(pkcs1),
    publicKey: pair.publicKey,
  }
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
      { name: "RSASSA-PKCS1-v1_5" },
      publicKey,
      bytesOf(signature),
      Uint8Array.from(`${header}.${claims}`, (character) => character.charCodeAt(0)),
    ),
  )
}

describe("signRs256", () => {
  it.effect("signs a JWT with a PKCS #1 key, as GitHub gives one, whose signature verifies", () =>
    Effect.gen(function* () {
      const key = yield* newKey
      assert.include(key.pkcs1, "-----BEGIN RSA PRIVATE KEY-----")
      const token = yield* signRs256(
        crypto.subtle,
        Redacted.make(key.pkcs1),
        { typ: "JWT" },
        { iat: 1792576740, exp: 1792577340, iss: "Iv23liExampleClient" },
      )

      const [header, claims, signature] = token.split(".")
      assert.strictEqual(textOf(header), '{"alg":"RS256","typ":"JWT"}')
      assert.strictEqual(textOf(claims), '{"iat":1792576740,"exp":1792577340,"iss":"Iv23liExampleClient"}')
      // A 2048-bit key's signature is 256 bytes.
      assert.strictEqual(bytesOf(signature).length, 256)
      assert.isTrue(yield* verifies(token, key.publicKey))
    }),
  )

  it.effect("signs with a PKCS #8 key, and with a PKCS #1 key's base64 alone", () =>
    Effect.gen(function* () {
      const key = yield* newKey
      const fromPkcs8 = yield* signRs256(crypto.subtle, Redacted.make(key.pkcs8), {}, { iss: 123456 })
      const fromBase64 = yield* signRs256(crypto.subtle, Redacted.make(key.pkcs1Base64), {}, { iss: 123456 })
      assert.isTrue(yield* verifies(fromPkcs8, key.publicKey))
      assert.isTrue(yield* verifies(fromBase64, key.publicKey))
      // RS256 is deterministic: the same key, header and claims sign the same token.
      assert.strictEqual(fromPkcs8, fromBase64)
    }),
  )

  it.effect("keeps RS256 as the algorithm whatever the header says", () =>
    Effect.gen(function* () {
      const key = yield* newKey
      const token = yield* signRs256(crypto.subtle, Redacted.make(key.pkcs1), { alg: "none", typ: "JWT" }, { iss: 1 })
      const [header] = token.split(".")
      assert.strictEqual(textOf(header), '{"alg":"RS256","typ":"JWT"}')
      assert.isTrue(yield* verifies(token, key.publicKey))
    }),
  )

  it.effect("fails with InvalidSigningKey for a key that isn't base64, isn't a key, or isn't RSA", () =>
    Effect.gen(function* () {
      const ec = yield* Effect.promise(() =>
        crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]),
      )
      const ecPkcs8 = new Uint8Array(yield* Effect.promise(() => crypto.subtle.exportKey("pkcs8", ec.privateKey)))
      const keys = [
        "-----BEGIN RSA PRIVATE KEY-----\nnot base64 at all!\n-----END RSA PRIVATE KEY-----",
        "-----BEGIN RSA PRIVATE KEY-----\nbm90IGEga2V5\n-----END RSA PRIVATE KEY-----",
        "-----BEGIN ENCRYPTED PRIVATE KEY-----\nbm90IGEga2V5\n-----END ENCRYPTED PRIVATE KEY-----",
        pemOf("PRIVATE KEY", ecPkcs8),
      ]
      const failures = yield* Effect.forEach(keys, (text) =>
        signRs256(crypto.subtle, Redacted.make(text), {}, { iss: 1 }).pipe(Effect.flip),
      )
      assert.deepStrictEqual(
        failures.map((failure) => failure._tag),
        ["InvalidSigningKey", "InvalidSigningKey", "InvalidSigningKey", "InvalidSigningKey"],
      )
    }),
  )
})
