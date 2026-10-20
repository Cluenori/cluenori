import type { MemberId } from "@cluenori/foundation"
import { Crypto, Effect, Layer, Option, Redacted } from "effect"
import { Hex } from "effect/encoding"

import { CurrentActor, MemberAuthorization, Unauthorized } from "./member-authorization.ts"

/**
 * The deployment's API token and the member it belongs to: `CLUENORI_API_TOKEN` and `CLUENORI_OWNER`,
 * which `./setup` makes. Until members are records, one token stands for the deployment's owner.
 */
export interface ApiSettings {
  readonly token: Option.Option<Redacted.Redacted>
  readonly owner: Option.Option<MemberId>
}

const utf8 = new TextEncoder()

/** Checks API tokens against the deployment's. Without one configured, it refuses every call. */
export const memberAuthorizationLayer = (settings: ApiSettings) =>
  Layer.effect(
    MemberAuthorization,
    Effect.gen(function* () {
      const crypto = yield* Crypto.Crypto
      const digestOf = (text: string) =>
        crypto.digest("SHA-256", utf8.encode(text)).pipe(Effect.orDie, Effect.map(Hex.encode))

      return MemberAuthorization.of({
        bearer: Effect.fn("MemberAuthorization.bearer")(function* (httpEffect, { credential }) {
          if (Option.isNone(settings.token) || Option.isNone(settings.owner)) {
            return yield* new Unauthorized({
              message: "This deployment has no API token yet: ./setup makes one.",
            })
          }
          // Comparing digests takes the same time whatever the token is, so it reveals nothing.
          const presented = yield* digestOf(Redacted.value(credential))
          const expected = yield* digestOf(Redacted.value(settings.token.value))
          if (presented !== expected) {
            return yield* new Unauthorized({ message: "The API token is wrong." })
          }
          return yield* Effect.provideService(httpEffect, CurrentActor, { _tag: "Member", id: settings.owner.value })
        }),
      })
    }),
  )
