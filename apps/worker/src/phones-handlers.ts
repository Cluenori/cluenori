import { PhoneKey, PhoneKeyRejected } from "@cluenori/phones"
import { Effect, Schema } from "effect"
import { HttpServerRequest } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"

import { callerOf, siteOf } from "./caller.ts"
import { CluenoriApi } from "./cluenori-api.ts"
import { CurrentMember } from "./member-authorization.ts"
import { workspaceCalls } from "./workspace-calls.ts"
import { WorkspaceObjects } from "./workspace-objects.ts"

/** Serves the phones group, in the workspace's Durable Object. */
export const PhonesHandlers = HttpApiBuilder.group(CluenoriApi, "phones", (handlers) =>
  handlers
    // An owner sees every phone; a member, their own.
    .handle("phones", () =>
      Effect.gen(function* () {
        const { actor, access } = yield* CurrentMember
        const workspace = yield* WorkspaceObjects
        const { phones } = yield* workspace.call(workspaceCalls.phones, undefined)
        return {
          phones: phones.filter(
            (phone) => access._tag === "Everything" || (actor._tag === "Member" && phone.member === actor.id),
          ),
        }
      }),
    )
    .handle("startPairing", () =>
      Effect.gen(function* () {
        const { actor } = yield* CurrentMember
        const request = yield* HttpServerRequest.HttpServerRequest
        const workspace = yield* WorkspaceObjects
        // Phones reach the deployment where this request did.
        const deployment = new URL(request.originalUrl).origin
        return yield* workspace.call(workspaceCalls.startPairing, { actor, deployment })
      }),
    )
    .handle("removePhone", ({ params }) =>
      Effect.gen(function* () {
        const { actor, access } = yield* CurrentMember
        const workspace = yield* WorkspaceObjects
        yield* workspace.call(workspaceCalls.removePhone, { actor, access, phone: params.phone })
      }),
    ),
)

/** Serves the pairing group: the one call that needs no credential but the pairing code. */
export const PairingHandlers = HttpApiBuilder.group(CluenoriApi, "pairing", (handlers) =>
  handlers.handle("pair", ({ payload }) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      const workspace = yield* WorkspaceObjects
      return yield* workspace.call(workspaceCalls.pair, { phone: payload, caller: callerOf(request) })
    }),
  ),
)

/**
 * Serves the phone push group: the phone's own key, as its bearer token, is the only credential
 * that registers its push token, and the workspace's object checks it with the registration.
 */
export const PhonePushHandlers = HttpApiBuilder.group(CluenoriApi, "phonePush", (handlers) =>
  handlers.handle("registerPush", ({ payload }) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      const workspace = yield* WorkspaceObjects
      const bearer = /^Bearer (.+)$/i.exec(request.headers["authorization"] ?? "")?.[1] ?? ""
      const key = yield* Schema.decodeEffect(PhoneKey)(bearer).pipe(Effect.mapError(() => new PhoneKeyRejected()))
      yield* workspace.call(workspaceCalls.registerPush, { key, caller: callerOf(request), push: payload })
    }),
  ),
)

/** Serves the notifications group: a test alarm on a phone. */
export const NotificationsHandlers = HttpApiBuilder.group(CluenoriApi, "notifications", (handlers) =>
  handlers.handle("testAlert", ({ params }) =>
    Effect.gen(function* () {
      const { actor, access } = yield* CurrentMember
      const workspace = yield* WorkspaceObjects
      yield* workspace.call(workspaceCalls.testAlert, { actor, access, phone: params.phone })
    }),
  ),
)

/** Serves a phone signing in with a passkey: it pairs, acting for the passkey's member. */
export const PhoneSignInHandlers = HttpApiBuilder.group(CluenoriApi, "phoneSignIn", (handlers) =>
  handlers.handle("pairWithPasskey", ({ payload }) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      const workspace = yield* WorkspaceObjects
      const { assertion, ...phone } = payload
      return yield* workspace.call(workspaceCalls.pairWithPasskey, {
        assertion,
        phone,
        site: siteOf(request),
        caller: callerOf(request),
      })
    }),
  ),
)
