import type { CreationOptions, RequestOptions } from "@cluenori/webauthn"
import { AssertionResponse, RegistrationResponse } from "@cluenori/webauthn"
import { Effect, Schema } from "effect"

/**
 * Why the browser made or used no passkey: it can't, the person cancelled or let it time out, or the
 * device has one for this site already.
 */
export class PasskeyNotMade extends Schema.TaggedError<PasskeyNotMade>()("PasskeyNotMade", {
  reason: Schema.Literals(["unsupported", "cancelled", "exists"]),
}) {}

/** Whether this browser makes and uses passkeys from the JSON options the API gives. */
export const passkeysWork = () =>
  typeof window.PublicKeyCredential === "function" &&
  typeof window.PublicKeyCredential.parseCreationOptionsFromJSON === "function"

const requirement = (value: string): UserVerificationRequirement =>
  value === "preferred" || value === "discouraged" ? value : "required"
const residency = (value: string): ResidentKeyRequirement =>
  value === "preferred" || value === "discouraged" ? value : "required"

// What the browser says when no passkey came back: the person cancelled or waited too long, or the
// device holds one of the excluded passkeys.
const notMade = (error: unknown) =>
  new PasskeyNotMade({
    reason: error instanceof DOMException && error.name === "InvalidStateError" ? "exists" : "cancelled",
  })

const unsupported = Effect.fail(new PasskeyNotMade({ reason: "unsupported" }))

/**
 * Asks the browser to make a passkey with `options`, from the API: the person confirms with Face ID,
 * Touch ID or a PIN. What the browser returned, as the API takes it.
 */
export const makePasskey = (options: CreationOptions) =>
  Effect.gen(function* () {
    if (!passkeysWork()) {
      return yield* unsupported
    }
    const publicKey = PublicKeyCredential.parseCreationOptionsFromJSON({
      rp: options.rp,
      user: options.user,
      challenge: options.challenge,
      pubKeyCredParams: options.pubKeyCredParams.map((parameter) => ({ type: "public-key", alg: parameter.alg })),
      timeout: options.timeout,
      excludeCredentials: options.excludeCredentials.map((credential) => ({ type: "public-key", id: credential.id })),
      authenticatorSelection: {
        residentKey: residency(options.authenticatorSelection.residentKey),
        requireResidentKey: options.authenticatorSelection.requireResidentKey,
        userVerification: requirement(options.authenticatorSelection.userVerification),
      },
      attestation: "none",
    })
    const credential = yield* Effect.tryPromise({
      try: () => navigator.credentials.create({ publicKey }),
      catch: notMade,
    })
    if (!(credential instanceof PublicKeyCredential)) {
      return yield* new PasskeyNotMade({ reason: "cancelled" })
    }
    return yield* Schema.decodeUnknownEffect(RegistrationResponse)(credential.toJSON()).pipe(Effect.orDie)
  })

/**
 * Asks the browser to sign in with one of the site's passkeys, by `options` from the API. What the
 * browser returned, as the API takes it.
 */
export const askForPasskey = (options: RequestOptions) =>
  Effect.gen(function* () {
    if (!passkeysWork()) {
      return yield* unsupported
    }
    const publicKey = PublicKeyCredential.parseRequestOptionsFromJSON({
      challenge: options.challenge,
      rpId: options.rpId,
      timeout: options.timeout,
      userVerification: requirement(options.userVerification),
      allowCredentials: options.allowCredentials.map((credential) => ({ type: "public-key", id: credential.id })),
    })
    const credential = yield* Effect.tryPromise({
      try: () => navigator.credentials.get({ publicKey }),
      catch: notMade,
    })
    if (!(credential instanceof PublicKeyCredential)) {
      return yield* new PasskeyNotMade({ reason: "cancelled" })
    }
    return yield* Schema.decodeUnknownEffect(AssertionResponse)(credential.toJSON()).pipe(Effect.orDie)
  })
