import { ComponentKey, EnvironmentKey, Instant, ReleaseVersion } from "@cluenori/foundation"
import { DeployTarget } from "@cluenori/projects"
import { Schema } from "effect"

import { Promotion } from "./promotion.ts"
import { ReleaseSummary } from "./release.ts"
import { ComponentVersion } from "./version.ts"

/**
 * What can go to an environment next: `promote`, the release in the environment before it, when that
 * one is newer than the release there; `buildLatest`, to the first, the default branch's newest
 * commit, numbered as the next release.
 */
export const NextStep = Schema.Union([
  Schema.TaggedStruct("promote", { release: ReleaseVersion, from: EnvironmentKey }).annotate({
    identifier: "PromoteNext",
  }),
  Schema.TaggedStruct("buildLatest", {}).annotate({ identifier: "BuildLatestNext" }),
]).annotate({ identifier: "NextStep" })
export type NextStep = typeof NextStep.Type

/** The release in an environment now, and since when: when it reached there. */
export const CurrentRelease = Schema.Struct({ summary: ReleaseSummary, since: Instant }).annotate({
  identifier: "CurrentRelease",
})
export type CurrentRelease = typeof CurrentRelease.Type

/**
 * One of a component's environments: how its releases get there, the release there now, a promotion
 * to it that hasn't ended, and what can go there next. While a promotion to it hasn't ended, nothing
 * can go there next.
 */
export const EnvironmentDelivery = Schema.Struct({
  environment: EnvironmentKey,
  /** Its deploy target; absent for an environment the component ran in without one. */
  target: Schema.optionalKey(DeployTarget),
  /** Absent until a release reaches it. */
  current: Schema.optionalKey(CurrentRelease),
  promotion: Schema.optionalKey(Promotion),
  /**
   * The latest promotion to it, when it ended without its release getting there (failed, cancelled,
   * rejected in review, or lost) and nothing reached it since it started: what to look at or try
   * again.
   */
  failedPromotion: Schema.optionalKey(Promotion),
  next: Schema.optionalKey(NextStep),
}).annotate({ identifier: "EnvironmentDelivery" })
export type EnvironmentDelivery = typeof EnvironmentDelivery.Type

/**
 * How a component's releases reach its environments: those of its deploy targets, in their order; for
 * one without deploy targets, the environments it ran or was deployed in, by name, with nothing to
 * do; and its version, once set, which its next builds are numbered in.
 */
export const ComponentDelivery = Schema.Struct({
  component: ComponentKey,
  /** The component whose deploys deploy this one too: it has nothing to do of its own. */
  shipsWith: Schema.optionalKey(ComponentKey),
  version: Schema.optionalKey(ComponentVersion),
  environments: Schema.Array(EnvironmentDelivery),
}).annotate({ identifier: "ComponentDelivery" })
export type ComponentDelivery = typeof ComponentDelivery.Type

/** Each of the project's components' delivery, in the project's order. */
export const Delivery = Schema.Struct({ components: Schema.Array(ComponentDelivery) }).annotate({
  identifier: "Delivery",
})
export type Delivery = typeof Delivery.Type
