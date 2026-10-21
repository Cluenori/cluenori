import { ComponentKey, EnvelopeName, EnvironmentKey, Instant, Period, ReleaseVersion } from "@cluenori/foundation"
import { Incident } from "@cluenori/incidents"
import { ErrorGroup } from "@cluenori/signals"
import { Schema } from "effect"

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
 */
export const Verdict = Schema.Literals(["worse", "better", "same", "tooEarly", "first"]).annotate({
  identifier: "Verdict",
})
export type Verdict = typeof Verdict.Type

/**
 * One release of a component in one environment, as its operations show it: when it ran, how much,
 * and how it compares with the release before it.
 */
export const ReleaseSummary = Schema.Struct({
  component: ComponentKey,
  /** Absent when the component didn't say. */
  environment: Schema.optionalKey(EnvironmentKey),
  release: ReleaseVersion,
  /** The start of the first minute it ran in. */
  firstSeen: Instant,
  /** The end of the last minute it ran in. */
  lastSeen: Instant,
  /** How many operations it ran, and how many of them failed. */
  count: Count,
  errors: Count,
  /** The release before it; absent for the first. */
  previous: Schema.optionalKey(ReleaseVersion),
  verdict: Verdict,
  /** What the verdict counts: operations slower, operations failing more, and errors first seen in it. */
  slower: Count,
  failingMore: Count,
  newErrors: Count,
}).annotate({ identifier: "ReleaseSummary" })
export type ReleaseSummary = typeof ReleaseSummary.Type

/** Which releases to list: those that ran in `period`, optionally of one environment or component. */
export const ReleaseListQuery = Schema.Struct({
  period: Period,
  environment: Schema.optionalKey(EnvironmentKey),
  component: Schema.optionalKey(ComponentKey),
})
export type ReleaseListQuery = typeof ReleaseListQuery.Type

/** The releases that ran in a period, the latest first seen first: at most 30. */
export const ReleaseList = Schema.Struct({
  releases: Schema.Array(ReleaseSummary),
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
 * One release compared with the one before it: what moved, each list the biggest change first.
 * Operations compare once they ran 100 times in both releases. Incidents are those the project
 * keeps, the open ones and those resolved in the last 7 days, that opened while it ran.
 */
export const ReleaseDetail = Schema.Struct({
  summary: ReleaseSummary,
  slower: Schema.Array(ComparedOperation),
  failingMore: Schema.Array(ComparedOperation),
  faster: Schema.Array(ComparedOperation),
  failingLess: Schema.Array(ComparedOperation),
  /** Operations it ran that the release before it didn't. */
  newOperations: Schema.Array(EnvelopeName),
  /** Errors first seen in it, with how often they happened while it ran. */
  newErrors: Schema.Array(ErrorGroup),
  incidents: Schema.Array(Incident),
}).annotate({ identifier: "ReleaseDetail" })
export type ReleaseDetail = typeof ReleaseDetail.Type

/** The project has no such release: no operation of it was counted, or it was too long ago. */
export class ReleaseNotFound extends Schema.TaggedError<ReleaseNotFound>()("ReleaseNotFound", {
  component: ComponentKey,
  release: ReleaseVersion,
}) {}
