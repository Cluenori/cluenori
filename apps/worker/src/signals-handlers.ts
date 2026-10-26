import { Period } from "@cluenori/foundation"
import type {
  ErrorQuery,
  LogCountFilters,
  LogCountQuery,
  LogFilters,
  LogMessageFilters,
  LogMessageQuery,
  LogQuery,
  OperationFilters,
  OperationQuery,
} from "@cluenori/signals"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"

import { CluenoriApi } from "./cluenori-api.ts"
import { CurrentMember } from "./member-authorization.ts"
import { MemberProjects } from "./member-projects.ts"
import { projectCalls } from "./project-calls.ts"

// The filters every question shares: the period, and optionally one environment, component, or release.
const queryOf = (
  filters: typeof LogFilters.Type | typeof LogCountFilters.Type | typeof LogMessageFilters.Type,
): ErrorQuery => ({
  period: new Period({ from: filters.from, to: filters.to }),
  ...(filters.environment === undefined ? {} : { environment: filters.environment }),
  ...(filters.component === undefined ? {} : { component: filters.component }),
  ...(filters.release === undefined ? {} : { release: filters.release }),
})

const operationQueryOf = (filters: typeof OperationFilters.Type): OperationQuery => ({
  ...queryOf(filters),
  ...(filters.operation === undefined ? {} : { operation: filters.operation }),
})

const logCountQueryOf = (filters: typeof LogCountFilters.Type): LogCountQuery => ({
  ...queryOf(filters),
  step: filters.step,
  by: filters.by,
  ...(filters.level === undefined ? {} : { minimumLevel: filters.level }),
  ...(filters.error === undefined ? {} : { error: filters.error }),
  ...(filters.message === undefined ? {} : { message: filters.message }),
})

const logMessageQueryOf = (filters: typeof LogMessageFilters.Type): LogMessageQuery => ({
  ...queryOf(filters),
  ...(filters.level === undefined ? {} : { minimumLevel: filters.level }),
  ...(filters.search === undefined ? {} : { search: filters.search }),
})

const logQueryOf = (filters: typeof LogFilters.Type): LogQuery => ({
  ...queryOf(filters),
  ...(filters.level === undefined ? {} : { minimumLevel: filters.level }),
  ...(filters.search === undefined ? {} : { search: filters.search }),
  ...(filters.category === undefined ? {} : { category: filters.category }),
  ...(filters.trace === undefined ? {} : { trace: filters.trace }),
  ...(filters.error === undefined ? {} : { error: filters.error }),
  ...(filters.message === undefined ? {} : { message: filters.message }),
  ...(filters.before === undefined ? {} : { before: filters.before }),
})

/** Serves the signals group, in each project's Durable Object. */
export const SignalsHandlers = HttpApiBuilder.group(CluenoriApi, "signals", (handlers) =>
  handlers
    .handle("operations", ({ params, query }) =>
      Effect.gen(function* () {
        const member = yield* CurrentMember
        const projects = yield* MemberProjects
        return yield* projects.call(member, params.project, projectCalls.operations, operationQueryOf(query))
      }),
    )
    .handle("load", ({ params, query }) =>
      Effect.gen(function* () {
        const member = yield* CurrentMember
        const projects = yield* MemberProjects
        return yield* projects.call(member, params.project, projectCalls.loadOverTime, {
          query: operationQueryOf(query),
          step: query.step,
        })
      }),
    )
    .handle("keptTraces", ({ params, query }) =>
      Effect.gen(function* () {
        const member = yield* CurrentMember
        const projects = yield* MemberProjects
        return yield* projects.call(member, params.project, projectCalls.keptTraces, operationQueryOf(query))
      }),
    )
    .handle("errors", ({ params, query }) =>
      Effect.gen(function* () {
        const member = yield* CurrentMember
        const projects = yield* MemberProjects
        return yield* projects.call(member, params.project, projectCalls.errors, queryOf(query))
      }),
    )
    .handle("error", ({ params, query }) =>
      Effect.gen(function* () {
        const member = yield* CurrentMember
        const projects = yield* MemberProjects
        return yield* projects.call(member, params.project, projectCalls.error, {
          id: params.error,
          query: queryOf(query),
        })
      }),
    )
    .handle("logLine", ({ params }) =>
      Effect.gen(function* () {
        const member = yield* CurrentMember
        const projects = yield* MemberProjects
        return yield* projects.call(member, params.project, projectCalls.logLine, params.line)
      }),
    )
    .handle("logs", ({ params, query }) =>
      Effect.gen(function* () {
        const member = yield* CurrentMember
        const projects = yield* MemberProjects
        return yield* projects.call(member, params.project, projectCalls.logs, logQueryOf(query))
      }),
    )
    .handle("logMessages", ({ params, query }) =>
      Effect.gen(function* () {
        const member = yield* CurrentMember
        const projects = yield* MemberProjects
        return yield* projects.call(member, params.project, projectCalls.logMessages, logMessageQueryOf(query))
      }),
    )
    .handle("logMessage", ({ params, query }) =>
      Effect.gen(function* () {
        const member = yield* CurrentMember
        const projects = yield* MemberProjects
        return yield* projects.call(member, params.project, projectCalls.logMessage, {
          id: params.message,
          query: queryOf(query),
        })
      }),
    )
    .handle("logCounts", ({ params, query }) =>
      Effect.gen(function* () {
        const member = yield* CurrentMember
        const projects = yield* MemberProjects
        return yield* projects.call(member, params.project, projectCalls.logCounts, logCountQueryOf(query))
      }),
    )
    .handle("trace", ({ params, query }) =>
      Effect.gen(function* () {
        const member = yield* CurrentMember
        const projects = yield* MemberProjects
        return yield* projects.call(member, params.project, projectCalls.trace, {
          trace: params.trace,
          ...(query.around === undefined ? {} : { around: query.around }),
        })
      }),
    ),
)
