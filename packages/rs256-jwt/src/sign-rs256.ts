import { Effect, Record, Redacted, Result, Schema } from "effect"
import { Base64, Base64Url } from "effect/encoding"

/**
 * The part of the Web Crypto API this package signs with: `globalThis.crypto.subtle` in Workers,
 * browsers, Bun, and Node.
 */
export interface Rs256Signing {
  importKey(
    format: "pkcs8",
    keyData: Uint8Array,
    algorithm: { readonly name: "RSASSA-PKCS1-v1_5"; readonly hash: "SHA-256" },
    extractable: false,
    keyUsages: Array<"sign">,
  ): Promise<unknown>
  sign(algorithm: { readonly name: "RSASSA-PKCS1-v1_5" }, key: unknown, data: Uint8Array): Promise<ArrayBuffer>
}

/**
 * The key couldn't sign: it isn't an RSA private key in PKCS #1 or PKCS #8, or it is encrypted.
 * Signing again with it won't help.
 */
export class InvalidSigningKey extends Schema.TaggedError<InvalidSigningKey>()("InvalidSigningKey", {}) {}

const keyAlgorithm = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const
const signatureAlgorithm = { name: "RSASSA-PKCS1-v1_5" } as const

const encodeJsonText = Schema.encodeEffect(Schema.fromJsonString(Schema.JsonObject))

/**
 * A compact JWS signed with RS256: the header `{"alg":"RS256", ...header}`, whose `alg` stays
 * RS256 whatever `header` says, then `claims`, each as JSON in the order given, and the signature,
 * all base64url. `key` is a PEM's text, armor and all, or the base64 inside it alone: PKCS #1
 * (`BEGIN RSA PRIVATE KEY`, as GitHub gives a GitHub App's key) or PKCS #8 (`BEGIN PRIVATE KEY`).
 * The key is imported on every call, so callers that need tokens often keep one for its lifetime.
 * Fails with `InvalidSigningKey` when the key isn't an unencrypted RSA private key.
 */
export const signRs256 = Effect.fn("signRs256")(function* (
  signing: Rs256Signing,
  key: Redacted.Redacted,
  header: Schema.JsonObject,
  claims: Schema.JsonObject,
) {
  const der = Base64.decode(base64Of(Redacted.value(key)))
  if (Result.isFailure(der)) {
    return yield* new InvalidSigningKey()
  }
  // Web Crypto imports PKCS #8 alone, so a PKCS #1 key is wrapped in it first.
  const pkcs8 = isPkcs1(der.success) ? wrappedInPkcs8(der.success) : der.success
  const signingKey = yield* Effect.tryPromise({
    try: () => signing.importKey("pkcs8", pkcs8, keyAlgorithm, false, ["sign"]),
    catch: () => new InvalidSigningKey(),
  })
  const protectedHeader = { alg: "RS256", ...Record.remove<string, Schema.Json, "alg">(header, "alg") }
  const headerText = yield* encodeJsonText(protectedHeader).pipe(Effect.orDie)
  const claimsText = yield* encodeJsonText(claims).pipe(Effect.orDie)
  const unsigned = `${Base64Url.encode(headerText)}.${Base64Url.encode(claimsText)}`
  const signature = yield* Effect.tryPromise({
    try: () => signing.sign(signatureAlgorithm, signingKey, asciiBytes(unsigned)),
    catch: () => new InvalidSigningKey(),
  })
  return `${unsigned}.${Base64Url.encode(new Uint8Array(signature))}`
})

// The base64 of a PEM's DER bytes: its text without the armor of an RSA key and its line breaks.
// An encrypted key's armor and headers stay, so it isn't base64 and fails as a key.
const base64Of = (text: string) => text.replace(/-----(BEGIN|END) (RSA )?PRIVATE KEY-----/g, "").replace(/\s+/g, "")

// Whether `der` is a PKCS #1 RSAPrivateKey, SEQUENCE { INTEGER 0, INTEGER modulus, ... }, rather
// than PKCS #8's PrivateKeyInfo, SEQUENCE { INTEGER 0, SEQUENCE algorithm, ... } (RFC 8017, A.1.2;
// RFC 5208, section 5).
const isPkcs1 = (der: Uint8Array): boolean => {
  const firstLengthByte = der[1] ?? 0
  // A DER length is one byte below 128, else 0x80 plus the count of the bytes that follow it.
  const contentStart = firstLengthByte < 0x80 ? 2 : 2 + (firstLengthByte & 0x7f)
  const sequence = der[0] === 0x30
  const versionZero = der[contentStart] === 0x02 && der[contentStart + 1] === 0x01 && der[contentStart + 2] === 0x00
  const thenAnInteger = der[contentStart + 3] === 0x02
  return sequence && versionZero && thenAnInteger
}

// PKCS #8's PrivateKeyInfo around a PKCS #1 key (RFC 5208, section 5): version 0, the algorithm
// rsaEncryption (OID 1.2.840.113549.1.1.1) with NULL parameters, and the key as an OCTET STRING.
const versionZero = Uint8Array.of(0x02, 0x01, 0x00)
const rsaEncryption = Uint8Array.of(
  0x30,
  0x0d,
  0x06,
  0x09,
  0x2a,
  0x86,
  0x48,
  0x86,
  0xf7,
  0x0d,
  0x01,
  0x01,
  0x01,
  0x05,
  0x00,
)

const wrappedInPkcs8 = (pkcs1: Uint8Array) => derElement(0x30, [versionZero, rsaEncryption, derElement(0x04, [pkcs1])])

// One DER element: its tag, the length of its content, and its content.
const derElement = (tag: number, content: ReadonlyArray<Uint8Array>): Uint8Array => {
  const length = content.reduce((total, part) => total + part.length, 0)
  return Uint8Array.from([tag, ...derLength(length), ...content.flatMap((part) => Array.from(part))])
}

// A DER definite length: one byte below 128, else 0x80 plus how many big-endian bytes follow. Three
// bytes reach 16 MB, far beyond any RSA key.
const derLength = (length: number): ReadonlyArray<number> => {
  if (length < 0x80) {
    return [length]
  }
  if (length < 0x100) {
    return [0x81, length]
  }
  if (length < 0x10000) {
    return [0x82, length >> 8, length & 0xff]
  }
  return [0x83, length >> 16, (length >> 8) & 0xff, length & 0xff]
}

// The bytes of text that is ASCII, as a JWS's base64url parts are.
const asciiBytes = (text: string) => Uint8Array.from(text, (character) => character.charCodeAt(0))
