import { Crypto, Effect, Layer, PlatformError } from "effect"

/**
 * The part of the Web Crypto API this package uses. `globalThis.crypto` provides it in Workers,
 * browsers, Bun, and Node.
 */
export interface WebCryptoApi {
  readonly getRandomValues: (array: Uint8Array) => Uint8Array
  readonly subtle: {
    readonly digest: (algorithm: Crypto.DigestAlgorithm, data: Uint8Array) => Promise<ArrayBuffer>
  }
}

// Web Crypto fills at most 65,536 bytes per call and throws for more.
const maxBytesPerCall = 65_536

/**
 * Effect's `Crypto` service on the Web Crypto API: pass `globalThis.crypto`. Random values and UUIDs
 * come from `getRandomValues`, digests from `subtle.digest`.
 */
export const webCryptoLayer = (webCrypto: WebCryptoApi): Layer.Layer<Crypto.Crypto> =>
  Layer.succeed(
    Crypto.Crypto,
    Crypto.make({
      randomBytes: (size) => {
        const bytes = new Uint8Array(size)
        for (let offset = 0; offset < size; offset += maxBytesPerCall) {
          webCrypto.getRandomValues(bytes.subarray(offset, offset + maxBytesPerCall))
        }
        return bytes
      },
      digest: (algorithm, data) =>
        Effect.tryPromise({
          try: () => webCrypto.subtle.digest(algorithm, data),
          catch: (cause) =>
            PlatformError.systemError({
              _tag: "Unknown",
              module: "Crypto",
              method: "digest",
              description: `Could not compute a ${algorithm} digest`,
              cause,
            }),
        }).pipe(Effect.map((digest) => new Uint8Array(digest))),
    }),
  )
