# @cluenori/rs256-jwt

Signs JSON Web Tokens with RS256 keys, such as a GitHub App's private key, through the platform's
Web Crypto.

## Use it

```ts
import { signRs256 } from "@cluenori/rs256-jwt"
import { Effect, Redacted } from "effect"

// In a host, where the platform's globals are known, Web Crypto is `globalThis.crypto.subtle`.
const program = Effect.gen(function* () {
  const token = yield* signRs256(
    globalThis.crypto.subtle,
    Redacted.make(pemText), // "-----BEGIN RSA PRIVATE KEY-----\n…", as GitHub gives it
    { typ: "JWT" },
    { iat: 1792576740, exp: 1792577280, iss: "Iv23liExampleClient" },
  )
  // "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3OTI1NzY3NDAs….<342 characters>"
})
```

A key that isn't an RSA private key (text that isn't base64, an encrypted key, an EC key) fails
with `InvalidSigningKey`: no token can be made with it, so callers report the key rather than retry.

## Contract

`src/index.ts`. Callers pass the platform's Web Crypto, the key, a header and claims, and get a
compact JWS whose header names RS256 first and whose claims are as given.

## Does not own

What a token says and how long it is kept: each caller (`@cluenori/github`'s `GitHubApp`) chooses
its claims and when to sign a new one. Apple's ES256 tokens are signed by `@bagatka/apns`
and `@bagatka/app-store-connect`.

## Depends on

`effect`, and the platform's Web Crypto, which the host passes.

## Decisions and constraints

- **PKCS #1 or PKCS #8, told apart by the key's own bytes.** Web Crypto imports PKCS #8 alone, and
  GitHub gives PKCS #1 (`BEGIN RSA PRIVATE KEY`), so a PKCS #1 key is wrapped in PKCS #8's
  PrivateKeyInfo with a few bytes of DER (RFC 5208): version 0, rsaEncryption, the key as an
  OCTET STRING. Which one a key is comes from its DER, not its armor, so the base64 alone works too.
- **The host passes Web Crypto,** typed as only the two functions signing uses; `alg` is always
  RS256, whatever the header says; the key is imported on every call. `@bagatka/jwt` replaces it.
- **Two-prime keys.** A multi-prime PKCS #1 key (version 1), which neither GitHub nor OpenSSL makes
  by default, isn't recognized, and fails with `InvalidSigningKey`.
