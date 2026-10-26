/**
 * Analytics: how a project's apps are used and how healthy each release is, from what their SDKs
 * send: daily, weekly and monthly people, sessions, weekly retention cohorts, each release's
 * launches, memory, crashes and hangs beside the release before it, features and each one's story
 * with its services' warnings, errors and operations, and what one person did. Reads the signals
 * Signals keeps in the project's Durable Object; keeps nothing itself.
 */
export { AnalyticsGroup, AppFilters, AppScopeFilters } from "./analytics-api.ts"
export { analyticsModule } from "./analytics-module.ts"
export { AppHealthList, HealthMeasure, HealthVerdict, ReleaseHealth } from "./app-health.ts"
export { FeatureLogDay, FeatureLogs, FeatureNotFound, FeatureStory } from "./feature-story.ts"
export {
  compareHealth,
  healthVerdictOf,
  judgedAfterMs,
  launchesCompared,
  memoryCompared,
  memoryRule,
  rateRule,
  sessionsCompared,
} from "./health-verdict.ts"
export type { HealthComparison } from "./health-verdict.ts"
