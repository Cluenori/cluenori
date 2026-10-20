import { Period } from "@cluenori/foundation"
import type { RequestFilters, RequestQuery } from "@cluenori/signals"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"

import { CluenoriApi } from "./cluenori-api.ts"
import { projectCalls } from "./project-calls.ts"
import { ProjectObjects } from "./project-objects.ts"

const queryOf = (filters: typeof RequestFilters.Type): RequestQuery => ({
  period: new Period({ from: filters.from, to: filters.to }),
  ...(filters.environment === undefined ? {} : { environment: filters.environment }),
  ...(filters.component === undefined ? {} : { component: filters.component }),
})

/** Serves the signals group, in each project's Durable Object. */
export const SignalsHandlers = HttpApiBuilder.group(CluenoriApi, "signals", (handlers) =>
  handlers
    .handle("endpoints", ({ params, query }) =>
      Effect.gen(function* () {
        const objects = yield* ProjectObjects
        return yield* objects.call(params.project, projectCalls.endpoints, queryOf(query))
      }),
    )
    .handle("requests", ({ params, query }) =>
      Effect.gen(function* () {
        const objects = yield* ProjectObjects
        return yield* objects.call(params.project, projectCalls.requestsOverTime, {
          query: queryOf(query),
          step: query.step,
        })
      }),
    ),
)
