import { Effect, Schema } from "effect"
import { Base64Url } from "effect/encoding"

import type { AssertionResponse, RegistrationResponse, WebAuthnCrypto } from "./webauthn.ts"

/**
 * The part of the Web Crypto API a software authenticator makes and signs passkeys with; the
 * platform's `crypto` object has it.
 */
export interface AuthenticatorCrypto {
  readonly subtle: WebAuthnCrypto & {
    generateKey(
      algorithm: { readonly name: "ECDSA"; readonly namedCurve: "P-256" },
      extractable: true,
      keyUsages: Array<"sign" | "verify">,
    ): Promise<unknown>
    exportKey(format: "spki", key: unknown): Promise<unknown>
    sign(
      algorithm: { readonly name: "ECDSA"; readonly hash: "SHA-256" },
      key: unknown,
      data: Uint8Array,
    ): Promise<ArrayBuffer>
  }
  getRandomValues(array: Uint8Array): Uint8Array
}

declare const TextEncoder: new () => { readonly encode: (input: string) => Uint8Array }

const text = (value: string) => new TextEncoder().encode(value)
const concat = (...parts: ReadonlyArray<Uint8Array>) => {
  const all = new Uint8Array(parts.reduce((length, part) => length + part.length, 0))
  let at = 0
  for (const part of parts) {
    all.set(part, at)
    at += part.length
  }
  return all
}
const sha256 = (crypto: AuthenticatorCrypto, bytes: Uint8Array) =>
  Effect.promise(() => crypto.subtle.digest("SHA-256", bytes)).pipe(Effect.map((hash) => new Uint8Array(hash)))
const counter = (value: number) =>
  Uint8Array.of(value >>> 24, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff)

// The client data a browser makes for a ceremony of `type`.
const clientData = (type: string, ceremony: Ceremony) =>
  text(`{"type":"${type}","challenge":"${ceremony.challenge}","origin":"${ceremony.origin}","crossOrigin":false}`)

// An ECDSA signature as Web Crypto makes it, r and s, as authenticators send it: DER.
const derOf = (raw: Uint8Array) => {
  const integer = (value: Uint8Array) => {
    let start = 0
    while (start < value.length - 1 && value[start] === 0) {
      start += 1
    }
    const trimmed = value.subarray(start)
    const padded = (trimmed[0] ?? 0) >= 0x80 ? concat(Uint8Array.of(0), trimmed) : trimmed
    return concat(Uint8Array.of(0x02, padded.length), padded)
  }
  const body = concat(integer(raw.subarray(0, 32)), integer(raw.subarray(32)))
  return concat(Uint8Array.of(0x30, body.length), body)
}

// What generating a key pair gives: two keys, whatever the platform's types for them.
const KeyPair = Schema.Struct({ privateKey: Schema.Unknown, publicKey: Schema.Unknown })

/** An authenticator in software and its one passkey, by `id`. */
export interface SoftwareAuthenticator {
  readonly id: string
  /** Makes the passkey for `ceremony`, as `navigator.credentials.create()` returns it. */
  readonly register: (
    ceremony: Ceremony,
    options?: { readonly verified?: boolean },
  ) => Effect.Effect<RegistrationResponse>
  /** Signs `ceremony`, as `navigator.credentials.get()` returns it. */
  readonly sign: (
    ceremony: Ceremony,
    options?: { readonly signCount?: number; readonly type?: string },
  ) => Effect.Effect<AssertionResponse>
}

/** Where a ceremony runs, and with what challenge. */
export interface Ceremony {
  readonly challenge: string
  readonly origin: string
  readonly rpId: string
}

/**
 * An authenticator in software, holding one passkey: it makes and signs as a phone's or a Mac's
 * does, with the person verified unless told otherwise. For tests of the sites that check passkeys;
 * its key lives in memory.
 */
export const softwareAuthenticator = Effect.fn("WebAuthn.softwareAuthenticator")(function* (
  crypto: AuthenticatorCrypto,
) {
  const generated = yield* Effect.promise(() =>
    crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]),
  )
  const pair = yield* Schema.decodeUnknownEffect(KeyPair)(generated).pipe(Effect.orDie)
  const exported = yield* Effect.promise(() => crypto.subtle.exportKey("spki", pair.publicKey))
  if (!(exported instanceof ArrayBuffer)) {
    return yield* Effect.die("Web Crypto exported no SPKI bytes")
  }
  const spki = new Uint8Array(exported)
  const credentialId = crypto.getRandomValues(new Uint8Array(16))
  const id = Base64Url.encode(credentialId)

  const register = (ceremony: Ceremony, options: { readonly verified?: boolean } = {}) =>
    Effect.gen(function* () {
      const flags = 0x41 | (options.verified === false ? 0 : 0x04)
      const authenticatorData = concat(
        yield* sha256(crypto, text(ceremony.rpId)),
        Uint8Array.of(flags),
        counter(0),
        new Uint8Array(16),
        Uint8Array.of(0, credentialId.length),
        credentialId,
        // The key in COSE, which the browser also gives as SPKI: these tests don't read it.
        Uint8Array.of(0xa0),
      )
      const response: RegistrationResponse = {
        id,
        type: "public-key",
        response: {
          clientDataJSON: Base64Url.encode(clientData("webauthn.create", ceremony)),
          authenticatorData: Base64Url.encode(authenticatorData),
          publicKey: Base64Url.encode(spki),
          publicKeyAlgorithm: -7,
        },
      }
      return response
    })

  const sign = (ceremony: Ceremony, options: { readonly signCount?: number; readonly type?: string } = {}) =>
    Effect.gen(function* () {
      const data = clientData(options.type ?? "webauthn.get", ceremony)
      const authenticatorData = concat(
        yield* sha256(crypto, text(ceremony.rpId)),
        Uint8Array.of(0x05),
        counter(options.signCount ?? 0),
      )
      const signed = concat(authenticatorData, yield* sha256(crypto, data))
      const raw = new Uint8Array(
        yield* Effect.promise(() => crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, signed)),
      )
      const response: AssertionResponse = {
        id,
        type: "public-key",
        response: {
          clientDataJSON: Base64Url.encode(data),
          authenticatorData: Base64Url.encode(authenticatorData),
          signature: Base64Url.encode(derOf(raw)),
          userHandle: "bWVtYmVy",
        },
      }
      return response
    })

  return { id, register, sign }
})
