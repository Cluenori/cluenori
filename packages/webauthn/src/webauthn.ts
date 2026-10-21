import { Effect, Result, Schema } from "effect"
import { Base64Url } from "effect/encoding"

/**
 * The part of the Web Crypto API this package checks passkeys with: `globalThis.crypto.subtle` in
 * Workers, browsers, Bun, and Node.
 */
export interface WebAuthnCrypto {
  digest(algorithm: "SHA-256", data: Uint8Array): Promise<ArrayBuffer>
  importKey(
    format: "spki",
    keyData: Uint8Array,
    algorithm: { readonly name: "ECDSA"; readonly namedCurve: "P-256" },
    extractable: false,
    keyUsages: Array<"verify">,
  ): Promise<unknown>
  verify(
    algorithm: { readonly name: "ECDSA"; readonly hash: "SHA-256" },
    key: unknown,
    signature: Uint8Array,
    data: Uint8Array,
  ): Promise<boolean>
}

/** Who a passkey is for, as the browser shows it: the relying party is the site, by its hostname. */
export interface CreationInput {
  readonly rp: { readonly id: string; readonly name: string }
  /** `id` is the account's opaque handle, base64url; `name` what the person knows it by, an email. */
  readonly user: { readonly id: string; readonly name: string; readonly displayName: string }
  /** 32 random bytes or more, base64url, used once. */
  readonly challenge: string
  /** The person's passkeys already registered, so the device doesn't make a second. */
  readonly excludeIds: ReadonlyArray<string>
}

const PasskeyCredential = Schema.Struct({ type: Schema.String, id: Schema.String }).annotate({
  identifier: "PasskeyCredential",
})

/**
 * Options for `navigator.credentials.create()`, as `PublicKeyCredential.parseCreationOptionsFromJSON`
 * reads them, and as an app passes them to the platform's passkey request.
 */
export const CreationOptions = Schema.Struct({
  rp: Schema.Struct({ id: Schema.String, name: Schema.String }).annotate({ identifier: "PasskeySite" }),
  user: Schema.Struct({ id: Schema.String, name: Schema.String, displayName: Schema.String }).annotate({
    identifier: "PasskeyUser",
  }),
  challenge: Schema.String,
  pubKeyCredParams: Schema.Array(
    Schema.Struct({ type: Schema.String, alg: Schema.Int }).annotate({ identifier: "PasskeyAlgorithm" }),
  ),
  timeout: Schema.Int,
  excludeCredentials: Schema.Array(PasskeyCredential),
  authenticatorSelection: Schema.Struct({
    residentKey: Schema.String,
    requireResidentKey: Schema.Boolean,
    userVerification: Schema.String,
  }).annotate({ identifier: "PasskeySelection" }),
  attestation: Schema.String,
}).annotate({ identifier: "PasskeyCreationOptions" })
export type CreationOptions = typeof CreationOptions.Type

/**
 * Options for `navigator.credentials.get()`, as `PublicKeyCredential.parseRequestOptionsFromJSON`
 * reads them, and as an app passes them to the platform's passkey request.
 */
export const RequestOptions = Schema.Struct({
  challenge: Schema.String,
  rpId: Schema.String,
  timeout: Schema.Int,
  userVerification: Schema.String,
  allowCredentials: Schema.Array(PasskeyCredential),
}).annotate({ identifier: "PasskeyRequestOptions" })
export type RequestOptions = typeof RequestOptions.Type

/**
 * The options that make a passkey: discoverable, verified by the person (Face ID, Touch ID, a PIN),
 * ES256, and without attestation.
 */
export const creationOptions = (input: CreationInput): CreationOptions => ({
  rp: { id: input.rp.id, name: input.rp.name },
  user: { id: input.user.id, name: input.user.name, displayName: input.user.displayName },
  challenge: input.challenge,
  // Not handled: authenticators without ES256, which some Windows Hello setups lack; they can't
  // make a passkey here, and the browser says so.
  pubKeyCredParams: [{ type: "public-key", alg: es256 }],
  timeout: ceremonyMs,
  excludeCredentials: input.excludeIds.map((id) => ({ type: "public-key", id })),
  authenticatorSelection: { residentKey: "required", requireResidentKey: true, userVerification: "required" },
  attestation: "none",
})

/** The options that sign in with any of the site's passkeys, verified by the person. */
export const requestOptions = (input: { readonly rpId: string; readonly challenge: string }): RequestOptions => ({
  challenge: input.challenge,
  rpId: input.rpId,
  timeout: ceremonyMs,
  userVerification: "required",
  allowCredentials: [],
})

/** What `navigator.credentials.create()` returned, as its `toJSON()` gives it. */
export const RegistrationResponse = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
  response: Schema.Struct({
    clientDataJSON: Schema.String,
    authenticatorData: Schema.String,
    /** SPKI, base64url; absent when the browser can't read the key's algorithm. */
    publicKey: Schema.optionalKey(Schema.String),
    publicKeyAlgorithm: Schema.Finite,
  }).annotate({ identifier: "PasskeyAttestation" }),
}).annotate({ identifier: "PasskeyRegistration" })
export type RegistrationResponse = typeof RegistrationResponse.Type

/** What `navigator.credentials.get()` returned, as its `toJSON()` gives it. */
export const AssertionResponse = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
  response: Schema.Struct({
    clientDataJSON: Schema.String,
    authenticatorData: Schema.String,
    signature: Schema.String,
    userHandle: Schema.optionalKey(Schema.String),
  }).annotate({ identifier: "PasskeySignature" }),
}).annotate({ identifier: "PasskeyAssertion" })
export type AssertionResponse = typeof AssertionResponse.Type

/** What a ceremony must match: the challenge the server gave, the page's origin, and the site. */
export interface Expected {
  readonly challenge: string
  /** `https://cluenori.example`, as the page that ran the ceremony is served. */
  readonly origin: string
  /** The site's hostname: `cluenori.example`. */
  readonly rpId: string
}

/** A registered passkey: its ID, its public key as SPKI, both base64url, and its signature counter. */
export interface Passkey {
  readonly id: string
  readonly publicKey: string
  readonly signCount: number
}

/**
 * The challenge a ceremony's client data names, unchecked: what to look up the challenge given for
 * it by, before checking the rest with it.
 */
export const challengeOf = Effect.fn("WebAuthn.challengeOf")(function* (clientDataJSON: string) {
  const bytes = yield* bytesOf(clientDataJSON, "client data")
  const clientData = yield* Schema.decodeEffect(ClientData)(utf8.decode(bytes)).pipe(
    Effect.mapError(() => new WebAuthnRejected({ reason: "The client data isn't WebAuthn's JSON" })),
  )
  return clientData.challenge
})

/** The passkey's answer doesn't hold: `reason` says what, for logs; tell the person only to try again. */
export class WebAuthnRejected extends Schema.TaggedError<WebAuthnRejected>()("WebAuthnRejected", {
  reason: Schema.String,
}) {}

/**
 * Checks a new passkey: its client data is a creation for `expected`'s challenge and origin, its
 * authenticator data is for `expected`'s site with the person present and verified, and its key is
 * ES256. The passkey to keep, with its counter. Attestation isn't checked: any authenticator may
 * register.
 */
export const verifyRegistration = Effect.fn("WebAuthn.verifyRegistration")(function* (
  crypto: WebAuthnCrypto,
  registration: RegistrationResponse,
  expected: Expected,
) {
  yield* checkClientData(registration.response.clientDataJSON, "webauthn.create", expected)
  const data = yield* bytesOf(registration.response.authenticatorData, "authenticator data")
  const authenticator = yield* checkAuthenticatorData(crypto, data, expected.rpId)
  if (((data[32] ?? 0) & attestedData) !== 0) {
    const length = ((data[53] ?? 0) << 8) | (data[54] ?? 0)
    const id = Base64Url.encode(data.subarray(55, 55 + length))
    if (id !== registration.id) {
      return yield* new WebAuthnRejected({ reason: "The credential's ID isn't the one its data names" })
    }
  } else {
    return yield* new WebAuthnRejected({ reason: "The authenticator data has no credential" })
  }
  const publicKey = registration.response.publicKey
  if (registration.response.publicKeyAlgorithm !== es256 || publicKey === undefined) {
    return yield* new WebAuthnRejected({ reason: "The passkey's key isn't ES256" })
  }
  yield* importKey(crypto, publicKey)
  const passkey: Passkey = { id: registration.id, publicKey, signCount: authenticator.signCount }
  return passkey
})

/**
 * Checks a sign-in with `passkey`: its client data is a request for `expected`'s challenge and
 * origin, its authenticator data is for `expected`'s site with the person present and verified,
 * its signature is the passkey's, and its counter moved on, unless the authenticator keeps none.
 * The counter to keep.
 */
export const verifyAssertion = Effect.fn("WebAuthn.verifyAssertion")(function* (
  crypto: WebAuthnCrypto,
  assertion: AssertionResponse,
  passkey: Passkey,
  expected: Expected,
) {
  if (assertion.id !== passkey.id) {
    return yield* new WebAuthnRejected({ reason: "The assertion is another passkey's" })
  }
  const clientData = yield* checkClientData(assertion.response.clientDataJSON, "webauthn.get", expected)
  const data = yield* bytesOf(assertion.response.authenticatorData, "authenticator data")
  const authenticator = yield* checkAuthenticatorData(crypto, data, expected.rpId)
  const der = yield* bytesOf(assertion.response.signature, "signature")
  const signature = rawOf(der)
  if (signature === undefined) {
    return yield* new WebAuthnRejected({ reason: "The signature isn't DER ECDSA" })
  }
  const key = yield* importKey(crypto, passkey.publicKey)
  const clientDataHash = new Uint8Array(yield* Effect.promise(() => crypto.digest("SHA-256", clientData)))
  const signed = new Uint8Array(data.length + clientDataHash.length)
  signed.set(data)
  signed.set(clientDataHash, data.length)
  const valid = yield* Effect.tryPromise({
    try: () => crypto.verify({ name: "ECDSA", hash: "SHA-256" }, key, signature, signed),
    catch: () => new WebAuthnRejected({ reason: "The signature couldn't be checked" }),
  })
  if (!valid) {
    return yield* new WebAuthnRejected({ reason: "The signature isn't the passkey's" })
  }
  // A counter that doesn't move on means a copy of the key signed: unless it never counts, as
  // synced passkeys don't.
  if ((authenticator.signCount !== 0 || passkey.signCount !== 0) && authenticator.signCount <= passkey.signCount) {
    return yield* new WebAuthnRejected({ reason: "The signature counter went back" })
  }
  return { signCount: authenticator.signCount }
})

const es256 = -7
const ceremonyMs = 300_000

// The authenticator data's flags: the person is present, verified, and the data names a credential.
const userPresent = 0x01
const userVerified = 0x04
const attestedData = 0x40

const ClientData = Schema.fromJsonString(
  Schema.Struct({
    type: Schema.String,
    challenge: Schema.String,
    origin: Schema.String,
    crossOrigin: Schema.optionalKey(Schema.Boolean),
  }),
)

const bytesOf = (base64url: string, what: string): Effect.Effect<Uint8Array, WebAuthnRejected> =>
  Result.match(Base64Url.decode(base64url), {
    onFailure: () => Effect.fail(new WebAuthnRejected({ reason: `The ${what} isn't base64url` })),
    onSuccess: (bytes) => Effect.succeed(bytes),
  })

// The client data's bytes, once its type, challenge and origin are the ones expected.
const checkClientData = Effect.fnUntraced(function* (base64url: string, type: string, expected: Expected) {
  const bytes = yield* bytesOf(base64url, "client data")
  const clientData = yield* Schema.decodeEffect(ClientData)(utf8.decode(bytes)).pipe(
    Effect.mapError(() => new WebAuthnRejected({ reason: "The client data isn't WebAuthn's JSON" })),
  )
  if (clientData.type !== type) {
    return yield* new WebAuthnRejected({ reason: `The client data is a ${clientData.type}, not a ${type}` })
  }
  if (clientData.challenge !== expected.challenge) {
    return yield* new WebAuthnRejected({ reason: "The challenge isn't the one given" })
  }
  if (clientData.origin !== expected.origin || clientData.crossOrigin === true) {
    return yield* new WebAuthnRejected({ reason: `The origin ${clientData.origin} isn't ${expected.origin}` })
  }
  return bytes
})

// The authenticator data's counter, once it is for the site, with the person present and verified.
const checkAuthenticatorData = Effect.fnUntraced(function* (crypto: WebAuthnCrypto, data: Uint8Array, rpId: string) {
  if (data.length < 37) {
    return yield* new WebAuthnRejected({ reason: "The authenticator data is too short" })
  }
  const rpIdHash = new Uint8Array(yield* Effect.promise(() => crypto.digest("SHA-256", utf8.encode(rpId))))
  if (!rpIdHash.every((byte, index) => byte === data[index])) {
    return yield* new WebAuthnRejected({ reason: `The passkey isn't for ${rpId}` })
  }
  const flags = data[32] ?? 0
  if ((flags & userPresent) === 0 || (flags & userVerified) === 0) {
    return yield* new WebAuthnRejected({ reason: "The person wasn't verified" })
  }
  const signCount = (((data[33] ?? 0) << 24) >>> 0) + ((data[34] ?? 0) << 16) + ((data[35] ?? 0) << 8) + (data[36] ?? 0)
  return { signCount }
})

const importKey = (crypto: WebAuthnCrypto, publicKey: string) =>
  bytesOf(publicKey, "public key").pipe(
    Effect.flatMap((spki) =>
      Effect.tryPromise({
        try: () => crypto.importKey("spki", spki, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]),
        catch: () => new WebAuthnRejected({ reason: "The public key isn't a P-256 key" }),
      }),
    ),
  )

// An ECDSA signature as DER, `SEQUENCE { INTEGER r, INTEGER s }`, as Web Crypto takes it: r and s,
// 32 bytes each. Undefined for anything else.
const rawOf = (der: Uint8Array): Uint8Array | undefined => {
  if (der[0] !== 0x30) {
    return undefined
  }
  const integer = (at: number) => {
    if (der[at] !== 0x02) {
      return undefined
    }
    const length = der[at + 1] ?? 0
    const value = der.subarray(at + 2, at + 2 + length)
    const trimmed = value[0] === 0 ? value.subarray(1) : value
    return trimmed.length > 32 || value.length !== length ? undefined : { value: trimmed, next: at + 2 + length }
  }
  const r = integer(2)
  const s = r === undefined ? undefined : integer(r.next)
  if (r === undefined || s === undefined || s.next !== der.length) {
    return undefined
  }
  const raw = new Uint8Array(64)
  raw.set(r.value, 32 - r.value.length)
  raw.set(s.value, 64 - s.value.length)
  return raw
}

// Every runtime this package runs on has these; declared here, in this package's terms.
declare const TextEncoder: new () => { readonly encode: (input: string) => Uint8Array }
declare const TextDecoder: new (label: "utf-8") => { readonly decode: (input: Uint8Array) => string }
const utf8 = {
  encode: (text: string) => new TextEncoder().encode(text),
  decode: (bytes: Uint8Array) => new TextDecoder("utf-8").decode(bytes),
}
