import { assert, describe, it } from "@effect/vitest"
import { Crypto, Effect, Result } from "effect"

import type { WebCryptoApi } from "../src/index.ts"
import { webCryptoLayer } from "../src/index.ts"

// A stand-in for `globalThis.crypto`, which tests outside a runtime with Web Crypto types can't
// name. It fills random values with 7 and remembers how many bytes each call asked for.
const fakeWebCrypto = (digest: WebCryptoApi["subtle"]["digest"]) => {
  const requests: Array<number> = []
  const api: WebCryptoApi = {
    getRandomValues: (array) => {
      requests.push(array.length)
      return array.fill(7)
    },
    subtle: { digest },
  }
  return { api, requests }
}

const noDigest: WebCryptoApi["subtle"]["digest"] = () => Promise.resolve(new ArrayBuffer(0))

describe("webCryptoLayer", () => {
  it.effect("makes UUIDv7s from the platform's random values", () => {
    const { api } = fakeWebCrypto(noDigest)
    return Effect.gen(function* () {
      const crypto = yield* Crypto.Crypto
      const uuid = yield* crypto.randomUUIDv7()
      assert.match(uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    }).pipe(Effect.provide(webCryptoLayer(api)))
  })

  it.effect("fills more than 65,536 bytes without asking the platform for more than that at once", () => {
    const { api, requests } = fakeWebCrypto(noDigest)
    return Effect.gen(function* () {
      const crypto = yield* Crypto.Crypto
      const bytes = yield* crypto.randomBytes(200_000)
      assert.strictEqual(bytes.length, 200_000)
      assert.isTrue(bytes.every((byte) => byte === 7))
      assert.deepStrictEqual(requests, [65_536, 65_536, 65_536, 3_392])
    }).pipe(Effect.provide(webCryptoLayer(api)))
  })

  it.effect("returns the platform's digest as bytes", () => {
    const { api } = fakeWebCrypto(() => Promise.resolve(new Uint8Array([9, 8]).buffer))
    return Effect.gen(function* () {
      const crypto = yield* Crypto.Crypto
      const digest = yield* crypto.digest("SHA-256", new Uint8Array([1, 2, 3]))
      assert.deepStrictEqual([...digest], [9, 8])
    }).pipe(Effect.provide(webCryptoLayer(api)))
  })

  it.effect("fails with a PlatformError when the platform can't compute a digest", () => {
    const { api } = fakeWebCrypto(() => Promise.reject(new TypeError("Unrecognized algorithm")))
    return Effect.gen(function* () {
      const crypto = yield* Crypto.Crypto
      const digest = yield* crypto.digest("SHA-1", new Uint8Array([1])).pipe(Effect.result)
      assert.isTrue(Result.isFailure(digest))
      if (Result.isFailure(digest)) {
        assert.strictEqual(digest.failure._tag, "PlatformError")
        assert.include(digest.failure.message, "Could not compute a SHA-1 digest")
      }
    }).pipe(Effect.provide(webCryptoLayer(api)))
  })
})
