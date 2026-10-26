import { ComponentKey, EnvelopeName, EnvironmentKey, Instant, Period, ReleaseVersion } from "@cluenori/foundation"
import { CommitSha, Repository } from "@cluenori/github"
import { Incident } from "@cluenori/incidents"
import { DeployTarget } from "@cluenori/projects"
import { ErrorGroup } from "@cluenori/signals"
import { Schema } from "effect"

import { ReleaseNote } from "./note.ts"
import { Promotion } from "./promotion.ts"

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const Milliseconds = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))

/**
 * How a release compares with the one before it, of the same component and environment:
 * - `worse`: an operation got slower or fails more, or an error was first seen in it.
 * - `better`: nothing worse, and an operation got faster or fails less.
 * - `same`: nothing moved enough to tell.
 * - `tooEarly`: nothing worse yet, but it ran less than an hour, or no operation ran 100 times in
 *   both releases.
 * - `first`: no release before it to compare with.
 * - `unmeasured`: no telemetry from it yet, as for a build only App Store Connect knows, or a deploy
 *   just reported.
 */
export const Verdict = Schema.Literals(["worse", "better", "same", "tooEarly", "first", "unmeasured"]).annotate({
  identifier: "Verdict",
})
export type Verdict = typeof Verdict.Type

/**
 * A release's commit in its component's repository, and the tag that names it when one does. A
 * commit only a deploy report named has what the report said; one found on GitHub has the rest.
 */
export const ReleaseCommit = Schema.Struct({
  sha: CommitSha,
  tag: Schema.optionalKey(Schema.String),
  /** The first line of its message. */
  message: Schema.optionalKey(Schema.String),
  author: Schema.optionalKey(Schema.String),
  committedAt: Schema.optionalKey(Instant),
  /** Its page on GitHub. */
  url: Schema.optionalKey(Schema.String),
}).annotate({ identifier: "ReleaseCommit" })
export type ReleaseCommit = typeof ReleaseCommit.Type

/** One commit between two releases, with the pull request it came from when its message names one. */
export const ChangedCommit = Schema.Struct({
  sha: CommitSha,
  message: Schema.String,
  author: Schema.String,
  committedAt: Instant,
  /** Its page on GitHub; absent for commits only a deploy report listed. */
  url: Schema.optionalKey(Schema.String),
  pullRequest: Schema.optionalKey(Schema.Int),
}).annotate({ identifier: "ChangedCommit" })
export type ChangedCommit = typeof ChangedCommit.Type

/** A pull request merged between two releases. */
export const MergedPullRequest = Schema.Struct({
  number: Schema.Int,
  title: Schema.String,
  author: Schema.String,
  url: Schema.String,
  labels: Schema.Array(Schema.String),
}).annotate({ identifier: "MergedPullRequest" })
export type MergedPullRequest = typeof MergedPullRequest.Type

/**
 * What changed in the repository since the release before: its commits, the newest first, at most
 * 250; the pull requests they name, at most 30, read from GitHub; and, from GitHub, the files
 * changed. From a deploy report alone, the commits git listed and nothing GitHub knows.
 */
export const ReleaseChanges = Schema.Struct({
  totalCommits: Count,
  commits: Schema.Array(ChangedCommit),
  pullRequests: Schema.Array(MergedPullRequest),
  filesChanged: Schema.optionalKey(Count),
  additions: Schema.optionalKey(Count),
  deletions: Schema.optionalKey(Count),
  /** GitHub's page comparing the two. */
  url: Schema.optionalKey(Schema.String),
}).annotate({ identifier: "ReleaseChanges" })
export type ReleaseChanges = typeof ReleaseChanges.Type

/**
 * Where an app's build stands in App Store Connect:
 * - `processing`, `failed`: Apple is processing it, or it failed processing;
 * - `testing`: in TestFlight, with no App Store version shipping it;
 * - `waitingForReview`, `inReview`, `rejected`: in App Review;
 * - `pendingRelease`: approved, waiting to be released;
 * - `releasing`: in a phased release; `live`: on the App Store;
 * - `replaced`: a later version took its place; `expired`: its TestFlight build expired;
 * - `other`: a state this version doesn't know, given in `appStoreState`.
 */
export const StoreStage = Schema.Literals([
  "processing",
  "failed",
  "testing",
  "waitingForReview",
  "inReview",
  "rejected",
  "pendingRelease",
  "releasing",
  "live",
  "replaced",
  "expired",
  "other",
]).annotate({ identifier: "StoreStage" })
export type StoreStage = typeof StoreStage.Type

/** A phased release of an App Store version: Apple's state, when it began, and its day of 7. */
export const PhasedRelease = Schema.Struct({
  state: Schema.String,
  startedAt: Schema.optionalKey(Instant),
  day: Schema.optionalKey(Count),
}).annotate({ identifier: "PhasedRelease" })
export type PhasedRelease = typeof PhasedRelease.Type

/** An app's build in App Store Connect: its version and number, and where it stands. */
export const StoreBuild = Schema.Struct({
  version: Schema.String,
  buildNumber: Schema.String,
  uploadedAt: Instant,
  stage: StoreStage,
  /** Apple's word for the state of the App Store version that ships it, when one does. */
  appStoreState: Schema.optionalKey(Schema.String),
  /** Apple's words for its TestFlight state, for internal and external testers. */
  internalTesting: Schema.optionalKey(Schema.String),
  externalTesting: Schema.optionalKey(Schema.String),
  /** Its phased release, when its App Store version has one. */
  phasedRelease: Schema.optionalKey(PhasedRelease),
  /** When its App Store version may be released at the earliest, when one was set. */
  earliestReleaseAt: Schema.optionalKey(Instant),
}).annotate({ identifier: "StoreBuild" })
export type StoreBuild = typeof StoreBuild.Type

/**
 * One release of a component in one environment: when it ran and how much, as its operations show
 * it, and how it compares with the release before it; its commit and tag in the component's
 * repository; and, for an app, its build in App Store Connect. A release only the store knows has
 * no telemetry, so no times, counts, or environment.
 */
export const ReleaseSummary = Schema.Struct({
  component: ComponentKey,
  /** Absent when the component didn't say. */
  environment: Schema.optionalKey(EnvironmentKey),
  release: ReleaseVersion,
  /** The start of the first minute it ran in; absent without telemetry. */
  firstSeen: Schema.optionalKey(Instant),
  /** The end of the last minute it ran in; absent without telemetry. */
  lastSeen: Schema.optionalKey(Instant),
  /** How many operations it ran, and how many of them failed; absent without telemetry. */
  count: Schema.optionalKey(Count),
  errors: Schema.optionalKey(Count),
  /** The release before it; absent for the first. */
  previous: Schema.optionalKey(ReleaseVersion),
  verdict: Verdict,
  /** What the verdict counts: operations slower, operations failing more, and errors first seen in it. */
  slower: Count,
  failingMore: Count,
  newErrors: Count,
  /** Its commit, once found in the component's repository; absent until then, or without one linked. */
  commit: Schema.optionalKey(ReleaseCommit),
  /** Its build in App Store Connect, for an app linked to one. */
  store: Schema.optionalKey(StoreBuild),
  /** When a deploy of it was reported, by `cluenori-release` in the component's CI; absent without one. */
  deployedAt: Schema.optionalKey(Instant),
}).annotate({ identifier: "ReleaseSummary" })
export type ReleaseSummary = typeof ReleaseSummary.Type

/**
 * Which releases to list: those that ran in `period`, optionally of one environment or component.
 * A release that names no environment, such as an app's build only App Store Connect knows, is in
 * every environment its project calls production.
 */
export const ReleaseListQuery = Schema.Struct({
  period: Period,
  environment: Schema.optionalKey(EnvironmentKey),
  component: Schema.optionalKey(ComponentKey),
})
export type ReleaseListQuery = typeof ReleaseListQuery.Type

/** Where a release's facts come from besides telemetry. */
export const ReleaseSource = Schema.Literals(["github", "appStoreConnect"]).annotate({ identifier: "ReleaseSource" })
export type ReleaseSource = typeof ReleaseSource.Type

/** Why a component's releases lack their commits or store builds: the source refused, or failed lately. */
export const SourceProblem = Schema.Struct({
  component: ComponentKey,
  source: ReleaseSource,
  /** What it said, in words for the person who fixes it. */
  problem: Schema.String,
  at: Instant,
}).annotate({ identifier: "SourceProblem" })
export type SourceProblem = typeof SourceProblem.Type

/**
 * The releases that ran or were uploaded in a period, the latest first: at most 30. `problems` says
 * which sources couldn't be read lately, so missing commits or builds aren't mistaken for none.
 */
export const ReleaseList = Schema.Struct({
  releases: Schema.Array(ReleaseSummary),
  problems: Schema.Array(SourceProblem),
}).annotate({ identifier: "ReleaseList" })
export type ReleaseList = typeof ReleaseList.Type

/** One release, by its component, environment, and version; without an environment, the one it last ran in. */
export const ReleaseKey = Schema.Struct({
  component: ComponentKey,
  environment: Schema.optionalKey(EnvironmentKey),
  release: ReleaseVersion,
})
export type ReleaseKey = typeof ReleaseKey.Type

/** How an operation ran in a release, and in the one before it. */
export const ComparedOperation = Schema.Struct({
  operation: EnvelopeName,
  count: Count,
  errors: Count,
  p95Ms: Milliseconds,
  previousCount: Count,
  previousErrors: Count,
  previousP95Ms: Milliseconds,
}).annotate({ identifier: "ComparedOperation" })
export type ComparedOperation = typeof ComparedOperation.Type

/**
 * How wide each step of a release's life is: 5 minutes while it ran under 6 hours, an hour under 3
 * days, else a UTC day.
 */
export const LifeStep = Schema.Literals(["5m", "1h", "1d"]).annotate({ identifier: "LifeStep" })
export type LifeStep = typeof LifeStep.Type

/**
 * One step of a release's life. Each number is absent when its telemetry didn't say, never 0:
 * requests in a step nothing of it was counted in, warnings and errors of a release that sent no
 * service telemetry or older than the 90 days they are kept, people by the hour or of an app that
 * sent nothing that day.
 */
export const LifePoint = Schema.Struct({
  start: Instant,
  /** The operations it ran, how many failed, and their p95. */
  requests: Schema.optionalKey(Count),
  failed: Schema.optionalKey(Count),
  p95Ms: Schema.optionalKey(Milliseconds),
  /** What it logged at warn, and at error or fatal. */
  warnings: Schema.optionalKey(Count),
  errors: Schema.optionalKey(Count),
  /** The people of its app on it that UTC day; only in steps of a day. */
  people: Schema.optionalKey(Count),
}).annotate({ identifier: "LifePoint" })
export type LifePoint = typeof LifePoint.Type

/**
 * A release's whole life in numbers: from its first operation or signal to the end of its last
 * (`to` is exclusive, and always after `from`, so the two make a period), its requests and failures,
 * its warnings and errors, and its app's people. A number is absent when it isn't known: requests
 * and failures without service telemetry or once the counts of a short life are gone, warnings and
 * errors without logs, people without an app's signals.
 */
export const LifeTotals = Schema.Struct({
  from: Instant,
  to: Instant,
  requests: Schema.optionalKey(Count),
  failed: Schema.optionalKey(Count),
  warnings: Schema.optionalKey(Count),
  errors: Schema.optionalKey(Count),
  /** When its warnings and errors are counted from, when that is after it started: older ones aren't kept. */
  logsFrom: Schema.optionalKey(Instant),
  /** The people its app was used by, each once. */
  people: Schema.optionalKey(Count),
}).annotate({ identifier: "LifeTotals" })
export type LifeTotals = typeof LifeTotals.Type

/**
 * A release's whole life, whatever any period: a point for every step from its first to its last,
 * oldest first, and its totals; and the totals of the release before it, which it is compared with.
 */
export const ReleaseLife = Schema.Struct({
  step: LifeStep,
  points: Schema.Array(LifePoint),
  totals: LifeTotals,
  /** The release before's whole life; absent for the first, or one that neither ran nor sent. */
  previous: Schema.optionalKey(LifeTotals),
}).annotate({ identifier: "ReleaseLife" })
export type ReleaseLife = typeof ReleaseLife.Type

/** A release's page on its repository's Releases page on GitHub, and when Cluenori last published it. */
export const GitHubReleasePage = Schema.Struct({ url: Schema.String, publishedAt: Instant }).annotate({
  identifier: "GitHubReleasePage",
})
export type GitHubReleasePage = typeof GitHubReleasePage.Type

/**
 * One release, its whole life compared with the one before it: what moved, each list the biggest
 * change first. Operations compare once they ran 100 times in both releases. Incidents are those
 * the project keeps, the open ones and those resolved in the last 7 days, that opened while it ran.
 */
export const ReleaseDetail = Schema.Struct({
  summary: ReleaseSummary,
  /** Its life step by step, beside the release before's totals; absent while it neither ran nor sent. */
  life: Schema.optionalKey(ReleaseLife),
  slower: Schema.Array(ComparedOperation),
  failingMore: Schema.Array(ComparedOperation),
  faster: Schema.Array(ComparedOperation),
  failingLess: Schema.Array(ComparedOperation),
  /** Operations it ran that the release before it didn't. */
  newOperations: Schema.Array(EnvelopeName),
  /**
   * The errors it logged, the most frequent first, at most 20, with how often each happened while it
   * ran; those first seen in it have it as their `firstRelease`.
   */
  errors: Schema.Array(ErrorGroup),
  incidents: Schema.Array(Incident),
  /** What changed in the repository since the release before; absent until both commits are found. */
  changes: Schema.optionalKey(ReleaseChanges),
  /** Why its component's commits or store builds may be missing: the sources that failed lately. */
  problems: Schema.Array(SourceProblem),
  /** Its promotions, to every environment, the latest first: at most 20. */
  promotions: Schema.Array(Promotion),
  /** Where it can be promoted: its component's deploy targets. */
  deployTargets: Schema.Array(DeployTarget),
  /** Its notes for its users, one for each language saved. */
  notes: Schema.Array(ReleaseNote),
  /** Its component's repository on GitHub, where its deploy workflows run; absent until linked. */
  repository: Schema.optionalKey(Repository),
  /**
   * Its page on its repository's Releases page, which Cluenori publishes once it reaches production
   * (deployed to a production environment, or out on the App Store), and again when its notes
   * change; absent until then.
   */
  gitHubRelease: Schema.optionalKey(GitHubReleasePage),
}).annotate({ identifier: "ReleaseDetail" })
export type ReleaseDetail = typeof ReleaseDetail.Type

/** The project has no such release: no operation of it was counted, or it was too long ago. */
export class ReleaseNotFound extends Schema.TaggedError<ReleaseNotFound>()("ReleaseNotFound", {
  component: ComponentKey,
  release: ReleaseVersion,
}) {}

/** One commit, as `git log` gives it to `cluenori-release`. */
export const ReportedCommit = Schema.Struct({
  sha: CommitSha,
  /** Its message's first line. */
  message: Schema.String.check(Schema.isMaxLength(1000)),
  author: Schema.String.check(Schema.isMaxLength(200)),
  committedAt: Instant,
}).annotate({ identifier: "ReportedCommit" })
export type ReportedCommit = typeof ReportedCommit.Type

/**
 * A deploy of a release, as `cluenori-release` reports it from the component's CI with its ingest
 * key: the release, as the component will report it in `service.version`; where it went; its
 * commit, and the tag that names it; and the commits since the release reported before it, newest
 * first, at most 250.
 */
export const ReleaseReport = Schema.Struct({
  release: ReleaseVersion,
  environment: Schema.optionalKey(EnvironmentKey),
  commit: CommitSha,
  tag: Schema.optionalKey(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(255))),
  commits: Schema.optionalKey(Schema.Array(ReportedCommit).check(Schema.isMaxLength(250))),
}).annotate({ identifier: "ReleaseReport" })
export type ReleaseReport = typeof ReleaseReport.Type

/** Which environment's last reported deploy to ask about; all of the component's without one. */
export const LastReportQuery = Schema.Struct({
  environment: Schema.optionalKey(EnvironmentKey),
}).annotate({ identifier: "LastReportQuery" })
export type LastReportQuery = typeof LastReportQuery.Type

/** The last deploy reported of a component: its release and commit, which the next report's commits start after. */
export const LastReport = Schema.Struct({
  release: Schema.optionalKey(ReleaseVersion),
  commit: Schema.optionalKey(CommitSha),
}).annotate({ identifier: "LastReport" })
export type LastReport = typeof LastReport.Type
