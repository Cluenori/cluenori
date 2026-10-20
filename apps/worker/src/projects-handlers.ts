import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"

import { CluenoriApi } from "./cluenori-api.ts"
import { CurrentActor } from "./member-authorization.ts"
import { projectCalls } from "./project-calls.ts"
import { ProjectObjects } from "./project-objects.ts"

/** Serves the projects group, in each project's Durable Object. */
export const ProjectsHandlers = HttpApiBuilder.group(CluenoriApi, "projects", (handlers) =>
  handlers
    .handle("createProject", ({ payload }) =>
      Effect.gen(function* () {
        const actor = yield* CurrentActor
        const objects = yield* ProjectObjects
        return yield* objects.call(payload.key, projectCalls.createProject, { actor, name: payload.name })
      }),
    )
    .handle("addComponent", ({ params, payload }) =>
      Effect.gen(function* () {
        const actor = yield* CurrentActor
        const objects = yield* ProjectObjects
        return yield* objects.call(params.project, projectCalls.addComponent, { actor, component: payload })
      }),
    ),
)
