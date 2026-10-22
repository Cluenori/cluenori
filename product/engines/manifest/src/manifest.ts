import { EnvironmentKey, ReleaseVersion } from "@cluenori/foundation"
import { Schema } from "effect"

// What an app's SDK reads at launch and on resume: one small response, cached, that tells it what to
// do before it shows anything. Shipped builds read it for years, so it only grows: an SDK ignores a
// key it doesn't know.

/**
 * What the app should do about its version now:
 * - `none`: nothing;
 * - `recommend`: a newer release is out; offer it in a sheet the person can close;
 * - `require`: this release may no longer be used; show "Update to continue" until it's updated.
 */
export const UpdateDecision = Schema.Literals(["none", "recommend", "require"]).annotate({
  identifier: "UpdateDecision",
})
export type UpdateDecision = typeof UpdateDecision.Type

/**
 * A version as a store shows it, and as a release names it before its build: `0.4.0`, one to four
 * numbers joined by dots. Versions compare part by part as numbers, a missing part as 0.
 */
export const StoreVersion = Schema.String.check(
  Schema.isMaxLength(32),
  Schema.isPattern(/^\d+(\.\d+){0,3}$/, { expected: "a version such as 0.4.0" }),
).pipe(Schema.brand("StoreVersion"))
export type StoreVersion = typeof StoreVersion.Type

/**
 * The release to update to: its version as the store shows it, the oldest OS version it runs on, and
 * where to get it. A device on an older OS can't install it, so the SDK never blocks it: it says so
 * instead.
 */
export const AvailableUpdate = Schema.Struct({
  version: StoreVersion,
  /** `26.0`; absent when unknown. */
  minimumOsVersion: Schema.optionalKey(StoreVersion),
  /** The store's page for the app: `https://apps.apple.com/app/id…`. */
  storeUrl: Schema.String.check(Schema.isPattern(/^https:\/\/\S+$/, { expected: "an https URL" })),
}).annotate({ identifier: "AvailableUpdate" })
export type AvailableUpdate = typeof AvailableUpdate.Type

/** The words to show with a decision, in the language asked for, as the project wrote them. */
export const UpdateText = Schema.Struct({
  title: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(80)),
  message: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(500)),
}).annotate({ identifier: "UpdateText" })
export type UpdateText = typeof UpdateText.Type

/**
 * What the app should do about its version: the decision, the release to update to when there is
 * one, and the project's words for it; without them, the SDK uses its own.
 */
export const VersionPolicy = Schema.Struct({
  decision: UpdateDecision,
  update: Schema.optionalKey(AvailableUpdate),
  text: Schema.optionalKey(UpdateText),
}).annotate({ identifier: "VersionPolicy" })
export type VersionPolicy = typeof VersionPolicy.Type

/**
 * The manifest of one release of an app, in one environment and language. The SDK uses it for
 * `maxAgeSeconds`, then asks again; while it can't ask, it keeps using the last one it got, and with
 * none it never blocks.
 */
export const AppManifest = Schema.Struct({
  versionPolicy: VersionPolicy,
  maxAgeSeconds: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
}).annotate({ identifier: "AppManifest" })
export type AppManifest = typeof AppManifest.Type

/** Which manifest: the app's release, where it runs, and the language to show words in (BCP 47: `uk-UA`). */
export const ManifestQuery = Schema.Struct({
  environment: EnvironmentKey,
  release: ReleaseVersion,
  locale: Schema.optionalKey(Schema.String.check(Schema.isMinLength(2), Schema.isMaxLength(35))),
}).annotate({ identifier: "ManifestQuery" })
export type ManifestQuery = typeof ManifestQuery.Type
