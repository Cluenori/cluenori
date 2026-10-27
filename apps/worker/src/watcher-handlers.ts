import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"

import { CluenoriApi } from "./cluenori-api.ts"
import { CurrentMember } from "./member-authorization.ts"
import { workspaceCalls } from "./workspace-calls.ts"
import { WorkspaceObjects } from "./workspace-objects.ts"

/** Serves the watcher group, in the workspace's Durable Object, which allows owners only. */
export const WatcherHandlers = HttpApiBuilder.group(CluenoriApi, "watcher", (handlers) =>
  handlers
    .handle("watcher", () =>
      Effect.gen(function* () {
        const { access } = yield* CurrentMember
        const workspace = yield* WorkspaceObjects
        return yield* workspace.call(workspaceCalls.watcher, access)
      }),
    )
    .handle("setWatcher", ({ payload }) =>
      Effect.gen(function* () {
        const { actor, access } = yield* CurrentMember
        const workspace = yield* WorkspaceObjects
        return yield* workspace.call(workspaceCalls.setWatcher, { actor, access, repository: payload.repository })
      }),
    ),
)
