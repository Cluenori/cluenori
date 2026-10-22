import { NotAllowed } from "@cluenori/foundation"
import { canSee } from "@cluenori/members"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"

import { CluenoriApi } from "./cluenori-api.ts"
import { CurrentMember } from "./member-authorization.ts"
import { MemberProjects } from "./member-projects.ts"
import { projectCalls } from "./project-calls.ts"
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
        const member = yield* CurrentMember
        const workspace = yield* WorkspaceObjects
        const { projects } = yield* workspace.call(workspaceCalls.projects, undefined)
        return { projects: projects.filter((project) => canSee(member.access, project.key)) }
      }),
    )
    .handle("project", ({ params }) =>
      Effect.gen(function* () {
        const member = yield* CurrentMember
        const projects = yield* MemberProjects
        return yield* projects.call(member, params.project, projectCalls.detail, undefined)
      }),
    )
    // The project's own object creates it, then the workspace's index lists it: two objects, no
    // transaction between them. A project that exists already is listed too, before the create
    // fails with `ProjectExists`, so trying again repairs a create that stopped between the two,
    // and lists projects made before the index existed.
    .handle("createProject", ({ payload }) =>
      Effect.gen(function* () {
        const member = yield* CurrentMember
        const { actor } = member
        if (member.access._tag !== "Everything") {
          return yield* new NotAllowed()
        }
        const projects = yield* MemberProjects
        const workspace = yield* WorkspaceObjects
        // An owner sees every project, so the project is never hidden from them.
        const created = yield* projects
          .call(member, payload.key, projectCalls.createProject, { actor, name: payload.name })
          .pipe(
            Effect.catchTags({
              ProjectNotFound: (hidden) => Effect.die(hidden),
              ProjectExists: (exists) =>
                projects.call(member, payload.key, projectCalls.detail, undefined).pipe(
                  Effect.orDie,
                  Effect.flatMap((existing) => workspace.call(workspaceCalls.recordProject, existing.project)),
                  Effect.andThen(Effect.fail(exists)),
                ),
            }),
          )
        yield* workspace.call(workspaceCalls.recordProject, created)
        return created
      }),
    )
    .handle("updateSettings", ({ params, payload }) =>
      Effect.gen(function* () {
        const member = yield* CurrentMember
        const projects = yield* MemberProjects
        return yield* projects.call(member, params.project, projectCalls.updateSettings, {
          actor: member.actor,
          settings: payload,
        })
      }),
    )
    .handle("linkComponent", ({ params, payload }) =>
      Effect.gen(function* () {
        const member = yield* CurrentMember
        const projects = yield* MemberProjects
        return yield* projects.call(member, params.project, projectCalls.linkComponent, {
          actor: member.actor,
          component: params.component,
          links: payload,
        })
      }),
    )
    .handle("addComponent", ({ params, payload }) =>
      Effect.gen(function* () {
        const member = yield* CurrentMember
        const { actor } = member
        const projects = yield* MemberProjects
        return yield* projects.call(member, params.project, projectCalls.addComponent, { actor, component: payload })
      }),
    ),
)
