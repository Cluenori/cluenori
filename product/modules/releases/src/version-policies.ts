import type { Actor, ComponentKey } from "@cluenori/foundation"
import { ActivityLog, Source } from "@cluenori/foundation"
import type { ManifestQuery, VersionPolicy } from "@cluenori/manifest"
import { StoreVersion } from "@cluenori/manifest"
import type { Component } from "@cluenori/projects"
import { defaultProjectSettings, isProduction, Projects } from "@cluenori/projects"
import { DateTime, Effect, Option, Schema } from "effect"

import { ReleaseRecords } from "./records.ts"
import { VersionPolicyCleared, VersionPolicySet } from "./releases-activity.ts"
import { ReleaseSources } from "./sources.ts"
import type {
  ClearVersionPolicy,
  ComponentVersionPolicy,
  SetVersionPolicy,
  UpdateWords,
  UpdateWordsDecision,
  VersionPolicies,
} from "./version-policy.ts"
import { compareStoreVersions, VersionPolicyRefused } from "./version-policy.ts"

const source = Source.make("module:releases")

const none: VersionPolicy = { decision: "none" }

/** The project's components' version policies. Reads one table. */
export const versionPolicies = Effect.gen(function* () {
  const records = yield* ReleaseRecords
  const stored = yield* records.versionPolicies
  const policies: VersionPolicies = { policies: stored }
  return policies
}).pipe(Effect.withSpan("Releases.versionPolicies"))

/**
 * Sets a component's version policy, replacing the one it had, with `version_policy.set` for
 * `actor`. Without a store URL, the App Store page of the app its App Store deploy target names
 * (one in a production environment first) is asked of App Store Connect, before the write. Fails
 * with `VersionPolicyRefused` for a component the project lacks, neither a minimum nor a
 * recommended version, a recommended version lower than the minimum, or no store URL found.
 */
export const setVersionPolicy = Effect.fn("Releases.setVersionPolicy")(function* (
  actor: Actor,
  request: SetVersionPolicy,
) {
  const projects = yield* Projects
  const records = yield* ReleaseRecords
  const components = yield* projects.components.pipe(Effect.catchTag("ProjectNotFound", () => Effect.succeed([])))
  const component = components.find((each) => each.key === request.component)
  if (component === undefined) {
    return yield* new VersionPolicyRefused({ reason: `The project has no component ${request.component}` })
  }
  if (request.minimum === undefined && request.recommended === undefined) {
    return yield* new VersionPolicyRefused({
      reason: "A policy needs a minimum version, a recommended one, or both",
    })
  }
  if (
    request.minimum !== undefined &&
    request.recommended !== undefined &&
    compareStoreVersions(request.recommended, request.minimum) < 0
  ) {
    return yield* new VersionPolicyRefused({
      reason: `The recommended version, ${request.recommended}, is lower than the minimum, ${request.minimum}`,
    })
  }
  // Looked up before the write, which is SQL only.
  const storeUrl = yield* request.storeUrl === undefined ? appStorePageOf(component) : Effect.succeed(request.storeUrl)
  const setAt = yield* DateTime.now
  const policy: ComponentVersionPolicy = {
    component: request.component,
    ...(request.minimum === undefined ? {} : { minimum: request.minimum }),
    ...(request.recommended === undefined ? {} : { recommended: request.recommended }),
    storeUrl,
    ...(request.minimumOsVersion === undefined ? {} : { minimumOsVersion: request.minimumOsVersion }),
    words: request.words ?? [],
    setAt,
  }
  const log = yield* ActivityLog
  yield* log.commit({
    source,
    actor,
    write: records.saveVersionPolicy(policy),
    activity: () => [
      {
        payload: VersionPolicySet.make({
          ...(policy.minimum === undefined ? {} : { minimum: policy.minimum }),
          ...(policy.recommended === undefined ? {} : { recommended: policy.recommended }),
          storeUrl: policy.storeUrl,
        }),
        component: request.component,
      },
    ],
  })
  return policy
})

// The App Store page of the app `component`'s App Store deploy target names, one in a production
// environment first, as App Store Connect knows it; refused with what to do when there is none.
const appStorePageOf = Effect.fn("Releases.appStorePageOf")(function* (component: Component) {
  const projects = yield* Projects
  const settings = yield* projects.settings.pipe(
    Effect.catchTag("ProjectNotFound", () => Effect.succeed(defaultProjectSettings)),
  )
  const targets = (component.deployTargets ?? []).filter((each) => each.appStore?.distribution === "appStore")
  const target = targets.find((each) => isProduction(settings, each.environment)) ?? targets[0]
  const bundleId = target?.appStore?.bundleId
  const giveIt = "give the store URL, such as https://apps.apple.com/app/id1234567890"
  if (bundleId === undefined) {
    return yield* new VersionPolicyRefused({
      reason: `${component.key} has no deploy target to the App Store to find its page from: ${giveIt}`,
    })
  }
  const sources = yield* ReleaseSources
  if (Option.isNone(sources.appStoreConnect)) {
    return yield* new VersionPolicyRefused({
      reason: `App Store Connect isn't set up, so the page of ${bundleId} can't be found: ${giveIt}`,
    })
  }
  const app = yield* sources.appStoreConnect.value.app(bundleId).pipe(
    Effect.mapError(
      (error) =>
        new VersionPolicyRefused({
          reason: `App Store Connect didn't say ${bundleId}'s app: ${error.reason}; ${giveIt}`,
        }),
    ),
  )
  if (Option.isNone(app)) {
    return yield* new VersionPolicyRefused({ reason: `App Store Connect has no app ${bundleId}: ${giveIt}` })
  }
  return `https://apps.apple.com/app/id${app.value.id}`
})

/**
 * Removes a component's version policy, with `version_policy.cleared` for `actor`; for a component
 * without one, nothing, and no activity.
 */
export const clearVersionPolicy = Effect.fn("Releases.clearVersionPolicy")(function* (
  actor: Actor,
  request: ClearVersionPolicy,
) {
  const records = yield* ReleaseRecords
  const current = yield* records.versionPolicy(request.component)
  if (Option.isNone(current)) {
    return
  }
  const log = yield* ActivityLog
  yield* log.commit({
    source,
    actor,
    write: records.removeVersionPolicy(request.component),
    activity: () => [{ payload: VersionPolicyCleared.make({}), component: request.component }],
  })
})

const storeVersionOf = Schema.decodeOption(StoreVersion)

// The project's words for `decision` in `locale`: that language exactly, else the same language in
// another region or script; BCP 47 tags compare without case.
const wordsFor = (words: ReadonlyArray<UpdateWords>, decision: UpdateWordsDecision, locale: string | undefined) => {
  if (locale === undefined) {
    return undefined
  }
  const asked = locale.toLowerCase()
  const [language] = asked.split("-")
  const forDecision = words.filter((each) => each.decision === decision)
  return (
    forDecision.find((each) => each.locale.toLowerCase() === asked) ??
    forDecision.find((each) => each.locale.toLowerCase().split("-")[0] === language)
  )
}

/**
 * What one release of `component` should do about its version in `query.environment`, in
 * `query.locale`: `require` when its version (the part of the release before `+`, such as 0.3.0 of
 * 0.3.0+20) is below the policy's minimum, `recommend` when below the recommended version, otherwise
 * `none`; with the release to update to (the recommended version, or the minimum without one, its store
 * URL and minimum OS version) when there is a decision, and the project's words for that decision in
 * the locale asked (exact, then the same language), absent otherwise. `none`, never a failure, without
 * a policy, outside the project's production environments, or for a release whose version isn't
 * one to four numbers. Reads two rows.
 */
export const versionPolicyFor = Effect.fn("Releases.versionPolicyFor")(function* (
  component: ComponentKey,
  query: ManifestQuery,
) {
  const projects = yield* Projects
  const settings = yield* projects.settings.pipe(
    Effect.asSome,
    Effect.catchTag("ProjectNotFound", () => Effect.succeedNone),
  )
  if (Option.isNone(settings) || !isProduction(settings.value, query.environment)) {
    return none
  }
  const records = yield* ReleaseRecords
  const policy = yield* records.versionPolicy(component)
  const [versionPart = ""] = query.release.split("+")
  const version = storeVersionOf(versionPart)
  if (Option.isNone(policy) || Option.isNone(version)) {
    return none
  }
  const { minimum, recommended } = policy.value
  const belowMinimum = minimum !== undefined && compareStoreVersions(version.value, minimum) < 0
  const belowRecommended = recommended !== undefined && compareStoreVersions(version.value, recommended) < 0
  const updateTo = recommended ?? minimum
  if ((!belowMinimum && !belowRecommended) || updateTo === undefined) {
    return none
  }
  const decision: UpdateWordsDecision = belowMinimum ? "require" : "recommend"
  const words = wordsFor(policy.value.words, decision, query.locale)
  const answer: VersionPolicy = {
    decision,
    update: {
      version: updateTo,
      ...(policy.value.minimumOsVersion === undefined ? {} : { minimumOsVersion: policy.value.minimumOsVersion }),
      storeUrl: policy.value.storeUrl,
    },
    ...(words === undefined ? {} : { text: words.text }),
  }
  return answer
})
