import type { MemberId } from "@cluenori/foundation"
import { Context, Crypto, Effect, Layer, Option, Redacted } from "effect"
import { Hex } from "effect/encoding"

import { Unauthorized } from "./member-authorization.ts"

/**
 * The deployment's API token and the member it belongs to: `CLUENORI_API_TOKEN` and `CLUENORI_OWNER`,
 * which `./setup` makes. Until members are records, one token stands for the deployment's owner.
 */
export interface ApiSettings {
  readonly token: Option.Option<Redacted.Redacted>
  readonly owner: Option.Option<MemberId>
}

const utf8 = new TextEncoder()

/**
 * Whose a presented API token is: the one rule for it, whether a client sends it as a bearer token or
 * a browser signed in with it. The Worker's own; nothing outside it needs the token's rule.
 */
export class ApiToken extends Context.Service<
  ApiToken,
  {
    /**
     * The member `presented` belongs to. Fails with `Unauthorized` when it is missing or wrong, or
     * when the deployment has no token yet; `message` says which.
     */
    readonly memberOf: (presented: Redacted.Redacted) => Effect.Effect<MemberId, Unauthorized>
  }
>()("@cluenori/worker/api-token/ApiToken") {
  static readonly layer = (settings: ApiSettings) =>
    Layer.effect(
      ApiToken,
      Effect.gen(function* () {
        const crypto = yield* Crypto.Crypto
        const digestOf = (text: string) =>
          crypto.digest("SHA-256", utf8.encode(text)).pipe(Effect.orDie, Effect.map(Hex.encode))

        return ApiToken.of({
          memberOf: Effect.fn("ApiToken.memberOf")(function* (presented) {
            if (Option.isNone(settings.token) || Option.isNone(settings.owner)) {
              return yield* new Unauthorized({ message: "This deployment has no API token yet: ./setup makes one." })
            }
            if (Redacted.value(presented) === "") {
              return yield* new Unauthorized({
                message: "This call needs the API token: send it as a bearer token, or sign in with it.",
              })
            }
            // Comparing digests takes the same time whatever the token is, so it reveals nothing.
            const given = yield* digestOf(Redacted.value(presented))
            const expected = yield* digestOf(Redacted.value(settings.token.value))
            if (given !== expected) {
              return yield* new Unauthorized({ message: "The API token is wrong." })
            }
            return settings.owner.value
          }),
        })
      }),
    )
}
