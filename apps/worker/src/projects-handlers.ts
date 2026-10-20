import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"

import { CluenoriApi } from "./cluenori-api.ts"
import { CurrentActor } from "./member-authorization.ts"
import { projectCalls } from "./project-calls.ts"
import { ProjectObjects } from "./project-objects.ts"
import { workspaceCalls } from "./workspace-calls.ts"
import { WorkspaceObjects } from "./workspace-objects.ts"

/**
 * Serves the projects group: each project in its own Durable Object, and the workspace's index of
 * them in the workspace's object.
 */
export const ProjectsHandlers = HttpApiBuilder.group(CluenoriApi, "projects", (handlers) =>
  handlers
    .handle("listProjects", () =>
      Effect.gen(function* () {
        const workspace = yield* WorkspaceObjects
        return yield* workspace.call(workspaceCalls.projects, undefined)
      }),
    )
    .handle("project", ({ params }) =>
      Effect.gen(function* () {
        const objects = yield* ProjectObjects
        return yield* objects.call(params.project, projectCalls.detail, undefined)
      }),
    )
    // The project's own object creates it, then the workspace's index lists it: two objects, no
    // transaction between them. A project that exists already is listed too, before the create
    // fails with `ProjectExists`, so trying again repairs a create that stopped between the two,
    // and lists projects made before the index existed.
    .handle("createProject", ({ payload }) =>
      Effect.gen(function* () {
        const actor = yield* CurrentActor
        const objects = yield* ProjectObjects
        const workspace = yield* WorkspaceObjects
        const created = yield* objects
          .call(payload.key, projectCalls.createProject, { actor, name: payload.name })
          .pipe(
            Effect.catchTag("ProjectExists", (exists) =>
              objects.call(payload.key, projectCalls.detail, undefined).pipe(
                Effect.orDie,
                Effect.flatMap((existing) => workspace.call(workspaceCalls.recordProject, existing.project)),
                Effect.andThen(Effect.fail(exists)),
              ),
            ),
          )
        yield* workspace.call(workspaceCalls.recordProject, created)
        return created
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
