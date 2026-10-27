import { defineModule, moduleQuery } from "@cluenori/foundation"
import {
  AppPerson,
  AppQuery,
  AppReleaseQuery,
  AppRetention,
  AppSignals,
  AppUsage,
  FeatureQuery,
  FeatureUseTable,
  PersonLookup,
  PersonNotFound,
  RetentionQuery,
  ScreenTable,
} from "@cluenori/signals"
import { Effect, Schema } from "effect"

import { AnalyticsGroup } from "./analytics-api.ts"
import { appHealthOf } from "./app-health-query.ts"
import { AppHealthList } from "./app-health.ts"
import { featureStoryOf } from "./feature-story-query.ts"
import { FeatureNotFound, FeatureStory } from "./feature-story.ts"

const usage = Effect.fn("Analytics.usage")(function* (query: AppQuery) {
  const apps = yield* AppSignals
  return yield* apps.usage(query)
})

const retention = Effect.fn("Analytics.retention")(function* (query: RetentionQuery) {
  const apps = yield* AppSignals
  return yield* apps.retention(query)
})

const featureUse = Effect.fn("Analytics.featureUse")(function* (query: AppQuery) {
  const apps = yield* AppSignals
  return yield* apps.features(query)
})

const screens = Effect.fn("Analytics.screens")(function* (query: AppQuery) {
  const apps = yield* AppSignals
  return yield* apps.screens(query)
})

const person = Effect.fn("Analytics.person")(function* (lookup: PersonLookup) {
  const apps = yield* AppSignals
  return yield* apps.person(lookup)
})

/**
 * The module, as the host serves it: its queries run in the project's Durable Object on the apps'
 * signals Signals keeps there. It keeps nothing of its own and does nothing in the background.
 */
export const analyticsModule = defineModule({
  id: "analytics",
  scope: "project",
  queries: {
    /** Usage over a period, by UTC day: daily, weekly and monthly people, sessions, and by release. Reads only. */
    usage: moduleQuery({ input: AppQuery, success: AppUsage, error: Schema.Never, run: usage }),
    /** Weekly cohorts of people by the week each was first seen, and how many came back each week. Reads only. */
    retention: moduleQuery({ input: RetentionQuery, success: AppRetention, error: Schema.Never, run: retention }),
    /** Each release's app health beside the release before it, with a verdict. Reads only. */
    appHealth: moduleQuery({ input: AppReleaseQuery, success: AppHealthList, error: Schema.Never, run: appHealthOf }),
    /** Each feature's people, events, screens and memory, and those of no feature. Reads only. */
    featureUse: moduleQuery({ input: AppQuery, success: FeatureUseTable, error: Schema.Never, run: featureUse }),
    /** Each screen's readiness, visits, CPU time, hitches and hangs, and the apps' timings. Reads only. */
    screens: moduleQuery({ input: AppQuery, success: ScreenTable, error: Schema.Never, run: screens }),
    /**
     * One feature's story over everything kept of it: its use by day, its people, its releases, and its
     * services' warnings, errors and operations by day. Fails with `FeatureNotFound`. Reads only.
     */
    feature: moduleQuery({ input: FeatureQuery, success: FeatureStory, error: FeatureNotFound, run: featureStoryOf }),
    /** One person, by their ID or a user ID: installations, days, features and timeline. Fails with `PersonNotFound`. Reads only. */
    person: moduleQuery({ input: PersonLookup, success: AppPerson, error: PersonNotFound, run: person }),
  },
  api: AnalyticsGroup,
  ingest: {},
  actions: {},
})
