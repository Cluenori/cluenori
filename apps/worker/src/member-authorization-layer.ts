import { Effect, Layer } from "effect"

import { ApiToken } from "./api-token.ts"
import { CurrentActor, MemberAuthorization } from "./member-authorization.ts"

/**
 * Lets a call through for the member whose API token it carries: as a bearer token, from a client
 * such as the CLI, or in the cookie a browser got by signing in. The bearer token is tried first.
 */
export const memberAuthorizationLayer = Layer.effect(
  MemberAuthorization,
  Effect.gen(function* () {
    const token = yield* ApiToken
    const actAs = Effect.fn("MemberAuthorization.actAs")(function* <A, E, R>(
      httpEffect: Effect.Effect<A, E, R>,
      { credential }: { readonly credential: Parameters<typeof token.memberOf>[0] },
    ) {
      const member = yield* token.memberOf(credential)
      return yield* Effect.provideService(httpEffect, CurrentActor, { _tag: "Member", id: member })
    })
    return MemberAuthorization.of({ bearer: actAs, signIn: actAs })
  }),
)
