# @bagatka/webauthn

Passkeys for a site: the options a browser or an app makes or uses one with, and the checks of what
it returns, on the platform's Web Crypto. Stateless: the caller keeps challenges and passkeys.

## Use it

```ts
import { challengeOf, creationOptions, verifyRegistration } from "@bagatka/webauthn"

// Registering: give the browser options with a fresh challenge, kept for the answer.
const options = creationOptions({
  rp: { id: "cluenori.example", name: "Cluenori" },
  user: { id: handle, name: "ada@example.com", displayName: "ada@example.com" },
  challenge,
  excludeIds: [],
})

// The browser's `credential.toJSON()` comes back; check it against what was given.
const passkey = yield* verifyRegistration(crypto.subtle, registration, {
  challenge: yield* challengeOf(registration.response.clientDataJSON), // to find the kept one by
  origin: "https://cluenori.example",
  rpId: "cluenori.example",
})
// { id, publicKey (SPKI), signCount }: keep it. A wrong challenge, page, site, or a person not
// verified fails with WebAuthnRejected, whose reason is for logs.
```

Signing in is the same with `requestOptions` and `verifyAssertion`, which checks the signature with
the kept public key and returns the counter to keep.

## Contract

`src/index.ts`. Callers build options, and check registrations and sign-ins against the challenge
they gave, the page's origin and the site. `softwareAuthenticator` makes and signs passkeys as a
device does, for tests of the sites that check them.

## Depends on

`effect`, and the platform's Web Crypto, which the host passes.

## Decisions and constraints

- **ES256 only, discoverable, verified, no attestation.** Every passkey manager makes ES256 keys;
  some Windows Hello setups can't, and the browser says so. Any authenticator may register.
- **The browser's JSON forms** (`toJSON()`, WebAuthn Level 3) are what the caller passes: the public
  key comes as SPKI, so there is no CBOR to read.
- **A counter that doesn't move on is refused,** unless it never counts, as synced passkeys don't.
