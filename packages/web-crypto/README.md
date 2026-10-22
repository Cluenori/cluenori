# @cluenori/web-crypto

Effect's `Crypto` service (random values, UUIDs, digests) on the Web Crypto API, for runtimes that
have Web Crypto but no Effect platform package, such as Cloudflare Workers.

## Use it

```ts
import { webCryptoLayer } from "@cluenori/web-crypto"
import { Crypto, Effect } from "effect"

// In a host, where the platform's globals are known:
const CryptoLive = webCryptoLayer(globalThis.crypto)

const program = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto
  return yield* crypto.randomUUIDv7()
})
// program.pipe(Effect.provide(CryptoLive)): "0199f7a2-5c1e-7d3a-9b2f-4e8a1c6d0f53"
```

A digest the platform can't compute fails with a `PlatformError` that names the algorithm.

## Contract

`src/index.ts`. Callers pass the platform's Web Crypto object and get a layer for Effect's `Crypto`
service.

## Depends on

`effect`.

## Decisions and constraints

- **The host passes the platform's object.** The package compiles without DOM or Workers types, so it
  declares only the two Web Crypto functions it uses, and any object with that shape works,
  including a fake in tests.
- **Large random requests are split.** Web Crypto fills at most 65,536 bytes per call, so larger
  requests are filled in pieces of that size.
