import { CommitSha, Repository, WorkflowFile } from "@bagatka/github"
import { ComponentKey, EnvironmentKey, Instant, MemberId, ReleaseVersion, Uuidv7 } from "@cluenori/foundation"
import { AppStoreTarget } from "@cluenori/projects"
import { Schema } from "effect"

/** A promotion's ID: a UUIDv7, so IDs sort by when promotions started. */
export const PromotionId = Uuidv7.pipe(Schema.brand("PromotionId"))
export type PromotionId = typeof PromotionId.Type

/**
 * Where a promotion stands: its workflow's run on GitHub, then, for an app, its build in App Store
 * Connect:
 * - `starting`: GitHub took the request, and its run isn't known yet.
 * - `queued`: the run waits for a runner.
 * - `waiting`: the run waits for someone to approve its environment on GitHub.
 * - `running`: the run is running.
 * - `processing`: the run ended well, and App Store Connect has yet to list the build as processed.
 * - `inReview`: submitted, waiting for App Store review or in it.
 * - `approved`: approved, to be released by a member (`releaseApproved`).
 * - `releasing`: a member released it; App Store Connect has yet to show it live.
 * - `succeeded`: deployed; for an app, processed in TestFlight, or live on the App Store.
 * - `failed`, `cancelled`: the run ended so, or the build failed processing.
 * - `rejected`: App Store review rejected it.
 * - `lost`: no run was found within 10 minutes, it was deleted, or it didn't end within a day, or
 *   its build didn't show within a day; GitHub and App Store Connect have the rest.
 */
export const PromotionState = Schema.Literals([
  "starting",
  "queued",
  "waiting",
  "running",
  "processing",
  "inReview",
  "approved",
  "releasing",
  "succeeded",
  "failed",
  "cancelled",
  "rejected",
  "lost",
]).annotate({ identifier: "PromotionState" })
export type PromotionState = typeof PromotionState.Type

/** Whether a promotion in `state` has ended, and is no longer followed. */
export const hasEnded = (state: PromotionState) =>
  state === "succeeded" || state === "failed" || state === "cancelled" || state === "rejected" || state === "lost"

/**
 * Where a promotion's workflow runs, as its `runner` input: `local` is the founder's own machine,
 * a self-hosted runner; `cloud` is the hosted one the repository chose; `auto` takes `local` when
 * it is online, else `cloud`. The workflow maps it to its jobs' `runs-on`.
 */
export const Runner = Schema.Literals(["auto", "local", "cloud"]).annotate({ identifier: "Runner" })
export type Runner = typeof Runner.Type

/** When an app approved in review goes live: as soon as approved, or when a member releases it. */
export const AppStoreReleaseType = Schema.Literals(["afterApproval", "manual"]).annotate({
  identifier: "AppStoreReleaseType",
})
export type AppStoreReleaseType = typeof AppStoreReleaseType.Type

/** How a promotion to the App Store is submitted: when it goes live, and whether over 7 days. */
export const AppStoreSubmission = Schema.Struct({ releaseType: AppStoreReleaseType, phased: Schema.Boolean }).annotate({
  identifier: "AppStoreSubmission",
})
export type AppStoreSubmission = typeof AppStoreSubmission.Type

/** A workflow's run on GitHub: its ID, and its page. */
export const PromotionRun = Schema.Struct({ id: Schema.Int, url: Schema.String }).annotate({
  identifier: "PromotionRun",
})
export type PromotionRun = typeof PromotionRun.Type

/** Why a release is promoted, in a person's words: 1 to 500 characters. */
export const PromotionReason = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(500),
  Schema.isTrimmed(),
).pipe(Schema.brand("PromotionReason"))
export type PromotionReason = typeof PromotionReason.Type

/**
 * A release deployed to an environment from Cluenori, by the component's deploy target there: its
 * workflow, started in its repository with the inputs `release`, `environment`, `commit` and
 * `runner`, and followed until its run ends; then, for an app, its build in the target's App Store
 * Connect app, processed, and for the App Store, submitted and followed through review.
 */
export const Promotion = Schema.Struct({
  id: PromotionId,
  component: ComponentKey,
  release: ReleaseVersion,
  environment: EnvironmentKey,
  /** Its workflow and the repository it ran in; absent when the target has none. */
  repository: Schema.optionalKey(Repository),
  workflow: Schema.optionalKey(WorkflowFile),
  runner: Schema.optionalKey(Runner),
  /** The App Store Connect app its build went to, when the target has one. */
  appStore: Schema.optionalKey(AppStoreTarget),
  /** How it was submitted, for the App Store. */
  submission: Schema.optionalKey(AppStoreSubmission),
  /** The member who started it; absent for an agent or a process. */
  startedBy: Schema.optionalKey(MemberId),
  reason: Schema.optionalKey(PromotionReason),
  startedAt: Instant,
  state: PromotionState,
  /** Its workflow's run, once known. */
  run: Schema.optionalKey(PromotionRun),
  /** When it was seen to end. */
  endedAt: Schema.optionalKey(Instant),
  /** App Store Connect's version it was submitted as, once it was. */
  storeVersionId: Schema.optionalKey(Schema.String),
}).annotate({ identifier: "Promotion" })
export type Promotion = typeof Promotion.Type

/**
 * Promote `release` of `component` to `environment`, and why; its workflow running on `runner`
 * (`auto` unless given), and, for the App Store, submitted so (as soon as approved, phased, unless
 * given).
 */
export const PromoteRelease = Schema.Struct({
  component: ComponentKey,
  release: ReleaseVersion,
  environment: EnvironmentKey,
  reason: Schema.optionalKey(PromotionReason),
  runner: Schema.optionalKey(Runner),
  submission: Schema.optionalKey(AppStoreSubmission),
}).annotate({ identifier: "PromoteRelease" })
export type PromoteRelease = typeof PromoteRelease.Type

/**
 * Promote a commit that has no release yet, numbered first: `commit`, or the newest on the
 * repository's default branch; the rest as `PromoteRelease`.
 */
export const PromoteLatest = Schema.Struct({
  component: ComponentKey,
  environment: EnvironmentKey,
  commit: Schema.optionalKey(CommitSha),
  reason: Schema.optionalKey(PromotionReason),
  runner: Schema.optionalKey(Runner),
  submission: Schema.optionalKey(AppStoreSubmission),
}).annotate({ identifier: "PromoteLatest" })
export type PromoteLatest = typeof PromoteLatest.Type

/**
 * Where what stops a promotion is fixed:
 * - `github`: Cluenori's GitHub App, on the web's GitHub page: connect it, install it on the
 *   repository's account, or let it reach the repository.
 * - `links`: the component's links: its repository, or its deploy workflow for the environment.
 * - `repository`: the workflow itself, in the repository: add it to the default branch, or let it
 *   start on `workflow_dispatch` with the inputs `release`, `environment`, `commit` and `runner`.
 * - `notes`: the release's notes: write them for each of the app's languages before it goes to App
 *   Store review.
 * - `appStore`: App Store Connect: give the deployment an App Manager key, or fix what it refused.
 * - `version`: the component's version: set it, so its commits can be numbered.
 */
export const PromotionFix = Schema.Literals(["github", "links", "repository", "notes", "appStore", "version"]).annotate(
  {
    identifier: "PromotionFix",
  },
)
export type PromotionFix = typeof PromotionFix.Type

/**
 * The promotion can't start until someone fixes what `reason` says, where `fix` says: the component
 * has no repository or no deploy workflow for the environment, Cluenori isn't connected to GitHub or
 * installed on the repository, or GitHub refused the workflow, such as one that doesn't take the
 * inputs `release` and `environment`.
 */
export class PromotionRefused extends Schema.TaggedError<PromotionRefused>()("PromotionRefused", {
  reason: Schema.String,
  fix: PromotionFix,
}) {}

/** Release a promotion App Store review approved, which waits for a member. */
export const ReleaseApproved = Schema.Struct({ promotion: PromotionId }).annotate({ identifier: "ReleaseApproved" })
export type ReleaseApproved = typeof ReleaseApproved.Type

/** No promotion of this ID is approved and waiting to be released. */
export class PromotionNotFound extends Schema.TaggedError<PromotionNotFound>()("PromotionNotFound", {
  promotion: PromotionId,
}) {}

/** GitHub didn't answer, so nothing started: try again. */
export class PromotionUnavailable extends Schema.TaggedError<PromotionUnavailable>()("PromotionUnavailable", {
  reason: Schema.String,
}) {}

/** The component is being promoted to that environment already, by `promotion`: wait for it to end. */
export class PromotionInProgress extends Schema.TaggedError<PromotionInProgress>()("PromotionInProgress", {
  promotion: Promotion,
}) {}
