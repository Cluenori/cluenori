import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"

import { CluenoriApi } from "./cluenori-api.ts"
import { CurrentMember } from "./member-authorization.ts"
import { MemberProjects } from "./member-projects.ts"
import { projectCalls } from "./project-calls.ts"

/** Serves the incidents group, in each project's Durable Object. */
export const IncidentsHandlers = HttpApiBuilder.group(CluenoriApi, "incidents", (handlers) =>
  handlers
    .handle("incidents", ({ params }) =>
      Effect.gen(function* () {
        const member = yield* CurrentMember
        const projects = yield* MemberProjects
        return yield* projects.call(member, params.project, projectCalls.incidents, undefined)
      }),
    )
    .handle("incident", ({ params }) =>
      Effect.gen(function* () {
        const member = yield* CurrentMember
        const projects = yield* MemberProjects
        return yield* projects.call(member, params.project, projectCalls.incident, params.incident)
      }),
    )
    .handle("acknowledge", ({ params }) =>
      Effect.gen(function* () {
        const member = yield* CurrentMember
        const { actor } = member
        const projects = yield* MemberProjects
        return yield* projects.call(member, params.project, projectCalls.acknowledge, {
          actor,
          incident: params.incident,
        })
      }),
    )
    .handle("monitors", ({ params }) =>
      Effect.gen(function* () {
        const member = yield* CurrentMember
        const projects = yield* MemberProjects
        return yield* projects.call(member, params.project, projectCalls.monitors, undefined)
      }),
    )
    .handle("monitor", ({ params }) =>
      Effect.gen(function* () {
        const member = yield* CurrentMember
        const projects = yield* MemberProjects
        return yield* projects.call(member, params.project, projectCalls.monitor, params.monitor)
      }),
    )
    .handle("addMonitor", ({ params, payload }) =>
      Effect.gen(function* () {
        const member = yield* CurrentMember
        const { actor } = member
        const projects = yield* MemberProjects
        return yield* projects.call(member, params.project, projectCalls.addMonitor, { actor, monitor: payload })
      }),
    )
    .handle("removeMonitor", ({ params }) =>
      Effect.gen(function* () {
        const member = yield* CurrentMember
        const { actor } = member
        const projects = yield* MemberProjects
        return yield* projects.call(member, params.project, projectCalls.removeMonitor, {
          actor,
          monitor: params.monitor,
        })
      }),
    ),
)
