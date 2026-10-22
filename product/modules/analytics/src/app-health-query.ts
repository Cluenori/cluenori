import type { AppHealth, AppRelease, AppReleaseQuery } from "@cluenori/signals"
import { AppSignals } from "@cluenori/signals"
import { DateTime, Effect } from "effect"

import type { AppHealthList, ReleaseHealth } from "./app-health.ts"
import { compareHealth, healthVerdictOf, perThousand } from "./health-verdict.ts"

// The most releases one answer compares, the latest first.
const listed = 30

// The release before `release`'s health, when it has one.
const previousHealthOf = Effect.fn("Analytics.previousHealthOf")(function* (release: AppRelease) {
  const apps = yield* AppSignals
  const previous = release.previous
  if (previous === undefined) {
    return undefined
  }
  return yield* apps.health({ component: release.component, environment: release.environment, release: previous })
})

// Crashes and hangs per 1,000 sessions, each when MetricKit reported of the release and it had sessions.
const ratesOf = (health: AppHealth) => {
  const diagnostics = health.diagnostics
  if (diagnostics === undefined) {
    return { crashes: undefined, hangs: undefined }
  }
  return {
    crashes: perThousand(diagnostics.crashes, health.sessions),
    hangs: perThousand(diagnostics.hangs, health.sessions),
  }
}

// One release beside the release before it.
const releaseHealthOf = Effect.fn("Analytics.releaseHealthOf")(function* (release: AppRelease) {
  const apps = yield* AppSignals
  const health = yield* apps.health(release)
  const previousHealth = yield* previousHealthOf(release)
  const comparison = previousHealth === undefined ? undefined : compareHealth(health, previousHealth)
  const rates = ratesOf(health)
  const previousRates =
    previousHealth === undefined ? { crashes: undefined, hangs: undefined } : ratesOf(previousHealth)
  const ranMs = DateTime.toEpochMillis(release.lastSeen) - DateTime.toEpochMillis(release.firstSeen)
  const row: ReleaseHealth = {
    release,
    health,
    ...(previousHealth === undefined ? {} : { previousHealth }),
    ...(rates.crashes === undefined ? {} : { crashesPerThousand: rates.crashes }),
    ...(rates.hangs === undefined ? {} : { hangsPerThousand: rates.hangs }),
    ...(previousRates.crashes === undefined ? {} : { previousCrashesPerThousand: previousRates.crashes }),
    ...(previousRates.hangs === undefined ? {} : { previousHangsPerThousand: previousRates.hangs }),
    verdict: healthVerdictOf(health, comparison, ranMs),
    worse: comparison?.worse ?? [],
    better: comparison?.better ?? [],
  }
  return row
})

/**
 * The app health of the releases that sent anything in the query's period, the latest first seen
 * first, at most 30, each over everything kept of it and beside the release before it. Reads two
 * releases' measures for each.
 */
export const appHealthOf = Effect.fn("Analytics.appHealth")(function* (query: AppReleaseQuery) {
  const apps = yield* AppSignals
  const { releases } = yield* apps.releases(query)
  const rows = yield* Effect.forEach(releases.slice(0, listed), releaseHealthOf)
  const list: AppHealthList = { releases: rows }
  return list
})
