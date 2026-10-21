import { isSignInToken, SignInId, SignInToken } from "@cluenori/members"
import { Duration, Effect, Option, Schema } from "effect"
import { HttpServerRequest } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"

import { ApiToken } from "./api-token.ts"
import { callerOf, siteOf } from "./caller.ts"
import { CluenoriApi } from "./cluenori-api.ts"
import { CurrentMember, signInCookie } from "./member-authorization.ts"
import { workspaceCalls } from "./workspace-calls.ts"
import { WorkspaceObjects } from "./workspace-objects.ts"

// For the API's paths only, never sent by another site, kept 30 days; HttpOnly and Secure are the
// cookie's defaults.
const cookie = { path: "/api", sameSite: "strict", maxAge: Duration.days(30) } as const

const decodeSignIn = Schema.decodeUnknownOption(SignInToken)
const decodeSignInId = Schema.decodeUnknownOption(SignInId)

// The sign-in of the browser asking, by its cookie's token; none for one signed in with the API token.
const currentSignIn = (request: HttpServerRequest.HttpServerRequest) => {
  const presented = request.cookies[signInCookie.key] ?? ""
  return isSignInToken(presented) ? decodeSignInId(presented.split(".")[2]) : Option.none()
}

/**
 * Serves the sign-in group: the cookie is set for the deployment's own API token, an owner's way
 * in; signing out ends a passkey's sign-in too.
 */
export const SignInHandlers = HttpApiBuilder.group(CluenoriApi, "signIn", (handlers) =>
  handlers
    .handle("signIn", ({ payload }) =>
      Effect.gen(function* () {
        const token = yield* ApiToken
        yield* token.memberOf(payload.token)
        yield* HttpApiBuilder.securitySetCookie(signInCookie, payload.token, cookie)
      }),
    )
    .handle("signOut", () =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const presented = request.cookies[signInCookie.key] ?? ""
        const signIn = isSignInToken(presented) ? decodeSignIn(presented) : Option.none()
        if (Option.isSome(signIn)) {
          const workspace = yield* WorkspaceObjects
          yield* workspace.call(workspaceCalls.signOut, signIn.value)
        }
        yield* HttpApiBuilder.securitySetCookie(signInCookie, "", { ...cookie, maxAge: 0 })
      }),
    ),
)

/** Serves joining by an invitation and signing in with a passkey, each setting the sign-in cookie. */
export const PasskeysHandlers = HttpApiBuilder.group(CluenoriApi, "passkeys", (handlers) =>
  handlers
    .handle("joinOptions", ({ payload }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const workspace = yield* WorkspaceObjects
        return yield* workspace.call(workspaceCalls.joinOptions, { code: payload.code, site: siteOf(request) })
      }),
    )
    .handle("join", ({ payload }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const workspace = yield* WorkspaceObjects
        const joined = yield* workspace.call(workspaceCalls.join, {
          ...payload,
          site: siteOf(request),
          caller: callerOf(request),
        })
        yield* HttpApiBuilder.securitySetCookie(signInCookie, joined.signIn, cookie)
        return joined.member
      }),
    )
    .handle("signInOptions", () =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const workspace = yield* WorkspaceObjects
        return yield* workspace.call(workspaceCalls.signInOptions, siteOf(request))
      }),
    )
    .handle("signInWithPasskey", ({ payload }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const workspace = yield* WorkspaceObjects
        const signedIn = yield* workspace.call(workspaceCalls.signIn, {
          assertion: payload,
          site: siteOf(request),
          caller: callerOf(request),
        })
        yield* HttpApiBuilder.securitySetCookie(signInCookie, signedIn.signIn, cookie)
        return signedIn.member
      }),
    ),
)

/** Serves the members group: who calls, their passkeys, and the members owners manage. */
export const MembersHandlers = HttpApiBuilder.group(CluenoriApi, "members", (handlers) =>
  handlers
    .handle("me", () =>
      Effect.gen(function* () {
        const { actor } = yield* CurrentMember
        const workspace = yield* WorkspaceObjects
        if (actor._tag !== "Member") {
          return yield* Effect.die("Only members call the public API")
        }
        // The owner the API token stands for is listed when the workspace's object starts.
        return yield* workspace.call(workspaceCalls.me, actor.id).pipe(Effect.orDie)
      }),
    )
    .handle("passkeyOptions", () =>
      Effect.gen(function* () {
        const { actor } = yield* CurrentMember
        const request = yield* HttpServerRequest.HttpServerRequest
        const workspace = yield* WorkspaceObjects
        return yield* workspace.call(workspaceCalls.passkeyOptions, { actor, site: siteOf(request) }).pipe(Effect.orDie)
      }),
    )
    .handle("addPasskey", ({ payload }) =>
      Effect.gen(function* () {
        const { actor } = yield* CurrentMember
        const request = yield* HttpServerRequest.HttpServerRequest
        const workspace = yield* WorkspaceObjects
        yield* workspace
          .call(workspaceCalls.addPasskey, { actor, registration: payload, site: siteOf(request) })
          .pipe(Effect.catchTag("NotAllowed", (notAllowed) => Effect.die(notAllowed)))
      }),
    )
    .handle("signIns", () =>
      Effect.gen(function* () {
        const { actor } = yield* CurrentMember
        const request = yield* HttpServerRequest.HttpServerRequest
        const workspace = yield* WorkspaceObjects
        const current = currentSignIn(request)
        return yield* workspace.call(workspaceCalls.signIns, {
          actor,
          ...(Option.isSome(current) ? { current: current.value } : {}),
        })
      }),
    )
    .handle("endSignIn", ({ params }) =>
      Effect.gen(function* () {
        const { actor } = yield* CurrentMember
        const workspace = yield* WorkspaceObjects
        yield* workspace.call(workspaceCalls.endSignIn, { actor, signIn: params.signIn })
      }),
    )
    .handle("members", () =>
      Effect.gen(function* () {
        const { actor } = yield* CurrentMember
        const workspace = yield* WorkspaceObjects
        return yield* workspace.call(workspaceCalls.members, actor)
      }),
    )
    .handle("invite", ({ payload }) =>
      Effect.gen(function* () {
        const { actor } = yield* CurrentMember
        const request = yield* HttpServerRequest.HttpServerRequest
        const workspace = yield* WorkspaceObjects
        return yield* workspace.call(workspaceCalls.invite, { actor, invite: payload, site: siteOf(request) })
      }),
    )
    .handle("setProjects", ({ params, payload }) =>
      Effect.gen(function* () {
        const { actor } = yield* CurrentMember
        const workspace = yield* WorkspaceObjects
        return yield* workspace.call(workspaceCalls.setProjects, {
          actor,
          member: params.member,
          projects: payload.projects,
        })
      }),
    )
    .handle("removeMember", ({ params }) =>
      Effect.gen(function* () {
        const { actor } = yield* CurrentMember
        const workspace = yield* WorkspaceObjects
        yield* workspace.call(workspaceCalls.removeMember, { actor, member: params.member })
      }),
    ),
)
