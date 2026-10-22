import { Effect, Redacted, Result } from "effect"
import { Hex } from "effect/encoding"

// The runtime's TextEncoder, a web standard in every runtime this runs on, which the package's
// types don't name.
declare const TextEncoder: new () => { readonly encode: (input: string) => Uint8Array }

/**
 * The part of the Web Crypto API webhooks are checked with: `globalThis.crypto.subtle` in Workers,
 * browsers, Bun, and Node.
 */
export interface WebhookVerifying {
  importKey(
    format: "raw",
    keyData: Uint8Array,
    algorithm: { readonly name: "HMAC"; readonly hash: "SHA-256" },
    extractable: false,
    keyUsages: Array<"sign">,
  ): Promise<unknown>
  sign(algorithm: "HMAC", key: unknown, data: Uint8Array): Promise<ArrayBuffer>
}

const hmacSha256 = { name: "HMAC", hash: "SHA-256" } as const
const prefix = "sha256="

/**
 * Whether `signature`, a delivery's `X-Hub-Signature-256` header, signs `body`, the delivery's
 * bytes as they came, with the webhook's `secret`: `sha256=` and the hex of their HMAC-SHA256. The
 * two MACs are compared in time that depends on their length alone. A secret Web Crypto can't key
 * HMAC with, such as an empty one, is a defect.
 */
export const verifyWebhook = Effect.fn("verifyWebhook")(function* (
  crypto: WebhookVerifying,
  secret: Redacted.Redacted,
  body: Uint8Array,
  signature: string,
) {
  const presented = signature.startsWith(prefix) ? Hex.decode(signature.slice(prefix.length)) : undefined
  if (presented === undefined || Result.isFailure(presented)) {
    return false
  }
  const key = yield* Effect.tryPromise({
    try: () => crypto.importKey("raw", new TextEncoder().encode(Redacted.value(secret)), hmacSha256, false, ["sign"]),
    catch: () => "The webhook's secret can't key HMAC-SHA256: it is empty, or the platform has no HMAC",
  })
  const mac = yield* Effect.tryPromise({
    try: () => crypto.sign("HMAC", key, body),
    catch: () => "Web Crypto couldn't sign the webhook's body with HMAC-SHA256",
  })
  return sameBytes(new Uint8Array(mac), presented.success)
}, Effect.orDie)

// Whether two byte strings are equal, looking at every byte whatever differs, so how long it takes
// says nothing about where they differ.
const sameBytes = (a: Uint8Array, b: Uint8Array) => {
  const sameLength = a.length === b.length
  const difference = a.reduce((bits, byte, index) => bits | (byte ^ (b[index] ?? 0)), 0)
  return sameLength && difference === 0
}
