import type { EnvironmentKey } from "@cluenori/foundation"
import type { DeployTarget } from "@cluenori/projects"
import { Projects } from "@cluenori/projects"
import { DateTime, Effect } from "effect"

import type { KnownRelease } from "./catalog.ts"
import { knownReleases } from "./catalog.ts"
import type { ComponentDelivery, Delivery, EnvironmentDelivery, NextStep } from "./delivery.ts"
import type { Promotion } from "./promotion.ts"
import { ReleaseRecords } from "./records.ts"
import { summaryOf } from "./releases.ts"

// When a release reached an environment, by how releases get there: an App Store app's build when it
// was released there, a TestFlight build when uploaded; elsewhere, when it was last deployed there or
// first ran there, whichever is later. None for a build not out there yet.
const reachedAt = (release: KnownRelease, target: DeployTarget | undefined): DateTime.Utc | undefined => {
  const store = release.store
  if (target?.appStore !== undefined) {
    if (store === undefined) {
      return undefined
    }
    if (target.appStore.distribution === "appStore") {
      const out = store.stage === "releasing" || store.stage === "live"
      return out ? (store.phasedRelease?.startedAt ?? store.uploadedAt) : undefined
    }
    const testable = store.stage !== "processing" && store.stage !== "failed" && store.stage !== "expired"
    return testable ? store.uploadedAt : undefined
  }
  const times = [release.deploy?.lastDeployedAt, release.ran?.firstSeen].filter((time) => time !== undefined)
  return times.toSorted((a, b) => DateTime.toEpochMillis(b) - DateTime.toEpochMillis(a))[0]
}

// Whether a promotion ended without its release getting where it went.
const unsuccessful = (state: Promotion["state"]) =>
  state === "failed" || state === "cancelled" || state === "rejected" || state === "lost"

// One environment of a component, as delivery reads it.
interface Stage {
  readonly environment: EnvironmentKey
  readonly target: DeployTarget | undefined
  /** The release that reached it last, and when. */
  readonly current: { readonly release: KnownRelease; readonly at: DateTime.Utc } | undefined
  /** The promotion to it that hasn't ended. */
  readonly promotion: Promotion | undefined
  /**
   * The latest promotion to it, when it ended without its release getting there and nothing reached
   * it since it started.
   */
  readonly failedPromotion: Promotion | undefined
}

// What can go to `stage` next: nothing without a target or while a promotion to it hasn't ended; to
// the first, the latest commit when its target has a workflow; to another, the release of the stage
// before it, when that release appeared after the one there.
const nextStepOf = (
  stage: Stage,
  before: Stage | undefined,
  appeared: (release: KnownRelease | undefined) => number,
): NextStep | undefined => {
  if (stage.target === undefined || stage.promotion !== undefined) {
    return undefined
  }
  if (before === undefined) {
    return stage.target.workflow === undefined ? undefined : { _tag: "buildLatest" }
  }
  const candidate = before.current?.release
  if (
    candidate === undefined ||
    candidate.release === stage.current?.release.release ||
    appeared(candidate) <= appeared(stage.current?.release)
  ) {
    return undefined
  }
  return { _tag: "promote", release: candidate.release, from: before.environment }
}

// The release that reached `environment` last, and when.
const currentIn = (releases: ReadonlyArray<KnownRelease>, target: DeployTarget | undefined) =>
  releases
    .flatMap((release) => {
      const at = reachedAt(release, target)
      return at === undefined ? [] : [{ release, at }]
    })
    .toSorted((a, b) => DateTime.toEpochMillis(b.at) - DateTime.toEpochMillis(a.at))[0]

/**
 * Each of the project's components, in the project's order, with its environments as delivery
 * reads them: those of its deploy targets, in their order, else those it ran or was deployed in, by
 * name; each with the release that reached it last, the promotion to it that hasn't ended, and the
 * latest that ended without its release getting there while nothing reached it since; and every
 * release the module knows. Reads only the project's database: the module's records and the
 * releases Signals counted.
 */
export const stagesOf = Effect.gen(function* () {
  const projects = yield* Projects
  const records = yield* ReleaseRecords
  const components = yield* projects.components.pipe(Effect.catchTag("ProjectNotFound", () => Effect.succeed([])))
  const releases = yield* knownReleases
  const unended = yield* records.unendedPromotions()
  const latest = yield* records.latestPromotions
  const staged = components.map((component) => {
    const own = releases.filter((release) => release.component === component.key)
    const targets = component.deployTargets ?? []
    const environments =
      targets.length > 0
        ? targets.map((target) => ({ environment: target.environment, target }))
        : [...new Set(own.flatMap((release) => (release.environment === undefined ? [] : [release.environment])))]
            .toSorted()
            .map((environment) => ({ environment, target: undefined }))
    const stages = environments.map(({ environment, target }): Stage => {
      const current = currentIn(
        own.filter((release) => release.environment === environment),
        target,
      )
      const last = latest.find(
        (promotion) => promotion.component === component.key && promotion.environment === environment,
      )
      const failedPromotion =
        last !== undefined &&
        unsuccessful(last.state) &&
        (current === undefined || DateTime.toEpochMillis(current.at) < DateTime.toEpochMillis(last.startedAt))
          ? last
          : undefined
      return {
        environment,
        target,
        current,
        promotion: unended.find(
          (promotion) => promotion.component === component.key && promotion.environment === environment,
        ),
        failedPromotion,
      }
    })
    return { component, stages }
  })
  return { components: staged, releases }
}).pipe(Effect.withSpan("Releases.stages"))

/**
 * Each component's delivery: for each of its environments, the release that reached it last (an App
 * Store app's, the build out on the App Store; a TestFlight app's, the latest build processed;
 * elsewhere, the release last deployed or first run there), the promotion to it that hasn't ended,
 * and the next step: to the first environment with a workflow, building the latest commit; to each
 * after it, promoting the release of the one before when that release first appeared after the
 * release there. Reads each current release's telemetry, as `releases` does a release's.
 */
export const deliveryOf = Effect.gen(function* () {
  const records = yield* ReleaseRecords
  const { components, releases } = yield* stagesOf
  const versions = yield* records.versionLines
  // When each release first appeared anywhere, which orders a component's releases.
  const firstAppeared = new Map<string, number>()
  for (const release of releases) {
    const key = `${release.component}\u0000${release.release}`
    firstAppeared.set(key, Math.min(firstAppeared.get(key) ?? Infinity, DateTime.toEpochMillis(release.at)))
  }
  const appeared = (release: KnownRelease | undefined) =>
    release === undefined ? -Infinity : (firstAppeared.get(`${release.component}\u0000${release.release}`) ?? -Infinity)

  const delivered: Array<ComponentDelivery> = []
  for (const { component, stages } of components) {
    const environmentDeliveries: Array<EnvironmentDelivery> = []
    for (const [index, stage] of stages.entries()) {
      const next = nextStepOf(stage, stages[index - 1], appeared)
      const current =
        stage.current === undefined
          ? undefined
          : { summary: (yield* summaryOf(releases, stage.current.release)).summary, since: stage.current.at }
      environmentDeliveries.push({
        environment: stage.environment,
        ...(stage.target === undefined ? {} : { target: stage.target }),
        ...(current === undefined ? {} : { current }),
        ...(stage.promotion === undefined ? {} : { promotion: stage.promotion }),
        ...(stage.failedPromotion === undefined ? {} : { failedPromotion: stage.failedPromotion }),
        ...(next === undefined ? {} : { next }),
      })
    }
    const version = versions.find((line) => line.component === component.key)
    delivered.push({
      component: component.key,
      ...(component.shipsWith === undefined ? {} : { shipsWith: component.shipsWith }),
      ...(version === undefined ? {} : { version }),
      environments: environmentDeliveries,
    })
  }
  const delivery: Delivery = { components: delivered }
  return delivery
}).pipe(Effect.withSpan("Releases.delivery"))
