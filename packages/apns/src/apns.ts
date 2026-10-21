import { Clock, Context, Duration, Effect, Layer, Option, Redacted, Ref, Result, Schema } from "effect"
import { Base64, Base64Url } from "effect/encoding"
import { HttpClient, HttpClientRequest } from "effect/http"

/**
 * A token-signing key from Apple's developer site: its `.p8` file's text, or the base64 inside it
 * alone; its 10-character key ID; and the 10-character ID of the team it belongs to.
 */
export interface ApnsCredentials {
  readonly key: Redacted.Redacted
  readonly keyId: string
  readonly teamId: string
}

/**
 * The part of the Web Crypto API this package signs with: `globalThis.crypto.subtle` in Workers,
 * browsers, Bun, and Node.
 */
export interface ApnsSigning {
  importKey(
    format: "pkcs8",
    keyData: Uint8Array,
    algorithm: { readonly name: "ECDSA"; readonly namedCurve: "P-256" },
    extractable: false,
    keyUsages: Array<"sign">,
  ): Promise<unknown>
  sign(
    algorithm: { readonly name: "ECDSA"; readonly hash: "SHA-256" },
    key: unknown,
    data: Uint8Array,
  ): Promise<ArrayBuffer>
}

/** Which APNs a device token belongs to: a build signed for development, or one from TestFlight or the App Store. */
export type ApnsEnvironment = "development" | "production"

/** One push to one device. */
export interface ApnsPush {
  /** The device token the app registered, in hex. */
  readonly deviceToken: string
  readonly environment: ApnsEnvironment
  /** The app's bundle ID. */
  readonly topic: string
  /** 10 to deliver at once, 5 when the device saves power. */
  readonly priority: 5 | 10
  /** The JSON payload: `aps` and anything of the app's own; at most 4 KB. */
  readonly payload: Schema.JsonObject
  /** Pushes with one collapse ID show as one notification, the latest. */
  readonly collapseId?: string
  /** When APNs stops trying to deliver it, in Unix seconds; at once when absent. */
  readonly expiresAt?: number
}

/** What APNs answered a push: accepted, or rejected for a `reason` sending again won't change. */
export type ApnsAnswer =
  | { readonly _tag: "Accepted"; readonly apnsId: string }
  | { readonly _tag: "Rejected"; readonly status: number; readonly reason: string }

/**
 * APNs didn't take the push now: it didn't answer in 10 seconds, or answered too many requests or a
 * server error. Sending it again later may work.
 */
export class ApnsUnavailable extends Schema.TaggedError<ApnsUnavailable>()("ApnsUnavailable", {
  reason: Schema.String,
}) {}

const hosts: Readonly<Record<ApnsEnvironment, string>> = {
  development: "https://api.sandbox.push.apple.com",
  production: "https://api.push.apple.com",
}

// APNs takes a provider token for an hour, and refuses one renewed more than about every 20 minutes.
const tokenLasts = Duration.toMillis(Duration.minutes(50))

const keyAndTeam = /^[A-Z0-9]{10}$/

const ReasonBody = Schema.Struct({ reason: Schema.String })

// The signing key couldn't sign: not a P-256 key in PKCS #8, or IDs of another shape.
class InvalidSigningKey extends Schema.TaggedError<InvalidSigningKey>()("InvalidSigningKey", {}) {}

/** Sends pushes through Apple's Push Notification service, with a token-signing key. */
export class Apns extends Context.Service<
  Apns,
  {
    /**
     * Sends one push, over HTTP/2: APNs's answer, accepted or rejected with its reason, such as
     * `BadDeviceToken` or `Unregistered` for a token no longer good. Fails with `ApnsUnavailable`
     * when it may take it later. Signs a provider token with the key and reuses it for 50 minutes;
     * one APNs calls expired is renewed, and the push sent once more.
     */
    readonly send: (push: ApnsPush) => Effect.Effect<ApnsAnswer, ApnsUnavailable>
  }
>()("@bagatka/apns/apns") {
  /**
   * APNs with `credentials`, signing with `signing`, on the `HttpClient` the host provides, which
   * must speak HTTP/2, as `fetch` does in Workers. A key that isn't a P-256 key in PKCS #8 fails
   * the first push, as rejected with the reason `InvalidSigningKey`.
   */
  static readonly layer = (credentials: ApnsCredentials, signing: ApnsSigning) =>
    Layer.effect(
      Apns,
      Effect.gen(function* () {
        const client = yield* HttpClient.HttpClient
        const signed = yield* Ref.make(Option.none<{ readonly token: string; readonly at: number }>())

        const signingKey = Effect.tryPromise({
          try: () => signing.importKey("pkcs8", derOf(Redacted.value(credentials.key)), keyAlgorithm, false, ["sign"]),
          catch: () => new InvalidSigningKey(),
        })

        const providerToken = Effect.fn("Apns.providerToken")(function* (renew: boolean) {
          const now = yield* Clock.currentTimeMillis
          const kept = yield* Ref.get(signed)
          if (!renew && Option.isSome(kept) && now - kept.value.at < tokenLasts) {
            return kept.value.token
          }
          if (!keyAndTeam.test(credentials.keyId) || !keyAndTeam.test(credentials.teamId)) {
            return yield* new InvalidSigningKey()
          }
          const key = yield* signingKey
          const unsigned = `${Base64Url.encode(`{"alg":"ES256","kid":"${credentials.keyId}"}`)}.${Base64Url.encode(
            `{"iss":"${credentials.teamId}","iat":${Math.floor(now / 1000)}}`,
          )}`
          const signature = yield* Effect.tryPromise({
            try: () => signing.sign(signatureAlgorithm, key, asciiBytes(unsigned)),
            catch: () => new InvalidSigningKey(),
          })
          const token = `${unsigned}.${Base64Url.encode(new Uint8Array(signature))}`
          yield* Ref.set(signed, Option.some({ token, at: now }))
          return token
        })

        const attempt = Effect.fn("Apns.attempt")(function* (push: ApnsPush, renew: boolean) {
          const token = yield* providerToken(renew)
          const request = yield* HttpClientRequest.post(
            `${hosts[push.environment]}/3/device/${encodeURIComponent(push.deviceToken)}`,
          ).pipe(
            HttpClientRequest.setHeaders({
              authorization: `bearer ${token}`,
              "apns-topic": push.topic,
              "apns-push-type": "alert",
              "apns-priority": String(push.priority),
              "apns-expiration": String(push.expiresAt ?? 0),
              ...(push.collapseId === undefined ? {} : { "apns-collapse-id": push.collapseId }),
            }),
            HttpClientRequest.bodyJson(push.payload),
            Effect.orDie,
          )
          const response = yield* client.execute(request).pipe(
            Effect.timeout(Duration.seconds(10)),
            Effect.mapError(() => new ApnsUnavailable({ reason: "APNs didn't answer" })),
          )
          if (response.status === 200) {
            const accepted: ApnsAnswer = { _tag: "Accepted", apnsId: response.headers["apns-id"] ?? "" }
            return accepted
          }
          const body = yield* response.json.pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(ReasonBody)),
            Effect.map((answer) => answer.reason),
            Effect.orElseSucceed(() => `HTTP ${response.status}`),
          )
          if (response.status === 429 || response.status >= 500) {
            return yield* new ApnsUnavailable({ reason: body })
          }
          const rejected: ApnsAnswer = { _tag: "Rejected", status: response.status, reason: body }
          return rejected
        })

        const send = Effect.fn("Apns.send")(function* (push: ApnsPush) {
          const first = yield* attempt(push, false).pipe(Effect.catchTag("InvalidSigningKey", rejectedForKey))
          return first._tag === "Rejected" && first.reason === "ExpiredProviderToken"
            ? yield* attempt(push, true).pipe(Effect.catchTag("InvalidSigningKey", rejectedForKey))
            : first
        })

        return Apns.of({ send })
      }),
    )
}

const keyAlgorithm = { name: "ECDSA", namedCurve: "P-256" } as const
const signatureAlgorithm = { name: "ECDSA", hash: "SHA-256" } as const

// A key the platform can't take is the key's fault, not APNs's: rejected, never sent again.
const rejectedForKey = () => {
  const rejected: ApnsAnswer = { _tag: "Rejected", status: 0, reason: "InvalidSigningKey" }
  return Effect.succeed(rejected)
}

// The bytes of text that is ASCII, as a JWT's parts are.
const asciiBytes = (text: string) => Uint8Array.from(text, (character) => character.charCodeAt(0))

// The PKCS #8 bytes of a `.p8` file's PEM text; empty when it isn't base64, which the import refuses.
const derOf = (pem: string) => {
  const base64 = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "")
  return Result.getOrElse(Base64.decode(base64), () => new Uint8Array(0))
}
