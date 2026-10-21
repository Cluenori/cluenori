import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"

import type { Expected } from "../src/index.ts"
import type { AuthenticatorCrypto } from "../src/index.ts"
import {
  challengeOf,
  creationOptions,
  requestOptions,
  softwareAuthenticator,
  verifyAssertion,
  verifyRegistration,
} from "../src/index.ts"

// The runtime's Web Crypto, which tests outside a runtime with its types can't name.
declare const crypto: AuthenticatorCrypto
const subtle = crypto.subtle
const newAuthenticator = softwareAuthenticator(crypto)

const expected: Expected = {
  challenge: "q3W8mYpZf1o7oG2bTnS0xR4kL9vC6aJ2eH5dU8iN1wE",
  origin: "https://cluenori.example",
  rpId: "cluenori.example",
}

const reasonOf = <A>(effect: Effect.Effect<A, { readonly reason: string }>) =>
  effect.pipe(
    Effect.flip,
    Effect.map((rejected) => rejected.reason),
  )

describe("passkeys", () => {
  it.effect("registers a passkey made for the site, and signs in with it", () =>
    Effect.gen(function* () {
      const authenticator = yield* newAuthenticator
      const registration = yield* authenticator.register(expected)
      assert.strictEqual(yield* challengeOf(registration.response.clientDataJSON), expected.challenge)
      const passkey = yield* verifyRegistration(subtle, registration, expected)
      assert.strictEqual(passkey.id, authenticator.id)
      assert.strictEqual(passkey.signCount, 0)

      // Synced passkeys count nothing; one that counts must count on.
      const synced = yield* verifyAssertion(subtle, yield* authenticator.sign(expected), passkey, expected)
      assert.strictEqual(synced.signCount, 0)
      const counted = yield* verifyAssertion(
        subtle,
        yield* authenticator.sign(expected, { signCount: 7 }),
        { ...passkey, signCount: 6 },
        expected,
      )
      assert.strictEqual(counted.signCount, 7)
    }),
  )

  it.effect("refuses a passkey made for another challenge, page or site, or without the person verified", () =>
    Effect.gen(function* () {
      const authenticator = yield* newAuthenticator
      const register = (ceremony: Partial<Expected>, options: { readonly verified?: boolean } = {}) =>
        authenticator.register({ ...expected, ...ceremony }, options)

      assert.strictEqual(
        yield* reasonOf(verifyRegistration(subtle, yield* register({ challenge: "an-old-one" }), expected)),
        "The challenge isn't the one given",
      )
      assert.strictEqual(
        yield* reasonOf(verifyRegistration(subtle, yield* register({ origin: "https://evil.example" }), expected)),
        "The origin https://evil.example isn't https://cluenori.example",
      )
      assert.strictEqual(
        yield* reasonOf(verifyRegistration(subtle, yield* register({ rpId: "evil.example" }), expected)),
        "The passkey isn't for cluenori.example",
      )
      assert.strictEqual(
        yield* reasonOf(verifyRegistration(subtle, yield* register({}, { verified: false }), expected)),
        "The person wasn't verified",
      )
      const rsa = yield* register({})
      assert.strictEqual(
        yield* reasonOf(
          verifyRegistration(subtle, { ...rsa, response: { ...rsa.response, publicKeyAlgorithm: -257 } }, expected),
        ),
        "The passkey's key isn't ES256",
      )
    }),
  )

  it.effect("refuses a sign-in signed by another key, with its data changed, or with its counter gone back", () =>
    Effect.gen(function* () {
      const authenticator = yield* newAuthenticator
      const other = yield* newAuthenticator
      const passkey = yield* verifyRegistration(subtle, yield* authenticator.register(expected), expected)

      const forged = yield* other.sign(expected)
      assert.strictEqual(
        yield* reasonOf(verifyAssertion(subtle, { ...forged, id: passkey.id }, passkey, expected)),
        "The signature isn't the passkey's",
      )
      const signed = yield* authenticator.sign(expected, { signCount: 3 })
      const changed = yield* authenticator.sign(expected, { signCount: 9 })
      assert.strictEqual(
        yield* reasonOf(
          verifyAssertion(
            subtle,
            { ...signed, response: { ...signed.response, authenticatorData: changed.response.authenticatorData } },
            passkey,
            expected,
          ),
        ),
        "The signature isn't the passkey's",
      )
      assert.strictEqual(
        yield* reasonOf(verifyAssertion(subtle, signed, { ...passkey, signCount: 3 }, expected)),
        "The signature counter went back",
      )
      assert.strictEqual(
        yield* reasonOf(
          verifyAssertion(subtle, yield* authenticator.sign(expected, { type: "webauthn.create" }), passkey, expected),
        ),
        "The client data is a webauthn.create, not a webauthn.get",
      )
      assert.strictEqual(
        yield* reasonOf(verifyAssertion(subtle, signed, { ...passkey, id: other.id }, expected)),
        "The assertion is another passkey's",
      )
    }),
  )

  it.effect("asks browsers for a discoverable ES256 passkey the person verifies, without attestation", () =>
    Effect.sync(() => {
      const options = creationOptions({
        rp: { id: "cluenori.example", name: "Cluenori" },
        user: { id: "bWVtYmVy", name: "ada@example.com", displayName: "ada@example.com" },
        challenge: expected.challenge,
        excludeIds: ["c29tZS1rZXk"],
      })
      assert.deepStrictEqual(options.pubKeyCredParams, [{ type: "public-key", alg: -7 }])
      assert.deepStrictEqual(options.authenticatorSelection, {
        residentKey: "required",
        requireResidentKey: true,
        userVerification: "required",
      })
      assert.strictEqual(options["attestation"], "none")
      assert.deepStrictEqual(options["excludeCredentials"], [{ type: "public-key", id: "c29tZS1rZXk" }])
      assert.deepStrictEqual(
        requestOptions({ rpId: "cluenori.example", challenge: expected.challenge })["allowCredentials"],
        [],
      )
    }),
  )
})
