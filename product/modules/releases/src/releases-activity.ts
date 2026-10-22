import { CommitSha, Repository, WorkflowFile } from "@bagatka/github"
import { EnvironmentKey, ReleaseVersion } from "@cluenori/foundation"
import { StoreVersion } from "@cluenori/manifest"
import { Schema } from "effect"

import { PromotionId, PromotionReason, PromotionState } from "./promotion.ts"
import { BuildNumber, SemanticVersion } from "./version.ts"

/**
 * A member promoted a release, with their reason: its deploy workflow started on GitHub, when its
 * target has one, and its build is followed to its App Store Connect app, when it has one.
 */
export const PromotionStarted = Schema.TaggedStruct("promotion.started", {
  promotion: PromotionId,
  release: ReleaseVersion,
  environment: EnvironmentKey,
  repository: Schema.optionalKey(Repository),
  workflow: Schema.optionalKey(WorkflowFile),
  appStore: Schema.optionalKey(Schema.String),
  reason: Schema.optionalKey(PromotionReason),
  /** Its run's page, when GitHub said which run it started. */
  run: Schema.optionalKey(Schema.String),
})

/** A promotion was submitted to App Store review. */
export const PromotionSubmitted = Schema.TaggedStruct("promotion.submitted", {
  promotion: PromotionId,
  release: ReleaseVersion,
  environment: EnvironmentKey,
  appStore: Schema.String,
})

/** A member released a promotion App Store review approved, which waited for them. */
export const PromotionReleased = Schema.TaggedStruct("promotion.released", {
  promotion: PromotionId,
  release: ReleaseVersion,
  environment: EnvironmentKey,
})

/** A promotion ended, or stopped being followed: how it ended. */
export const PromotionEnded = Schema.TaggedStruct("promotion.ended", {
  promotion: PromotionId,
  release: ReleaseVersion,
  environment: EnvironmentKey,
  state: PromotionState,
  run: Schema.optionalKey(Schema.String),
})

/** A member set a component's version: the version its next builds are numbered in. */
export const VersionSet = Schema.TaggedStruct("version.set", {
  version: SemanticVersion,
  firstBuild: Schema.optionalKey(BuildNumber),
})

/** A component's CI had a commit numbered: the release it is, for good. */
export const ReleaseNumbered = Schema.TaggedStruct("release.numbered", { release: ReleaseVersion, commit: CommitSha })

/** A member saved a release's notes, in these languages. */
export const ReleaseNotesSaved = Schema.TaggedStruct("release_notes.saved", {
  release: ReleaseVersion,
  locales: Schema.Array(Schema.String),
})

/** A member set how the project's release notes read. */
export const NotesStyleSet = Schema.TaggedStruct("notes_style.set", { style: Schema.String })

/**
 * A member set a component's version policy: releases below `minimum` must update, those below
 * `recommended` are offered it, at `storeUrl`.
 */
export const VersionPolicySet = Schema.TaggedStruct("version_policy.set", {
  minimum: Schema.optionalKey(StoreVersion),
  recommended: Schema.optionalKey(StoreVersion),
  storeUrl: Schema.String,
})

/** A member removed a component's version policy: its releases are no longer asked to update. */
export const VersionPolicyCleared = Schema.TaggedStruct("version_policy.cleared", {})
