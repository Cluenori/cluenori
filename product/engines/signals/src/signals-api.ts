import { ComponentKey, EnvelopeName, EnvironmentKey, ProjectKey, TraceId } from "@cluenori/foundation"
import { ProjectNotFound } from "@cluenori/projects"
import { DateTime, Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api"

import { ArchiveUnavailable } from "./archive-store.ts"
import {
  ErrorDetail,
  ErrorGroupNotFound,
  ErrorTable,
  IndexedLevel,
  LogCounts,
  LogCountsBy,
  LogPage,
} from "./error-groups.ts"
import { ErrorGroupId } from "./log-entry.ts"
import { EndpointTable, RequestSeries, SeriesStep } from "./request-queries.ts"
import { TraceView } from "./trace-view.ts"

const filters = {
  from: Schema.DateTimeUtcFromString,
  to: Schema.DateTimeUtcFromString,
  environment: Schema.optionalKey(EnvironmentKey),
  component: Schema.optionalKey(ComponentKey),
}

const fromBeforeTo = Schema.makeFilter(
  (query: { readonly from: DateTime.Utc; readonly to: DateTime.Utc }) => DateTime.isLessThan(query.from, query.to),
  { expected: "a period whose from is before its to" },
)

// Requests can also be narrowed to one endpoint, by its name: `GET /api/notes/{id}`.
const requestFilters = { ...filters, endpoint: Schema.optionalKey(EnvelopeName) }

/** The filters of a question about requests, as query parameters: `from` and `to` are ISO 8601 UTC. */
export const RequestFilters = Schema.Struct(requestFilters).check(fromBeforeTo)

/** The filters of a series, with how wide each point is. */
export const SeriesFilters = Schema.Struct({ ...requestFilters, step: SeriesStep }).check(fromBeforeTo)

/** The filters of a search of warnings and errors; `before` continues an earlier answer's page. */
export const LogFilters = Schema.Struct({
  ...filters,
  level: Schema.optionalKey(IndexedLevel),
  search: Schema.optionalKey(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200))),
  category: Schema.optionalKey(Schema.String),
  trace: Schema.optionalKey(TraceId),
  error: Schema.optionalKey(ErrorGroupId),
  before: Schema.optionalKey(Schema.Int),
}).check(fromBeforeTo)

/** The filters of counts of warnings and errors over time: how wide each point is, and what each series is. */
export const LogCountFilters = Schema.Struct({
  ...filters,
  step: SeriesStep,
  by: LogCountsBy,
  level: Schema.optionalKey(IndexedLevel),
  error: Schema.optionalKey(ErrorGroupId),
}).check(fromBeforeTo)

/** When to look for a trace: within two minutes of `around`, ISO 8601 UTC. */
export const TraceFilters = Schema.Struct({ around: Schema.DateTimeUtcFromString })

/** Requests of a project's services: the public API's part for this engine. */
export class SignalsGroup extends HttpApiGroup.make("signals")
  .add(
    HttpApiEndpoint.get("endpoints", "/projects/:project/endpoints", {
      params: { project: ProjectKey },
      query: RequestFilters,
      success: EndpointTable,
      error: ProjectNotFound.pipe(HttpApiSchema.status(404)),
    }).annotate(
      OpenApi.Description,
      "Every endpoint's requests in a period, most requested first, or one endpoint's with `endpoint`: how many, how many failed, and their average, p50, p80, p95 and p99 durations. Counted by the minute for periods of two days or less (kept 14 days), by the hour beyond (kept 15 months); `covered` says which part of the period the counts cover.",
    ),
  )
  .add(
    HttpApiEndpoint.get("requests", "/projects/:project/requests", {
      params: { project: ProjectKey },
      query: SeriesFilters,
      success: RequestSeries,
      error: ProjectNotFound.pipe(HttpApiSchema.status(404)),
    }).annotate(
      OpenApi.Description,
      "Requests and errors over a period, one point per step that has requests, with their p50, p80, p95 and p99 durations: the load on a project's services, or on one endpoint with `endpoint`. A step without a point had no requests reported. Past two days the counts are hourly, so a finer step becomes an hour; `step` says which was used.",
    ),
  )
  .add(
    HttpApiEndpoint.get("errors", "/projects/:project/errors", {
      params: { project: ProjectKey },
      query: RequestFilters,
      success: ErrorTable,
      error: ProjectNotFound.pipe(HttpApiSchema.status(404)),
    }).annotate(
      OpenApi.Description,
      "The errors of a period, most frequent first: each error log grouped by its exception's type and stack, or by its logger and message, with when it was first and last seen. Kept 90 days.",
    ),
  )
  .add(
    HttpApiEndpoint.get("error", "/projects/:project/errors/:error", {
      params: { project: ProjectKey, error: ErrorGroupId },
      query: RequestFilters,
      success: ErrorDetail,
      error: [ProjectNotFound.pipe(HttpApiSchema.status(404)), ErrorGroupNotFound.pipe(HttpApiSchema.status(404))],
    }).annotate(
      OpenApi.Description,
      "One error and its latest occurrences in a period, with their messages, stack traces, and trace IDs: where an investigation starts. Each occurrence's trace ID and time open its request with the traces endpoint.",
    ),
  )
  .add(
    HttpApiEndpoint.get("logs", "/projects/:project/logs", {
      params: { project: ProjectKey },
      query: LogFilters,
      success: LogPage,
      error: ProjectNotFound.pipe(HttpApiSchema.status(404)),
    }).annotate(
      OpenApi.Description,
      "Warnings and errors, newest first, 100 at a time: filtered by level, text, logger, trace, or error. Kept 90 days. Records below warning are in the archive, which the traces endpoint reads for one request.",
    ),
  )
  .add(
    HttpApiEndpoint.get("logCounts", "/projects/:project/logs/counts", {
      params: { project: ProjectKey },
      query: LogCountFilters,
      success: LogCounts,
      error: ProjectNotFound.pipe(HttpApiSchema.status(404)),
    }).annotate(
      OpenApi.Description,
      "Warnings and errors counted over time: a series for each level, component, or error group (`by`), at `level` or above (warn when absent), with a point for each step that had any. By error group, the 100 most frequent. Kept 90 days; `covered` says which part of the period the counts cover.",
    ),
  )
  .add(
    HttpApiEndpoint.get("trace", "/projects/:project/traces/:trace", {
      params: { project: ProjectKey, trace: TraceId },
      query: TraceFilters,
      success: TraceView,
      error: [ProjectNotFound.pipe(HttpApiSchema.status(404)), ArchiveUnavailable],
    }).annotate(
      OpenApi.Description,
      "One request across services, from the archive: its spans as a tree, with their durations and attributes, and its logs at every level. Give the time it happened as `around`; the archive is read within two minutes of it. Kept 90 days.",
    ),
  ) {}
