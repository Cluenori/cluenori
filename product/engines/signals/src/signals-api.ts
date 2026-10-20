import { ComponentKey, EnvironmentKey, ProjectKey } from "@cluenori/foundation"
import { ProjectNotFound } from "@cluenori/projects"
import { DateTime, Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api"

import { EndpointTable, RequestSeries, SeriesStep } from "./request-queries.ts"

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

/** The filters of a question about requests, as query parameters: `from` and `to` are ISO 8601 UTC. */
export const RequestFilters = Schema.Struct(filters).check(fromBeforeTo)

/** The filters of a series, with how wide each point is. */
export const SeriesFilters = Schema.Struct({ ...filters, step: SeriesStep }).check(fromBeforeTo)

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
      "Every endpoint's requests in a period, most requested first: how many, how many failed, and their average, p50, p80, p95 and p99 durations. Counted by the minute for periods of two days or less (kept 14 days), by the hour beyond (kept 15 months); `covered` says which part of the period the counts cover.",
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
      "Requests and errors over a period, one point per step that has requests: the load on a project's services. A step without a point had no requests reported. Past two days the counts are hourly, so a finer step becomes an hour; `step` says which was used.",
    ),
  ) {}
