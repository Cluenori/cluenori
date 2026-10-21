import type { Actor } from "@cluenori/foundation"
import { isPhoneKey, PhoneKey } from "@cluenori/phones"
import { Effect, Layer, Redacted, Schema } from "effect"
import { HttpServerRequest } from "effect/http"

import { ApiToken } from "./api-token.ts"
import { callerOf } from "./caller.ts"
import { CurrentActor, MemberAuthorization, Unauthorized } from "./member-authorization.ts"
import { workspaceCalls } from "./workspace-calls.ts"
import { WorkspaceObjects } from "./workspace-objects.ts"

const phoneKeyRejected = new Unauthorized({
  message: "This phone's key doesn't work: the phone was removed, or the key is wrong. Pair the phone again.",
})

// Runs the call for the actor whose credential it carries.
const actAs =
  (
    actorOf: (credential: Redacted.Redacted) => Effect.Effect<Actor, Unauthorized, HttpServerRequest.HttpServerRequest>,
  ) =>
  <A, E, R>(httpEffect: Effect.Effect<A, E, R>, { credential }: { readonly credential: Redacted.Redacted }) =>
    actorOf(credential).pipe(Effect.flatMap((actor) => Effect.provideService(httpEffect, CurrentActor, actor)))

/**
 * Lets a call through for the member whose credential it carries: the API token as a bearer token,
 * from a client such as the CLI; a paired phone's key as a bearer token, acting for whoever paired
 * it; or the cookie a browser got by signing in with the API token, which holds nothing else.
 */
export const memberAuthorizationLayer = Layer.effect(
  MemberAuthorization,
  Effect.gen(function* () {
    const token = yield* ApiToken
    const workspace = yield* WorkspaceObjects

    const memberOf = Effect.fn("MemberAuthorization.memberOf")(function* (credential: Redacted.Redacted) {
      const member = yield* token.memberOf(credential)
      const actor: Actor = { _tag: "Member", id: member }
      return actor
    })

    const bearerOf = Effect.fn("MemberAuthorization.bearerOf")(function* (credential: Redacted.Redacted) {
      const presented = Redacted.value(credential)
      if (!isPhoneKey(presented)) {
        return yield* memberOf(credential)
      }
      const key = yield* Schema.decodeEffect(PhoneKey)(presented).pipe(Effect.mapError(() => phoneKeyRejected))
      const request = yield* HttpServerRequest.HttpServerRequest
      return yield* workspace
        .call(workspaceCalls.authenticatePhone, { key, caller: callerOf(request) })
        .pipe(Effect.catchTag("PhoneKeyRejected", () => Effect.fail(phoneKeyRejected)))
    })

    return MemberAuthorization.of({ bearer: actAs(bearerOf), signIn: actAs(memberOf) })
  }),
)
