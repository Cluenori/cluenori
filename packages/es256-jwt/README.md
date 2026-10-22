# @bagatka/es256-jwt

Signs JSON Web Tokens with ES256 keys, such as the `.p8` keys Apple gives for APNs and the App
Store Connect API, through the platform's Web Crypto.

## Use it

```ts
import { signEs256 } from "@bagatka/es256-jwt"
import { Effect, Redacted } from "effect"

// In a host, where the platform's globals are known, Web Crypto is `globalThis.crypto.subtle`.
const program = Effect.gen(function* () {
  const token = yield* signEs256(
    globalThis.crypto.subtle,
    Redacted.make(p8Text),
    { kid: "2X9R4HXF34", typ: "JWT" },
    { iss: issuerId, iat: 1792576800, exp: 1792578000, aud: "appstoreconnect-v1" },
  )
  // "eyJhbGciOiJFUzI1NiIsImtpZCI6IjJYOVI0SFhGMzQiLCJ0eXAiOiJKV1QifQ.eyJpc3MiOi….<86 characters>"
})
```

A key that isn't a P-256 key in PKCS #8 (text that isn't base64, a key on another curve) fails with
`InvalidSigningKey`: no token can be made with it, so callers report the key rather than retry.

## Contract

`src/index.ts`. Callers pass the platform's Web Crypto, the key, a header and claims, and get a
compact JWS whose header names ES256 first and whose claims are as given.

## Does not own

What a token says and how long it is kept: each caller (`@bagatka/apns`,
`@bagatka/app-store-connect`) chooses its claims and when to sign a new one.

## Depends on

`effect`, and the platform's Web Crypto, which the host passes.

## Decisions and constraints

- **The host passes the platform's Web Crypto.** The package compiles without DOM or Workers types,
  so it declares only the two functions it signs with, `importKey` and `sign`.
- **The signature is r‖s, as JWS takes it** (RFC 7518, section 3.4). Web Crypto's ECDSA output is
  already in that form, so nothing converts it, unlike a DER signature from OpenSSL.
- **The key is the `.p8` text, or the base64 inside it.** The PEM armor and line breaks are removed;
  `.dev.vars` often holds the base64 alone, on one line.
- **`alg` is always ES256.** A header that names another algorithm doesn't change it, so a token
  never claims to be signed differently than it is.
- **The key is imported on every call.** Callers that need tokens often keep one for its lifetime,
  as APNs and App Store Connect both ask.
