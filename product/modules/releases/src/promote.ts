import type { AppStoreConnect } from "@bagatka/app-store-connect"
import type { WorkflowRun } from "@bagatka/github"
import { GitHub } from "@bagatka/github"
import type { Actor } from "@cluenori/foundation"
import { ActivityLog, ProcessName, Source } from "@cluenori/foundation"
import type { DeployTarget } from "@cluenori/projects"
import { Projects } from "@cluenori/projects"
import { Crypto, DateTime, Duration, Effect, Option } from "effect"

import { knownRelease, knownReleases } from "./catalog.ts"
import { stageOf } from "./identity.ts"
import { numberCommit } from "./numbering.ts"
import type {
  AppStoreSubmission,
  PromoteRelease,
  Promotion,
  PromotionFix,
  PromotionRun,
  PromotionState,
} from "./promotion.ts"
import type { PromoteLatest, ReleaseApproved } from "./promotion.ts"
import {
  hasEnded,
  PromotionId,
  PromotionInProgress,
  PromotionNotFound,
  PromotionRefused,
  PromotionUnavailable,
} from "./promotion.ts"
import { ReleaseRecords } from "./records.ts"
import { PromotionEnded, PromotionReleased, PromotionStarted, PromotionSubmitted } from "./releases-activity.ts"
import { ReleaseSources } from "./sources.ts"

const source = Source.make("module:releases")

// Who follows promotions on GitHub and App Store Connect, and records how they end.
const follower: Actor = { _tag: "System", process: ProcessName.make("releases.promotions") }

// A promotion whose run isn't found this long after it started is lost, as is one that hasn't
// ended within a day; an App Store review is followed for 30 days.
const runFoundWithin = Duration.minutes(10)
const endsWithin = Duration.days(1)
const reviewedWithin = Duration.days(30)
// Each run of the background work follows at most this many promotions, the oldest first.
const followedPerRun = 10

// How an App Store promotion is submitted unless the member says otherwise.
const defaultSubmission: AppStoreSubmission = { releaseType: "afterApproval", phased: true }

// A refusal, in the words of whoever fixes it, and where they do.
const refusedBy = (fix: PromotionFix, reason: string) => new PromotionRefused({ reason, fix })

// The version and build number of a release, `0.6.0+2`: an app's build is that version and number.
const buildOf = (release: string) => {
  const [version = release, number = ""] = release.split("+")
  return { version, number }
}

/**
 * Promotes `request.release` of `request.component` to `request.environment`, by its deploy target
 * there, for `actor`, with `promotion.started`:
 * - when the target has a workflow, starts it on its repository's default branch with the inputs
 *   `release`, `environment`, `commit` (when the release's commit is known) and `runner`;
 * - when it has an App Store Connect app, follows its build there afterwards, and, for the App
 *   Store, submits it with the release's notes as What's New.
 * The background work follows it from there. Asks GitHub twice when it starts a workflow.
 *
 * Fails with `ReleaseNotFound` for a release the module doesn't know, `PromotionInProgress` while
 * the component's last promotion to that environment hasn't ended, `PromotionRefused` when it can't
 * start until someone fixes what it says (no target, no notes for the App Store, no App Manager
 * key), and `PromotionUnavailable` when GitHub didn't answer; nothing starts or is recorded then.
 * Not idempotent: each call that succeeds starts a run.
 */
export const promote = Effect.fn("Releases.promote")(function* (actor: Actor, request: PromoteRelease) {
  const projects = yield* Projects
  const records = yield* ReleaseRecords
  const sources = yield* ReleaseSources
  yield* knownRelease(yield* knownReleases, { component: request.component, release: request.release })
  const components = yield* projects.components.pipe(Effect.catchTag("ProjectNotFound", () => Effect.succeed([])))
  const component = components.find((each) => each.key === request.component)
  const target = component?.deployTargets?.find((each) => each.environment === request.environment)
  if (component === undefined || target === undefined) {
    return yield* refusedBy(
      "links",
      `${request.component} has no deploy target for ${request.environment}: link the workflow that deploys it there, or the App Store app its builds go to.`,
    )
  }
  const repository = component.repository
  if (target.workflow !== undefined && repository === undefined) {
    return yield* refusedBy(
      "links",
      `${request.component} isn't linked to a repository on GitHub, where ${target.workflow} runs: link it.`,
    )
  }
  const toAppStore = target.appStore?.distribution === "appStore"
  if (target.appStore !== undefined && Option.isNone(sources.appStoreConnectManager)) {
    return yield* refusedBy(
      "appStore",
      "Cluenori has no App Store Connect key that may submit builds: give it an App Manager key with ./cluenori appstore setup <key.p8> --issuer <issuer ID> --manager.",
    )
  }
  if (toAppStore && (yield* records.notes(request.component, request.release)).length === 0) {
    const shipped = (yield* records.storeBuilds(request.component)).some(
      (stored) =>
        stored.environment === request.environment &&
        (stored.build.stage === "live" || stored.build.stage === "releasing" || stored.build.stage === "replaced"),
    )
    // An app's first version has no What's New; every later one needs its notes.
    if (shipped) {
      return yield* refusedBy(
        "notes",
        `${request.release} has no release notes yet: write them, or draft them with AI, before it goes to App Store review.`,
      )
    }
  }
  const [running] = yield* records.unendedPromotions({ component: request.component, environment: request.environment })
  if (running !== undefined) {
    return yield* new PromotionInProgress({ promotion: running })
  }
  const runner = request.runner ?? "auto"
  const commit = (yield* records.commits(request.component)).get(request.release)?.sha
  const run =
    target.workflow === undefined || repository === undefined
      ? undefined
      : Option.getOrUndefined(yield* startWorkflow(repository, target.workflow, request, commit, runner))
  const crypto = yield* Crypto.Crypto
  const id = PromotionId.make(yield* crypto.randomUUIDv7().pipe(Effect.orDie))
  const now = yield* DateTime.now
  const promotion: Promotion = {
    id,
    component: request.component,
    release: request.release,
    environment: request.environment,
    ...(target.workflow === undefined || repository === undefined
      ? {}
      : { repository, workflow: target.workflow, runner }),
    ...(target.appStore === undefined ? {} : { appStore: target.appStore }),
    ...(toAppStore ? { submission: request.submission ?? defaultSubmission } : {}),
    ...(actor._tag === "Member" ? { startedBy: actor.id } : {}),
    ...(request.reason === undefined ? {} : { reason: request.reason }),
    startedAt: now,
    // Without a workflow, the build is in its app already, or on its way there.
    state: target.workflow === undefined ? "processing" : "starting",
    ...(run === undefined ? {} : { run }),
  }
  const log = yield* ActivityLog
  yield* log.commit({
    source,
    actor,
    write: records.startPromotion(promotion, actor),
    activity: () => [
      {
        payload: PromotionStarted.make({
          promotion: id,
          release: promotion.release,
          environment: promotion.environment,
          ...(promotion.repository === undefined ? {} : { repository: promotion.repository }),
          ...(promotion.workflow === undefined ? {} : { workflow: promotion.workflow }),
          ...(promotion.appStore === undefined ? {} : { appStore: promotion.appStore.bundleId }),
          ...(promotion.reason === undefined ? {} : { reason: promotion.reason }),
          ...(run === undefined ? {} : { run: run.url }),
        }),
        component: promotion.component,
        environment: promotion.environment,
        release: promotion.release,
      },
    ],
  })
  return promotion
})

/**
 * Promotes a commit of `request.component` that has no release yet, such as an app's newest commit
 * on its repository's default branch: numbers it, as its CI would, with `release.numbered`, then
 * promotes that release as `promote` does. Without `request.commit`, the default branch's latest,
 * which GitHub is asked for. A commit numbered before is that release again.
 *
 * Fails as `promote` does, and with `PromotionRefused` (fix `version`) until the component's version
 * is set, or (fix `repository`) for a commit its repository doesn't have.
 */
export const promoteLatest = Effect.fn("Releases.promoteLatest")(function* (actor: Actor, request: PromoteLatest) {
  const projects = yield* Projects
  const components = yield* projects.components.pipe(Effect.catchTag("ProjectNotFound", () => Effect.succeed([])))
  const repository = components.find((each) => each.key === request.component)?.repository
  if (repository === undefined) {
    return yield* refusedBy("links", `${request.component} isn't linked to a repository on GitHub: link it.`)
  }
  const github = yield* GitHub
  const commit = yield* Effect.gen(function* () {
    const ref = request.commit ?? (yield* github.defaultBranch(repository))
    const found = yield* github.commit(repository, ref)
    if (Option.isNone(found)) {
      return yield* refusedBy("repository", `${repository} has no commit ${ref}.`)
    }
    return found.value.sha
  }).pipe(
    Effect.catchTags({
      GitHubRefused: (refused) => Effect.fail(refusedBy("github", refused.reason)),
      GitHubUnavailable: (unavailable) => Effect.fail(new PromotionUnavailable({ reason: unavailable.reason })),
    }),
  )
  const numbered = yield* numberCommit(request.component, { commit }).pipe(
    Effect.catchTag("VersionNotSet", () =>
      Effect.fail(
        refusedBy(
          "version",
          `${request.component} has no version yet, so its commits can't be numbered: set it, such as 1.0.0.`,
        ),
      ),
    ),
  )
  return yield* promote(actor, {
    component: request.component,
    release: numbered.release,
    environment: request.environment,
    ...(request.reason === undefined ? {} : { reason: request.reason }),
    ...(request.runner === undefined ? {} : { runner: request.runner }),
    ...(request.submission === undefined ? {} : { submission: request.submission }),
  })
})

// Starts a target's workflow with a promotion's inputs: the run GitHub named, if it did.
const startWorkflow = Effect.fn("Releases.startWorkflow")(function* (
  repository: NonNullable<Promotion["repository"]>,
  workflow: NonNullable<DeployTarget["workflow"]>,
  request: PromoteRelease,
  commit: string | undefined,
  runner: string,
) {
  const github = yield* GitHub
  return yield* github.defaultBranch(repository).pipe(
    Effect.flatMap((branch) =>
      github
        .dispatchWorkflow(repository, workflow, branch, {
          release: request.release,
          environment: request.environment,
          ...(commit === undefined ? {} : { commit }),
          runner,
        })
        .pipe(
          Effect.catchTags({
            WorkflowNotFound: () =>
              Effect.fail(
                refusedBy(
                  "repository",
                  `${repository} has no workflow ${workflow} on its default branch, ${branch}: add it there, or link the file that deploys it.`,
                ),
              ),
            WorkflowRejected: (rejected) =>
              Effect.fail(
                refusedBy(
                  "repository",
                  `GitHub didn't start ${workflow}: ${rejected.reason}. It starts on workflow_dispatch, with the inputs release, environment, commit and runner.`,
                ),
              ),
          }),
        ),
    ),
    Effect.catchTags({
      GitHubRefused: (refused) => Effect.fail(refusedBy("github", refused.reason)),
      // Not handled: GitHub may have started the run before it stopped answering, so asking again
      // may start a second; telling takes recording the promotion anyway and finding its run.
      GitHubUnavailable: (unavailable) => Effect.fail(new PromotionUnavailable({ reason: unavailable.reason })),
    }),
  )
})

/**
 * Releases an App Store promotion that is `approved` and waiting for a member, with the manual
 * release type, with `promotion.released` for `actor`: it is `releasing` at once, and App Store
 * Connect makes it live; the background work sees it go live and ends the promotion. Fails with `PromotionNotFound` for no promotion of that ID waiting so,
 * `PromotionRefused` when App Store Connect refuses or has no App Manager key, and
 * `PromotionUnavailable` when it doesn't answer.
 */
export const releaseApproved = Effect.fn("Releases.releaseApproved")(function* (
  actor: Actor,
  request: ReleaseApproved,
) {
  const records = yield* ReleaseRecords
  const sources = yield* ReleaseSources
  const promotion = (yield* records.unendedPromotions()).find((each) => each.id === request.promotion)
  if (promotion === undefined || promotion.state !== "approved" || promotion.storeVersionId === undefined) {
    return yield* new PromotionNotFound({ promotion: request.promotion })
  }
  if (Option.isNone(sources.appStoreConnectManager)) {
    return yield* refusedBy("appStore", "Cluenori has no App Store Connect key that may release builds.")
  }
  yield* sources.appStoreConnectManager.value.releaseVersion(promotion.storeVersionId).pipe(
    Effect.catchTags({
      AppStoreConnectRefused: (refused) => Effect.fail(refusedBy("appStore", refused.reason)),
      AppStoreConnectUnavailable: (unavailable) =>
        Effect.fail(new PromotionUnavailable({ reason: unavailable.reason })),
    }),
  )
  const releasing: Promotion = { ...promotion, state: "releasing" }
  const log = yield* ActivityLog
  yield* log.commit({
    source,
    actor,
    write: records.updatePromotion(releasing),
    activity: () => [
      {
        payload: PromotionReleased.make({
          promotion: releasing.id,
          release: releasing.release,
          environment: releasing.environment,
        }),
        component: releasing.component,
        environment: releasing.environment,
        release: releasing.release,
      },
    ],
  })
  return releasing
})

// A run's state in a promotion's terms.
const stateOf = (run: WorkflowRun): PromotionState => {
  switch (run.status) {
    case "completed":
      return endedAs(run.conclusion)
    case "failure":
    case "startup_failure":
      return "failed"
    case "in_progress":
      return "running"
    case "waiting":
      return "waiting"
    case "requested":
    case "queued":
    case "pending":
    case "expected":
      return "queued"
  }
}

// How a completed run ended, in a promotion's terms, from GitHub's conclusion.
const endedAs = (conclusion: string | undefined): PromotionState => {
  if (conclusion === "success" || conclusion === "neutral") {
    return "succeeded"
  }
  return conclusion === "cancelled" || conclusion === "skipped" || conclusion === "stale" ? "cancelled" : "failed"
}

// The run a promotion started, when GitHub didn't say: the first of its workflow's runs on
// workflow_dispatch created since it started that no other promotion claims.
const findRun = Effect.fn("Releases.findRun")(function* (
  github: GitHub["Service"],
  promotion: Promotion,
  claimed: ReadonlySet<number>,
) {
  if (promotion.repository === undefined || promotion.workflow === undefined) {
    return Option.none<WorkflowRun>()
  }
  // GitHub's clock and ours may differ by a few seconds.
  const since = DateTime.subtract(promotion.startedAt, { seconds: 30 })
  const runs = yield* github.workflowRuns(promotion.repository, promotion.workflow, {
    createdSince: since,
    event: "workflow_dispatch",
  })
  return Option.fromNullishOr(
    runs
      .toSorted((a, b) => DateTime.toEpochMillis(a.createdAt) - DateTime.toEpochMillis(b.createdAt))
      .find((run) => !claimed.has(run.id) && !DateTime.isLessThan(run.createdAt, since)),
  )
})

// What GitHub says of a promotion's run now: its state, or lost. A run that ended well goes on to
// the store when the promotion has an app.
const followedRun = Effect.fn("Releases.followedRun")(function* (
  github: GitHub["Service"],
  promotion: Promotion,
  claimed: ReadonlySet<number>,
  now: DateTime.Utc,
) {
  const age = DateTime.distance(promotion.startedAt, now)
  const known = promotion.run
  const run =
    known === undefined || promotion.repository === undefined
      ? yield* findRun(github, promotion, claimed)
      : yield* github.workflowRun(promotion.repository, known.id)
  if (Option.isNone(run)) {
    const lost = known !== undefined || !Duration.isLessThan(age, runFoundWithin)
    return lost ? { ...promotion, state: "lost" as const, endedAt: now } : promotion
  }
  const found: PromotionRun = { id: run.value.id, url: run.value.url }
  const state = stateOf(run.value)
  if (state === "succeeded" && promotion.appStore !== undefined) {
    return { ...promotion, run: found, state: "processing" as const }
  }
  return hasEnded(state)
    ? { ...promotion, run: found, state, endedAt: run.value.updatedAt }
    : { ...promotion, run: found, state }
})

// What App Store Connect says of a promotion's build now: processed, then, for the App Store,
// submitted with its notes and followed through review.
const followedStore = Effect.fn("Releases.followedStore")(function* (
  reader: AppStoreConnect["Service"],
  writer: AppStoreConnect["Service"],
  promotion: Promotion,
  now: DateTime.Utc,
) {
  const records = yield* ReleaseRecords
  const target = promotion.appStore
  if (target === undefined) {
    return promotion
  }
  const app = yield* reader.app(target.bundleId)
  if (Option.isNone(app)) {
    return { ...promotion, state: "failed" as const, endedAt: now }
  }
  const { version, number } = buildOf(promotion.release)
  if (promotion.state === "processing") {
    const build = yield* reader.build(app.value.id, version, number)
    if (Option.isNone(build) || build.value.processingState === "PROCESSING") {
      return promotion
    }
    if (build.value.processingState !== "VALID") {
      return { ...promotion, state: "failed" as const, endedAt: now }
    }
    const notes = yield* records.notes(promotion.component, promotion.release)
    if (target.distribution === "testFlight") {
      if (notes.length > 0) {
        yield* writer.setWhatToTest(build.value.id, notes)
      }
      return { ...promotion, state: "succeeded" as const, endedAt: now }
    }
    const submission = promotion.submission ?? defaultSubmission
    const prepared = yield* writer.prepareVersion(app.value.id, {
      version,
      buildId: build.value.id,
      releaseType: submission.releaseType,
      phased: submission.phased,
      whatsNew: notes,
    })
    yield* writer.submitForReview(app.value.id, prepared.versionId)
    return { ...promotion, state: "inReview" as const, storeVersionId: prepared.versionId }
  }
  // In review, or approved and waiting: the version's state says where it is now.
  const versions = yield* reader.appStoreVersions(app.value.id, 20)
  const shipping = versions.find((each) => each.version === version)
  const build = yield* reader.build(app.value.id, version, number)
  if (Option.isNone(build)) {
    return promotion
  }
  switch (stageOf(build.value, shipping)) {
    case "live":
    case "releasing":
      return { ...promotion, state: "succeeded" as const, endedAt: now }
    case "pendingRelease":
      // Once a member released it, it stays releasing until App Store Connect shows it live.
      return shipping?.state === "PENDING_DEVELOPER_RELEASE" && promotion.state !== "releasing"
        ? { ...promotion, state: "approved" as const }
        : promotion
    case "rejected":
      return { ...promotion, state: "rejected" as const, endedAt: now }
    // A newer version went in its place: this one won't go live.
    case "replaced":
      return { ...promotion, state: "cancelled" as const, endedAt: now }
    // Still on its way through review, or nothing the version says yet.
    case "waitingForReview":
    case "inReview":
    case "processing":
    case "testing":
    case "failed":
    case "expired":
    case "other":
      return promotion
  }
})

// What GitHub, or App Store Connect once its build is there, says of a promotion now; the
// promotion as it was when either refuses or doesn't answer, or App Store Connect isn't set up.
const followed = Effect.fn("Releases.followed")(function* (
  promotion: Promotion,
  claimed: ReadonlySet<number>,
  now: DateTime.Utc,
) {
  const inStore =
    promotion.state === "processing" ||
    promotion.state === "inReview" ||
    promotion.state === "approved" ||
    promotion.state === "releasing"
  if (!inStore) {
    const github = yield* GitHub
    return yield* followedRun(github, promotion, claimed, now).pipe(
      Effect.catchTags({
        GitHubRefused: (refused) =>
          Effect.logWarning("GitHub refused following a promotion", {
            promotion: promotion.id,
            reason: refused.reason,
          }).pipe(Effect.as(promotion)),
        GitHubUnavailable: (unavailable) =>
          Effect.logWarning("GitHub didn't answer about a promotion", {
            promotion: promotion.id,
            reason: unavailable.reason,
          }).pipe(Effect.as(promotion)),
        // Its workflow was removed or renamed since: its runs can't be found any more.
        WorkflowNotFound: () => Effect.succeed<Promotion>({ ...promotion, state: "lost", endedAt: now }),
      }),
    )
  }
  const sources = yield* ReleaseSources
  if (Option.isNone(sources.appStoreConnect) || Option.isNone(sources.appStoreConnectManager)) {
    return promotion
  }
  return yield* followedStore(sources.appStoreConnect.value, sources.appStoreConnectManager.value, promotion, now).pipe(
    Effect.catchTags({
      AppStoreConnectRefused: (refused) =>
        Effect.logWarning("App Store Connect refused following a promotion", {
          promotion: promotion.id,
          reason: refused.reason,
        }).pipe(Effect.as(promotion)),
      AppStoreConnectUnavailable: (unavailable) =>
        Effect.logWarning("App Store Connect didn't answer about a promotion", {
          promotion: promotion.id,
          reason: unavailable.reason,
        }).pipe(Effect.as(promotion)),
    }),
  )
})

/**
 * Follows the promotions that haven't ended, at most 10 a run, the oldest first: asks GitHub about
 * each one's run, then App Store Connect about its build, submitting it for the App Store once
 * processed; records what changed, `promotion.submitted` when submitted, and `promotion.ended` once
 * it ends. A promotion GitHub or App Store Connect refuses or doesn't answer about is tried again
 * the next minute, until it is lost: a day for a run or a build, 30 days for a review.
 */
export const followPromotions = Effect.gen(function* () {
  const records = yield* ReleaseRecords
  const unended = yield* records.unendedPromotions()
  if (unended.length === 0) {
    return
  }
  const log = yield* ActivityLog
  const now = yield* DateTime.now
  const claimed = new Set(unended.flatMap((promotion) => (promotion.run === undefined ? [] : [promotion.run.id])))
  for (const promotion of unended.slice(0, followedPerRun)) {
    const asked = yield* followed(promotion, claimed, now)
    // One that hasn't ended in time, as GitHub or App Store Connect tell or not, stops being followed.
    const allowed =
      asked.state === "inReview" || asked.state === "approved" || asked.state === "releasing"
        ? reviewedWithin
        : endsWithin
    const next: Promotion =
      asked.endedAt === undefined && !Duration.isLessThan(DateTime.distance(promotion.startedAt, now), allowed)
        ? { ...asked, state: "lost", endedAt: now }
        : asked
    if (next.run !== undefined) {
      claimed.add(next.run.id)
    }
    if (next.state === promotion.state && next.run?.id === promotion.run?.id) {
      continue
    }
    const submitted = next.state === "inReview" && promotion.state === "processing"
    if (next.endedAt === undefined && !submitted) {
      yield* records.updatePromotion(next)
      continue
    }
    yield* log.commit({
      source,
      actor: follower,
      write: records.updatePromotion(next),
      activity: () => [
        {
          payload:
            next.endedAt === undefined
              ? PromotionSubmitted.make({
                  promotion: next.id,
                  release: next.release,
                  environment: next.environment,
                  appStore: next.appStore?.bundleId ?? "",
                })
              : PromotionEnded.make({
                  promotion: next.id,
                  release: next.release,
                  environment: next.environment,
                  state: next.state,
                  ...(next.run === undefined ? {} : { run: next.run.url }),
                }),
          component: next.component,
          environment: next.environment,
          release: next.release,
        },
      ],
    })
  }
})
