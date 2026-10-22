# @bagatka/apns

Sends pushes to Apple devices through Apple's Push Notification service (APNs), signing its provider
tokens with a token-signing key from Apple's developer site.

## Use it

```ts
import { Apns } from "@bagatka/apns"
import { Effect, Redacted } from "effect"

// In a host, where the platform's globals are known, on an HttpClient that speaks HTTP/2:
const ApnsLive = Apns.layer(
  { key: Redacted.make(p8Text), keyId: "ABCDE12345", teamId: "TEAM123456" },
  globalThis.crypto.subtle,
)

const program = Effect.gen(function* () {
  const apns = yield* Apns
  const answer = yield* apns.send({
    deviceToken,
    environment: "production",
    topic: "com.example.notes",
    priority: 10,
    payload: { aps: { alert: { title: "Notes · Down", body: "/health has failed for 3 minutes" } } },
  })
  // { _tag: "Accepted", apnsId: "…" }, or { _tag: "Rejected", status: 410, reason: "Unregistered" }
  // for a token the app no longer has: forget it.
})
```

When APNs doesn't answer in 10 seconds, or answers 429 or a server error, `send` fails with
`ApnsUnavailable`: the push may be sent again later.

## Contract

`src/index.ts`. Callers build the layer with a key and the platform's Web Crypto, and send one push
at a time, getting APNs's answer: accepted, or rejected with Apple's reason.

## Depends on

`@bagatka/es256-jwt`, to sign its provider tokens; `effect`; and an `HttpClient` the host provides.

## Settings

The key's `.p8` text, or its base64 alone, its key ID, and its team ID; they differ per Apple developer account. The
environment is per push, since a device token belongs to one APNs: development for builds Xcode
installs, production for TestFlight and the App Store.

## Decisions and constraints

- **The host passes the platform's Web Crypto.** The package compiles without DOM or Workers types,
  so `ApnsSigning` is only the two functions it signs with, `importKey` and `sign` (ES256): the
  shape `@bagatka/es256-jwt` signs with.
- **One provider token for 50 minutes.** APNs takes a token for an hour and refuses one renewed
  more often than about every 20 minutes. A token APNs calls expired anyway is renewed, and the push
  sent once more.
- **A bad key is a rejection, not an outage.** A key that isn't P-256 in PKCS #8, or IDs that aren't
  10 characters, reject every push with the reason `InvalidSigningKey`, so callers don't retry
  what can't work.
- **HTTP/2 is the host's.** APNs speaks only HTTP/2, and answers nothing over HTTP/1.1. `fetch`
  in a deployed Worker speaks it; Node's, and workerd's under `wrangler dev`, don't.
