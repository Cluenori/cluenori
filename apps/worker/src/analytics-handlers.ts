import { analyticsModule } from "@cluenori/analytics"
import { Period } from "@cluenori/foundation"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"

import { CluenoriApi } from "./cluenori-api.ts"
import { CurrentMember } from "./member-authorization.ts"
import { MemberProjects } from "./member-projects.ts"
import { moduleCall } from "./project-calls.ts"

/** Serves the Analytics module's routes, each its query in the project's Durable Object. */
export const AnalyticsHandlers = HttpApiBuilder.group(CluenoriApi, "analytics", (handlers) =>
  handlers
    .handle("usage", ({ params, query }) =>
      Effect.gen(function* () {
        const member = yield* CurrentMember
        const projects = yield* MemberProjects
        const { from, to, ...scope } = query
        return yield* projects.call(member, params.project, moduleCall(analyticsModule, "usage"), {
          period: new Period({ from, to }),
          ...scope,
        })
      }),
    )
    .handle("retention", ({ params, query }) =>
      Effect.gen(function* () {
        const member = yield* CurrentMember
        const projects = yield* MemberProjects
        const { from, to, ...scope } = query
        return yield* projects.call(member, params.project, moduleCall(analyticsModule, "retention"), {
          period: new Period({ from, to }),
          ...scope,
        })
      }),
    )
    .handle("appHealth", ({ params, query }) =>
      Effect.gen(function* () {
        const member = yield* CurrentMember
        const projects = yield* MemberProjects
        const { from, to, ...scope } = query
        return yield* projects.call(member, params.project, moduleCall(analyticsModule, "appHealth"), {
          period: new Period({ from, to }),
          ...scope,
        })
      }),
    )
    .handle("featureUse", ({ params, query }) =>
      Effect.gen(function* () {
        const member = yield* CurrentMember
        const projects = yield* MemberProjects
        const { from, to, ...scope } = query
        return yield* projects.call(member, params.project, moduleCall(analyticsModule, "featureUse"), {
          period: new Period({ from, to }),
          ...scope,
        })
      }),
    )
    .handle("person", ({ params }) =>
      Effect.gen(function* () {
        const member = yield* CurrentMember
        const projects = yield* MemberProjects
        return yield* projects.call(member, params.project, moduleCall(analyticsModule, "person"), {
          _tag: "ByPerson",
          person: params.person,
        })
      }),
    )
    .handle("personByUser", ({ params, query }) =>
      Effect.gen(function* () {
        const member = yield* CurrentMember
        const projects = yield* MemberProjects
        return yield* projects.call(member, params.project, moduleCall(analyticsModule, "person"), {
          _tag: "ByUser",
          user: query.user,
        })
      }),
    ),
)
