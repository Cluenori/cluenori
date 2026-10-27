import {
  ComponentKey,
  EnvironmentKey,
  FeatureKey,
  Instant,
  PersonId,
  ProjectKey,
  ReleaseVersion,
} from "@cluenori/foundation"
import { ProjectNotFound } from "@cluenori/projects"
import {
  AppPerson,
  AppRetention,
  AppUsage,
  AppUserId,
  FeatureUseTable,
  PersonNotFound,
  ScreenTable,
} from "@cluenori/signals"
import { DateTime, Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api"

import { AppHealthList } from "./app-health.ts"
import { FeatureNotFound, FeatureStory } from "./feature-story.ts"

const aPeriod = Schema.makeFilter(
  (query: { readonly from: DateTime.Utc; readonly to: DateTime.Utc }) => DateTime.isLessThan(query.from, query.to),
  { expected: "a period whose from is before its to" },
)

/** What to count, as query parameters: `from` and `to` are ISO 8601 UTC; the rest narrow it. */
export const AppFilters = Schema.Struct({
  from: Instant,
  to: Instant,
  component: Schema.optionalKey(ComponentKey),
  environment: Schema.optionalKey(EnvironmentKey),
  release: Schema.optionalKey(ReleaseVersion),
}).check(aPeriod)

/** A period, and optionally one component and environment, as query parameters. */
export const AppScopeFilters = Schema.Struct({
  from: Instant,
  to: Instant,
  component: Schema.optionalKey(ComponentKey),
  environment: Schema.optionalKey(EnvironmentKey),
}).check(aPeriod)

/** How a project's apps are used and how healthy each release is: the public API's part for this module. */
export class AnalyticsGroup extends HttpApiGroup.make("analytics")
  .add(
    HttpApiEndpoint.get("usage", "/projects/:project/usage", {
      params: { project: ProjectKey },
      query: AppFilters,
      success: AppUsage,
      error: ProjectNotFound.pipe(HttpApiSchema.status(404)),
    }).annotate(
      OpenApi.Description,
      "How a project's apps were used in a period, by UTC day: the people active (DAU), the people of the 7 and the 30 days ending each day (WAU and MAU), installations, sessions (each time the app came to the foreground) and their foreground time; over the whole period, people, installations, sessions per person and per person and day, and each release's people. Only what the apps' SDKs sent counts: days before the first batch, or older than the 15 months kept, aren't listed, and a week or month that reaches before them has no count, never zero. Narrow it by component, environment and release.",
    ),
  )
  .add(
    HttpApiEndpoint.get("retention", "/projects/:project/retention", {
      params: { project: ProjectKey },
      query: AppScopeFilters,
      success: AppRetention,
      error: ProjectNotFound.pipe(HttpApiSchema.status(404)),
    }).annotate(
      OpenApi.Description,
      "Weekly cohorts of the people first seen in a period, by the UTC week (Monday to Sunday) each was first seen in a component and environment: how many there were, and how many were active in each week since, the first being all of them and the last the week now is in, so far. Activity is kept 15 months.",
    ),
  )
  .add(
    HttpApiEndpoint.get("appHealth", "/projects/:project/app-health", {
      params: { project: ProjectKey },
      query: AppScopeFilters,
      success: AppHealthList,
      error: ProjectNotFound.pipe(HttpApiSchema.status(404)),
    }).annotate(
      OpenApi.Description,
      "The app health of the releases that sent anything in a period, the latest first seen first, at most 30, each over all that is kept of it and beside the release before it of the same component and environment: sessions and people; launch times to the first frame and to the first useful screen, p50 and p95, cold and warm, prewarmed launches only counted; peak memory and footprint p95; MetricKit's crashes and hangs, and per 1,000 sessions. Worse when a launch kind's p95 is at least 1.5 times and 100 ms more than before (both with 50 launches), peak memory's p95 1.25 times and 50 MB more (50 measurements), or crashes or hangs at least 5, twice the rate and 2 per 1,000 sessions more (both with 200 sessions and MetricKit's reports); too early until it ran an hour and a measure compares. What a release didn't send is absent, not zero.",
    ),
  )
  .add(
    HttpApiEndpoint.get("featureUse", "/projects/:project/feature-use", {
      params: { project: ProjectKey },
      query: AppFilters,
      success: FeatureUseTable,
      error: ProjectNotFound.pipe(HttpApiSchema.status(404)),
    }).annotate(
      OpenApi.Description,
      'How each feature key was used in a period, the most people first: the people who did anything in it, its events and screens, and the app\'s memory there (peak and footprint p95); signals the app marked with no feature are the row without a key, "(no feature)", whose share says how much is tagged.',
    ),
  )
  .add(
    HttpApiEndpoint.get("screens", "/projects/:project/screens", {
      params: { project: ProjectKey },
      query: AppFilters,
      success: ScreenTable,
      error: ProjectNotFound.pipe(HttpApiSchema.status(404)),
    }).annotate(
      OpenApi.Description,
      "How each screen of a project's apps did in a period, by UTC day, those visited the most first: how long it took to show its first content from what the device kept and from the network (p50 and p95, as the app marked it ready), its visits and their time in sight, the CPU time the app used per minute in sight, its hitches while scrolling in ms per second scrolled, and the hangs on it (the main thread held 250 ms or more); and the timings the apps measured, by name, with their p50 and p95. A measure the apps didn't send is absent, not zero. Kept 15 months.",
    ),
  )
  .add(
    HttpApiEndpoint.get("person", "/projects/:project/people/:person", {
      params: { project: ProjectKey, person: PersonId },
      success: AppPerson,
      error: [ProjectNotFound.pipe(HttpApiSchema.status(404)), PersonNotFound.pipe(HttpApiSchema.status(404))],
    }).annotate(
      OpenApi.Description,
      "One person of the project, by the ID Cluenori gave them: the app's user IDs linked to them, when they were first and last seen, their installations (component, release, device, country), the days they were active with their sessions, the latest 90, the features they used over 15 months with their days, events and screens, the last used first, at most 50, and their timeline: the latest 1,000 sessions, launches, screens, events and MetricKit reports, newest first.",
    ),
  )
  .add(
    HttpApiEndpoint.get("personByUser", "/projects/:project/people", {
      params: { project: ProjectKey },
      query: { user: AppUserId },
      success: AppPerson,
      error: [ProjectNotFound.pipe(HttpApiSchema.status(404)), PersonNotFound.pipe(HttpApiSchema.status(404))],
    }).annotate(
      OpenApi.Description,
      "The person the app's own user ID `user` is linked to, as the person route answers: what did this user do. 404 when the apps never sent it.",
    ),
  )
  .add(
    HttpApiEndpoint.get("feature", "/projects/:project/features/:feature", {
      params: { project: ProjectKey, feature: FeatureKey },
      query: { environment: Schema.optionalKey(EnvironmentKey), component: Schema.optionalKey(ComponentKey) },
      success: FeatureStory,
      error: [ProjectNotFound.pipe(HttpApiSchema.status(404)), FeatureNotFound.pipe(HttpApiSchema.status(404))],
    }).annotate(
      OpenApi.Description,
      "One feature's story, by its key exactly, over everything kept of it, with no period, in one environment or every one, of every client or one component (`component`: an app's use and errors, a service's operations, warnings and errors): how the apps used it, each UTC day's people, events and screens (15 months), everyone who used it, the 20 who used it last, its releases and the app's memory in it; and what its services sent naming it in `cluenori.feature`: each UTC day's warnings and errors and its 10 most frequent errors (90 days), and each day's operations by component and operation, with how many failed (15 months). A part nothing named the feature in is empty; 404 when nothing kept names it, of any client: narrowed to a component, every part may be empty.",
    ),
  ) {}
