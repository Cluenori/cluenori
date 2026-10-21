import { Period } from "@cluenori/foundation"
import { releasesModule } from "@cluenori/releases"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"

import { CluenoriApi } from "./cluenori-api.ts"
import { CurrentMember } from "./member-authorization.ts"
import { MemberProjects } from "./member-projects.ts"
import { moduleCall } from "./project-calls.ts"

/** Serves the Releases module's routes, each its query in the project's Durable Object. */
export const ReleasesHandlers = HttpApiBuilder.group(CluenoriApi, "releases", (handlers) =>
  handlers
    .handle("releases", ({ params, query }) =>
      Effect.gen(function* () {
        const member = yield* CurrentMember
        const projects = yield* MemberProjects
        return yield* projects.call(member, params.project, moduleCall(releasesModule, "list"), {
          period: new Period({ from: query.from, to: query.to }),
          ...(query.environment === undefined ? {} : { environment: query.environment }),
          ...(query.component === undefined ? {} : { component: query.component }),
        })
      }),
    )
    .handle("release", ({ params, query }) =>
      Effect.gen(function* () {
        const member = yield* CurrentMember
        const projects = yield* MemberProjects
        return yield* projects.call(member, params.project, moduleCall(releasesModule, "release"), {
          component: params.component,
          release: params.release,
          ...(query.environment === undefined ? {} : { environment: query.environment }),
        })
      }),
    ),
)
