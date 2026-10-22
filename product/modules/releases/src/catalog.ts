import type { ComponentKey, EnvironmentKey, ReleaseVersion } from "@cluenori/foundation"
import { Period } from "@cluenori/foundation"
import type { ReleaseRow } from "@cluenori/signals"
import { hourlyRetention, Signals } from "@cluenori/signals"
import { DateTime, Effect } from "effect"

import type { Deploy } from "./records.ts"
import { ReleaseRecords } from "./records.ts"
import type { StoreBuild } from "./release.ts"

/**
 * A release as the module knows it, from any of its sources: its telemetry's span, a reported
 * deploy, or an app's store build. `at` orders it among the component's releases: when it first
 * ran, was deployed, or was uploaded, whichever came first.
 */
export interface KnownRelease {
  readonly component: ComponentKey
  readonly environment: EnvironmentKey | undefined
  readonly release: ReleaseVersion
  readonly at: DateTime.Utc
  readonly ran: ReleaseRow | undefined
  readonly deploy: Deploy | undefined
  readonly store: StoreBuild | undefined
}

const keyOf = (component: string, environment: string | undefined, release: string) =>
  [component, environment ?? "", release].join("\u0000")

const millisOf = (time: DateTime.Utc | undefined) => (time === undefined ? Infinity : DateTime.toEpochMillis(time))

/**
 * Every release the module knows, the latest first: those Signals counted, kept 15 months after last
 * seen, joined with reported deploys of the same component, environment and release, and with an
 * app's store builds of the same component and release, in every environment it ran in. A store
 * build that ran nowhere and wasn't reported is a release of its own, without an environment.
 */
export const knownReleases = Effect.gen(function* () {
  const signals = yield* Signals
  const records = yield* ReleaseRecords
  const now = yield* DateTime.now
  const counted = yield* signals.releases({
    period: new Period({ from: DateTime.subtractDuration(now, hourlyRetention), to: now }),
  })
  const deploys = yield* records.deploys()
  const builds = yield* records.storeBuilds()

  const known = new Map<string, Omit<KnownRelease, "at">>()
  const entry = (component: ComponentKey, environment: EnvironmentKey | undefined, release: ReleaseVersion) => {
    const key = keyOf(component, environment, release)
    const found = known.get(key) ?? {
      component,
      environment,
      release,
      ran: undefined,
      deploy: undefined,
      store: undefined,
    }
    known.set(key, found)
    return { key, found }
  }
  for (const row of counted.rows) {
    const { key, found } = entry(row.component, row.environment, row.release)
    known.set(key, { ...found, ran: row })
  }
  for (const deploy of deploys) {
    const { key, found } = entry(deploy.component, deploy.environment, deploy.release)
    known.set(key, { ...found, deploy: found.deploy ?? deploy })
  }
  for (const stored of builds) {
    const sameRelease = [...known.entries()].filter(
      ([, each]) => each.component === stored.component && each.release === stored.release,
    )
    if (sameRelease.length === 0) {
      const { key, found } = entry(stored.component, undefined, stored.release)
      known.set(key, { ...found, store: stored.build })
    }
    for (const [key, each] of sameRelease) {
      known.set(key, { ...each, store: stored.build })
    }
  }
  return Array.from(known.values(), (each): KnownRelease => {
    const first = Math.min(
      millisOf(each.ran?.firstSeen),
      millisOf(each.deploy?.deployedAt),
      millisOf(each.store?.uploadedAt),
    )
    return { ...each, at: DateTime.makeUnsafe(first) }
  }).toSorted((left, right) => DateTime.toEpochMillis(right.at) - DateTime.toEpochMillis(left.at))
})

/** The release before `release`: the latest before it, of the same component and environment. */
export const previousOf = (releases: ReadonlyArray<KnownRelease>, release: KnownRelease) =>
  releases.find(
    (other) =>
      other.component === release.component &&
      other.environment === release.environment &&
      DateTime.toEpochMillis(other.at) < DateTime.toEpochMillis(release.at),
  )
