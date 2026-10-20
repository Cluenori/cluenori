import { Period } from "@cluenori/foundation"
import type { ErrorQuery, LogFilters, LogQuery, RequestFilters, RequestQuery } from "@cluenori/signals"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"

import { CluenoriApi } from "./cluenori-api.ts"
import { projectCalls } from "./project-calls.ts"
import { ProjectObjects } from "./project-objects.ts"

const queryOf = (filters: typeof RequestFilters.Type): RequestQuery & ErrorQuery => ({
  period: new Period({ from: filters.from, to: filters.to }),
  ...(filters.environment === undefined ? {} : { environment: filters.environment }),
  ...(filters.component === undefined ? {} : { component: filters.component }),
})

const logQueryOf = (filters: typeof LogFilters.Type): LogQuery => ({
  ...queryOf(filters),
  ...(filters.level === undefined ? {} : { minimumLevel: filters.level }),
  ...(filters.search === undefined ? {} : { search: filters.search }),
  ...(filters.category === undefined ? {} : { category: filters.category }),
  ...(filters.trace === undefined ? {} : { trace: filters.trace }),
  ...(filters.error === undefined ? {} : { error: filters.error }),
  ...(filters.before === undefined ? {} : { before: filters.before }),
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
    )
    .handle("errors", ({ params, query }) =>
      Effect.gen(function* () {
        const objects = yield* ProjectObjects
        return yield* objects.call(params.project, projectCalls.errors, queryOf(query))
      }),
    )
    .handle("error", ({ params, query }) =>
      Effect.gen(function* () {
        const objects = yield* ProjectObjects
        return yield* objects.call(params.project, projectCalls.error, { id: params.error, query: queryOf(query) })
      }),
    )
    .handle("logs", ({ params, query }) =>
      Effect.gen(function* () {
        const objects = yield* ProjectObjects
        return yield* objects.call(params.project, projectCalls.logs, logQueryOf(query))
      }),
    )
    .handle("trace", ({ params, query }) =>
      Effect.gen(function* () {
        const objects = yield* ProjectObjects
        return yield* objects.call(params.project, projectCalls.trace, { trace: params.trace, around: query.around })
      }),
    ),
)
