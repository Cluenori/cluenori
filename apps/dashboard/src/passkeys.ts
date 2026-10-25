import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from "@bagatka/webauthn"
import { AuthenticationResponseJSON, RegistrationResponseJSON } from "@bagatka/webauthn"
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
export const makePasskey = (options: PublicKeyCredentialCreationOptionsJSON) =>
  Effect.gen(function* () {
    if (!passkeysWork()) {
      return yield* unsupported
    }
    const publicKey = PublicKeyCredential.parseCreationOptionsFromJSON(options)
    const credential = yield* Effect.tryPromise({
      try: () => navigator.credentials.create({ publicKey }),
      catch: notMade,
    })
    if (!(credential instanceof PublicKeyCredential)) {
      return yield* new PasskeyNotMade({ reason: "cancelled" })
    }
    return yield* Schema.decodeUnknownEffect(RegistrationResponseJSON)(credential.toJSON()).pipe(Effect.orDie)
  })

/**
 * Asks the browser to sign in with one of the site's passkeys, by `options` from the API. What the
 * browser returned, as the API takes it.
 */
export const askForPasskey = (options: PublicKeyCredentialRequestOptionsJSON) =>
  Effect.gen(function* () {
    if (!passkeysWork()) {
      return yield* unsupported
    }
    const publicKey = PublicKeyCredential.parseRequestOptionsFromJSON(options)
    const credential = yield* Effect.tryPromise({
      try: () => navigator.credentials.get({ publicKey }),
      catch: notMade,
    })
    if (!(credential instanceof PublicKeyCredential)) {
      return yield* new PasskeyNotMade({ reason: "cancelled" })
    }
    return yield* Schema.decodeUnknownEffect(AuthenticationResponseJSON)(credential.toJSON()).pipe(Effect.orDie)
  })
