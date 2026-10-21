import { isSignInToken, SignInToken } from "@cluenori/members"
import { isPhoneKey, PhoneKey } from "@cluenori/phones"
import { Effect, Layer, Redacted, Schema } from "effect"
import { HttpServerRequest } from "effect/http"

import { ApiToken } from "./api-token.ts"
import { callerOf } from "./caller.ts"
import { CurrentMember, MemberAuthorization, Unauthorized } from "./member-authorization.ts"
import { workspaceCalls } from "./workspace-calls.ts"
import { WorkspaceObjects } from "./workspace-objects.ts"

const phoneKeyRejected = new Unauthorized({
  message: "This phone's key doesn't work: the phone was removed, or the key is wrong. Pair the phone again.",
})

const signInRejected = new Unauthorized({
  message:
    "This browser's sign-in ended: it signed out, it is older than 30 days, or its member was removed. Sign in again.",
})

// Runs the call for the member whose credential it carries.
const actAs =
  (
    memberOf: (
      credential: Redacted.Redacted,
    ) => Effect.Effect<CurrentMember["Service"], Unauthorized, HttpServerRequest.HttpServerRequest>,
  ) =>
  <A, E, R>(httpEffect: Effect.Effect<A, E, R>, { credential }: { readonly credential: Redacted.Redacted }) =>
    memberOf(credential).pipe(Effect.flatMap((member) => Effect.provideService(httpEffect, CurrentMember, member)))

/**
 * Lets a call through for the member whose credential it carries: the API token as a bearer token,
 * from a client such as the CLI, for the owner; a paired phone's key as a bearer token, acting for
 * whoever paired it; or the cookie a browser got by signing in, which holds a sign-in token, or the
 * API token itself.
 */
export const memberAuthorizationLayer = Layer.effect(
  MemberAuthorization,
  Effect.gen(function* () {
    const token = yield* ApiToken
    const workspace = yield* WorkspaceObjects

    // The owner the API token stands for sees every project, with no request to the workspace.
    const ownerOf = Effect.fn("MemberAuthorization.ownerOf")(function* (credential: Redacted.Redacted) {
      const member = yield* token.memberOf(credential)
      const owner: CurrentMember["Service"] = { actor: { _tag: "Member", id: member }, access: { _tag: "Everything" } }
      return owner
    })

    const bearerOf = Effect.fn("MemberAuthorization.bearerOf")(function* (credential: Redacted.Redacted) {
      const presented = Redacted.value(credential)
      if (!isPhoneKey(presented)) {
        return yield* ownerOf(credential)
      }
      const key = yield* Schema.decodeEffect(PhoneKey)(presented).pipe(Effect.mapError(() => phoneKeyRejected))
      const request = yield* HttpServerRequest.HttpServerRequest
      return yield* workspace
        .call(workspaceCalls.authenticatePhone, { key, caller: callerOf(request) })
        .pipe(Effect.catchTag("PhoneKeyRejected", () => Effect.fail(phoneKeyRejected)))
    })

    const cookieOf = Effect.fn("MemberAuthorization.cookieOf")(function* (credential: Redacted.Redacted) {
      const presented = Redacted.value(credential)
      if (!isSignInToken(presented)) {
        return yield* ownerOf(credential)
      }
      const signIn = yield* Schema.decodeEffect(SignInToken)(presented).pipe(Effect.mapError(() => signInRejected))
      const request = yield* HttpServerRequest.HttpServerRequest
      return yield* workspace
        .call(workspaceCalls.signedIn, { token: signIn, caller: callerOf(request) })
        .pipe(Effect.catchTag("SignInRejected", () => Effect.fail(signInRejected)))
    })

    return MemberAuthorization.of({ bearer: actAs(bearerOf), signIn: actAs(cookieOf) })
  }),
)
