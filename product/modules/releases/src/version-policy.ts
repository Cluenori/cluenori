import { ComponentKey, Instant } from "@cluenori/foundation"
import { AvailableUpdate, StoreVersion, UpdateText } from "@cluenori/manifest"
import { Schema } from "effect"

import { NoteLocale } from "./note.ts"

const partsOf = (version: StoreVersion) => version.split(".").map(Number)

/**
 * How `left` orders against `right`: negative when it is lower, 0 when the same, positive when
 * higher. Part by part as numbers, a missing part as 0, so `0.4` is the same as `0.4.0`.
 */
export const compareStoreVersions = (left: StoreVersion, right: StoreVersion) => {
  const ours = partsOf(left)
  const theirs = partsOf(right)
  const differences = Array.from(
    { length: Math.max(ours.length, theirs.length) },
    (_, index) => (ours[index] ?? 0) - (theirs[index] ?? 0),
  )
  return differences.find((difference) => difference !== 0) ?? 0
}

/** The decisions a project writes words for: requiring an update, or recommending one. */
export const UpdateWordsDecision = Schema.Literals(["require", "recommend"]).annotate({
  identifier: "UpdateWordsDecision",
})
export type UpdateWordsDecision = typeof UpdateWordsDecision.Type

/** The project's words for one decision in one language: what the app shows instead of the SDK's own. */
export const UpdateWords = Schema.Struct({
  locale: NoteLocale,
  decision: UpdateWordsDecision,
  text: UpdateText,
}).annotate({ identifier: "UpdateWords" })
export type UpdateWords = typeof UpdateWords.Type

/** Words in at most 40 languages and decisions, one for each language and decision. */
const PolicyWords = Schema.Array(UpdateWords).check(
  Schema.isMaxLength(40),
  Schema.makeFilter(
    (words: ReadonlyArray<UpdateWords>) =>
      new Set(words.map((each) => `${each.decision} ${each.locale}`)).size === words.length,
    { expected: "one text for each language and decision" },
  ),
)

// What a policy says, besides its component: the PUT route's payload, and the action's input with
// the component.
const policyFields = {
  /** Releases below it must update: the app shows "Update to continue" until they do. */
  minimum: Schema.optionalKey(StoreVersion),
  /** Releases below it, and not below the minimum, are offered it in a sheet people can close. */
  recommended: Schema.optionalKey(StoreVersion),
  /** The store's page for the app: `https://apps.apple.com/app/id…`. */
  storeUrl: Schema.optionalKey(AvailableUpdate.fields.storeUrl),
  /** The oldest OS version the release to update to runs on, such as `26.0`. */
  minimumOsVersion: Schema.optionalKey(StoreVersion),
  /** The project's words for each decision, by language; without them, the SDK's own. */
  words: Schema.optionalKey(PolicyWords),
}

/**
 * A component's version policy: the oldest version its users may keep (`minimum`), the version to
 * recommend (`recommended`), at least one of them, the recommended not lower than the minimum;
 * where to get the app, always; the oldest OS the release to update to runs on; and the project's
 * words. Its releases in the project's production environments follow it, through the manifest.
 */
export const ComponentVersionPolicy = Schema.Struct({
  component: ComponentKey,
  minimum: policyFields.minimum,
  recommended: policyFields.recommended,
  storeUrl: AvailableUpdate.fields.storeUrl,
  minimumOsVersion: policyFields.minimumOsVersion,
  words: PolicyWords,
  setAt: Instant,
})
  .check(
    Schema.makeFilter(
      (policy: { readonly minimum?: StoreVersion; readonly recommended?: StoreVersion }) =>
        policy.minimum !== undefined || policy.recommended !== undefined,
      { expected: "a minimum version, a recommended one, or both" },
    ),
    Schema.makeFilter(
      (policy: { readonly minimum?: StoreVersion; readonly recommended?: StoreVersion }) =>
        policy.minimum === undefined ||
        policy.recommended === undefined ||
        compareStoreVersions(policy.recommended, policy.minimum) >= 0,
      { expected: "a recommended version not lower than the minimum" },
    ),
  )
  .annotate({ identifier: "ComponentVersionPolicy" })
export type ComponentVersionPolicy = typeof ComponentVersionPolicy.Type

/** The project's components' version policies; a component without one isn't listed. */
export const VersionPolicies = Schema.Struct({ policies: Schema.Array(ComponentVersionPolicy) }).annotate({
  identifier: "VersionPolicies",
})
export type VersionPolicies = typeof VersionPolicies.Type

/** A component's version policy, without its component: what the public API's PUT carries. */
export const VersionPolicyTo = Schema.Struct(policyFields).annotate({ identifier: "VersionPolicyTo" })
export type VersionPolicyTo = typeof VersionPolicyTo.Type

/**
 * Set a component's version policy, replacing the one it had: a field left out is unset. Without a
 * store URL, the App Store page of the app its App Store deploy target names is looked up.
 */
export const SetVersionPolicy = Schema.Struct({ component: ComponentKey, ...policyFields }).annotate({
  identifier: "SetVersionPolicy",
})
export type SetVersionPolicy = typeof SetVersionPolicy.Type

/** Remove a component's version policy: its releases are no longer asked to update. */
export const ClearVersionPolicy = Schema.Struct({ component: ComponentKey }).annotate({
  identifier: "ClearVersionPolicy",
})
export type ClearVersionPolicy = typeof ClearVersionPolicy.Type

/**
 * The version policy wasn't set, for the reason given: a component the project lacks; neither a
 * minimum nor a recommended version; a recommended version lower than the minimum; or no store URL
 * given and none found from an App Store deploy target.
 */
export class VersionPolicyRefused extends Schema.TaggedError<VersionPolicyRefused>()("VersionPolicyRefused", {
  reason: Schema.String,
}) {}
