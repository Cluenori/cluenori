import { Effect } from "effect"
import { HttpServerRequest } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"

import { callerOf } from "./caller.ts"
import { CluenoriApi } from "./cluenori-api.ts"
import { CurrentActor } from "./member-authorization.ts"
import { workspaceCalls } from "./workspace-calls.ts"
import { WorkspaceObjects } from "./workspace-objects.ts"

/** Serves the phones group, in the workspace's Durable Object. */
export const PhonesHandlers = HttpApiBuilder.group(CluenoriApi, "phones", (handlers) =>
  handlers
    .handle("phones", () =>
      Effect.gen(function* () {
        const workspace = yield* WorkspaceObjects
        return yield* workspace.call(workspaceCalls.phones, undefined)
      }),
    )
    .handle("startPairing", () =>
      Effect.gen(function* () {
        const actor = yield* CurrentActor
        const request = yield* HttpServerRequest.HttpServerRequest
        const workspace = yield* WorkspaceObjects
        // Phones reach the deployment where this request did.
        const deployment = new URL(request.originalUrl).origin
        return yield* workspace.call(workspaceCalls.startPairing, { actor, deployment })
      }),
    )
    .handle("removePhone", ({ params }) =>
      Effect.gen(function* () {
        const actor = yield* CurrentActor
        const workspace = yield* WorkspaceObjects
        yield* workspace.call(workspaceCalls.removePhone, { actor, phone: params.phone })
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
