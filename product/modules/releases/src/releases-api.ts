import { ComponentKey, EnvironmentKey, Instant, ProjectKey, ReleaseVersion } from "@cluenori/foundation"
import { ProjectNotFound } from "@cluenori/projects"
import { DateTime, Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api"

import { ReleaseDetail, ReleaseList, ReleaseNotFound } from "./release.ts"

/** The filters of a list of releases, as query parameters: `from` and `to` are ISO 8601 UTC. */
export const ReleaseFilters = Schema.Struct({
  from: Instant,
  to: Instant,
  environment: Schema.optionalKey(EnvironmentKey),
  component: Schema.optionalKey(ComponentKey),
}).check(
  Schema.makeFilter(
    (query: { readonly from: DateTime.Utc; readonly to: DateTime.Utc }) => DateTime.isLessThan(query.from, query.to),
    { expected: "a period whose from is before its to" },
  ),
)

/** A project's releases, each compared with the one before it: the public API's part for this module. */
export class ReleasesGroup extends HttpApiGroup.make("releases")
  .add(
    HttpApiEndpoint.get("releases", "/projects/:project/releases", {
      params: { project: ProjectKey },
      query: ReleaseFilters,
      success: ReleaseList,
      error: ProjectNotFound.pipe(HttpApiSchema.status(404)),
    }).annotate(
      OpenApi.Description,
      "The releases whose operations ran in a period, the latest first seen first, at most 30: each component's versions as it reports them in `service.version`, from the first minute each ran to the last, with a verdict against the release before it of the same component and environment. Worse when an operation got slower (a p95 at least 1.5 times and 100 ms more) or fails more (at least 5 failures, 2%, and three times the rate before), or an error was first seen in it; too early until it ran an hour and an operation ran 100 times in both. Operations are counted by release from October 2026.",
    ),
  )
  .add(
    HttpApiEndpoint.get("release", "/projects/:project/releases/:component/:release", {
      params: { project: ProjectKey, component: ComponentKey, release: ReleaseVersion },
      query: { environment: Schema.optionalKey(EnvironmentKey) },
      success: ReleaseDetail,
      error: [ProjectNotFound.pipe(HttpApiSchema.status(404)), ReleaseNotFound.pipe(HttpApiSchema.status(404))],
    }).annotate(
      OpenApi.Description,
      "One release compared with the one before it, in `environment`, or without it the environment it last ran in: the operations that got slower, fail more, got faster, or fail less, each the biggest change first; the operations new in it; the errors first seen in it; and the incidents that opened while it ran, of those the project keeps.",
    ),
  ) {}
