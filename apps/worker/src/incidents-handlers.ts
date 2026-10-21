import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"

import { CluenoriApi } from "./cluenori-api.ts"
import { CurrentActor } from "./member-authorization.ts"
import { projectCalls } from "./project-calls.ts"
import { ProjectObjects } from "./project-objects.ts"

/** Serves the incidents group, in each project's Durable Object. */
export const IncidentsHandlers = HttpApiBuilder.group(CluenoriApi, "incidents", (handlers) =>
  handlers
    .handle("incidents", ({ params }) =>
      Effect.gen(function* () {
        const objects = yield* ProjectObjects
        return yield* objects.call(params.project, projectCalls.incidents, undefined)
      }),
    )
    .handle("acknowledge", ({ params }) =>
      Effect.gen(function* () {
        const actor = yield* CurrentActor
        const objects = yield* ProjectObjects
        return yield* objects.call(params.project, projectCalls.acknowledge, { actor, incident: params.incident })
      }),
    )
    .handle("monitors", ({ params }) =>
      Effect.gen(function* () {
        const objects = yield* ProjectObjects
        return yield* objects.call(params.project, projectCalls.monitors, undefined)
      }),
    )
    .handle("addMonitor", ({ params, payload }) =>
      Effect.gen(function* () {
        const actor = yield* CurrentActor
        const objects = yield* ProjectObjects
        return yield* objects.call(params.project, projectCalls.addMonitor, { actor, monitor: payload })
      }),
    )
    .handle("removeMonitor", ({ params }) =>
      Effect.gen(function* () {
        const actor = yield* CurrentActor
        const objects = yield* ProjectObjects
        return yield* objects.call(params.project, projectCalls.removeMonitor, { actor, monitor: params.monitor })
      }),
    ),
)
