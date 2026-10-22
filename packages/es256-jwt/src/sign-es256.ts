import { Effect, Record, Redacted, Result, Schema } from "effect"
import { Base64, Base64Url } from "effect/encoding"

/**
 * The part of the Web Crypto API this package signs with: `globalThis.crypto.subtle` in Workers,
 * browsers, Bun, and Node.
 */
export interface Es256Signing {
  importKey(
    format: "pkcs8",
    keyData: Uint8Array,
    algorithm: { readonly name: "ECDSA"; readonly namedCurve: "P-256" },
    extractable: false,
    keyUsages: Array<"sign">,
  ): Promise<unknown>
  sign(
    algorithm: { readonly name: "ECDSA"; readonly hash: "SHA-256" },
    key: unknown,
    data: Uint8Array,
  ): Promise<ArrayBuffer>
}

/** The key couldn't sign: it isn't a P-256 key in PKCS #8. Signing again with it won't help. */
export class InvalidSigningKey extends Schema.TaggedError<InvalidSigningKey>()("InvalidSigningKey", {}) {}

const keyAlgorithm = { name: "ECDSA", namedCurve: "P-256" } as const
const signatureAlgorithm = { name: "ECDSA", hash: "SHA-256" } as const

const encodeJsonText = Schema.encodeEffect(Schema.fromJsonString(Schema.JsonObject))

/**
 * A compact JWS signed with ES256: the header `{"alg":"ES256", ...header}`, whose `alg` stays
 * ES256 whatever `header` says, then `claims`, each as JSON in the order given, and the signature,
 * raw r‖s, all base64url. `key` is a `.p8` file's text, PEM armor and all, or the base64 inside it
 * alone. The key is imported on every call, so callers that need tokens often keep one for its
 * lifetime instead of signing per request. Fails with `InvalidSigningKey` when the key isn't a
 * P-256 key in PKCS #8.
 */
export const signEs256 = Effect.fn("signEs256")(function* (
  signing: Es256Signing,
  key: Redacted.Redacted,
  header: Schema.JsonObject,
  claims: Schema.JsonObject,
) {
  const der = Base64.decode(base64Of(Redacted.value(key)))
  if (Result.isFailure(der)) {
    return yield* new InvalidSigningKey()
  }
  const signingKey = yield* Effect.tryPromise({
    try: () => signing.importKey("pkcs8", der.success, keyAlgorithm, false, ["sign"]),
    catch: () => new InvalidSigningKey(),
  })
  const protectedHeader = { alg: "ES256", ...Record.remove<string, Schema.Json, "alg">(header, "alg") }
  const headerText = yield* encodeJsonText(protectedHeader).pipe(Effect.orDie)
  const claimsText = yield* encodeJsonText(claims).pipe(Effect.orDie)
  const unsigned = `${Base64Url.encode(headerText)}.${Base64Url.encode(claimsText)}`
  const signature = yield* Effect.tryPromise({
    try: () => signing.sign(signatureAlgorithm, signingKey, asciiBytes(unsigned)),
    catch: () => new InvalidSigningKey(),
  })
  // Web Crypto's ECDSA signature is already r‖s, 32 bytes each, the form JWS takes (RFC 7518, 3.4).
  return `${unsigned}.${Base64Url.encode(new Uint8Array(signature))}`
})

// The base64 of a `.p8` file's PKCS #8 bytes: its text without the PEM armor and line breaks.
const base64Of = (text: string) => text.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "")

// The bytes of text that is ASCII, as a JWS's base64url parts are.
const asciiBytes = (text: string) => Uint8Array.from(text, (character) => character.charCodeAt(0))
