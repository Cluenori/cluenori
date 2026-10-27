import {
  ComponentKey,
  EnvelopeName,
  EnvironmentKey,
  Instant,
  ProjectKey,
  ReleaseVersion,
  Uuidv7,
} from "@cluenori/foundation"
import { Incident } from "@cluenori/incidents"
import { IngestKeyInfo, Project } from "@cluenori/projects"
import { ErrorGroup } from "@cluenori/signals"
import { Schema } from "effect"

import { ProjectPulse } from "./project-pulse.ts"

const Milliseconds = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))

/** An open incident: acknowledged or not, from the project's detectors. */
export const IncidentItem = Schema.TaggedStruct("incident", { project: ProjectKey, incident: Incident }).annotate({
  identifier: "IncidentItem",
})

/**
 * An error group that is new (first seen in the last day), happening now (seen in the last 15
 * minutes), or both, with its occurrences over the last day.
 */
export const ErrorItem = Schema.TaggedStruct("error", {
  project: ProjectKey,
  error: ErrorGroup,
  isNew: Schema.Boolean,
  ongoing: Schema.Boolean,
}).annotate({ identifier: "ErrorItem" })

/** An operation whose p95 over the last day got slower than over the 7 days before (`slowerRule`). */
export const SlowerItem = Schema.TaggedStruct("slower", {
  project: ProjectKey,
  component: ComponentKey,
  /** Absent when the component didn't say. */
  environment: Schema.optionalKey(EnvironmentKey),
  operation: EnvelopeName,
  p95Ms: Milliseconds,
  usualP95Ms: Milliseconds,
}).annotate({ identifier: "SlowerItem" })

/**
 * An operation that is quiet: it usually ran about every `usualGapMs`, as Incidents guessed from its
 * history, and hasn't for twice that, since `lastRanAt` (Incidents' `QuietOperation`). A hint, never
 * an alert: it may be fine.
 */
export const QuietItem = Schema.TaggedStruct("quiet", {
  project: ProjectKey,
  component: ComponentKey,
  /** Absent when the component didn't say. */
  environment: Schema.optionalKey(EnvironmentKey),
  operation: EnvelopeName,
  usualGapMs: Milliseconds,
  lastRanAt: Instant,
}).annotate({ identifier: "QuietItem" })

/**
 * A project with components that sent no operation in the last day. `lastDataAt` is the end of the
 * last minute or hour anything was counted in the 7 days before; absent when nothing was.
 */
export const SilentItem = Schema.TaggedStruct("silent", {
  project: ProjectKey,
  lastDataAt: Schema.optionalKey(Instant),
}).annotate({ identifier: "SilentItem" })

/**
 * What a promotion needs of a member: `approved` in App Store review, to be released; `waiting` for
 * someone to approve its environment on GitHub; or ended without its release getting there, `failed`,
 * `rejected` in App Store review, or `lost` (no run or build found in time).
 */
export const PromotionItemState = Schema.Literals(["approved", "waiting", "failed", "rejected", "lost"]).annotate({
  identifier: "PromotionItemState",
})
export type PromotionItemState = typeof PromotionItemState.Type

/**
 * A promotion that needs a member, in an environment the project calls production: approved in App
 * Store review and waiting for a member to release it (`approved`), its run waiting for someone to
 * approve its environment on GitHub (`waiting`), or ended without its release getting there (`failed`,
 * `rejected` in App Store review, or `lost`), until something reaches that environment. A cancelled one
 * needs no one.
 */
export const PromotionItem = Schema.TaggedStruct("promotion", {
  project: ProjectKey,
  component: ComponentKey,
  environment: EnvironmentKey,
  release: ReleaseVersion,
  /** The promotion's ID. */
  promotion: Uuidv7,
  state: PromotionItemState,
  startedAt: Instant,
  /** When it was seen to end; absent while it hasn't. */
  endedAt: Schema.optionalKey(Instant),
}).annotate({ identifier: "PromotionItem" })
export type PromotionItem = typeof PromotionItem.Type

/**
 * An ingest key that expires within a week and isn't revoked before: a deploy needs a new key first.
 * Owners only, who alone manage keys.
 */
export const KeyExpiringItem = Schema.TaggedStruct("keyExpiring", { project: ProjectKey, key: IngestKeyInfo }).annotate(
  {
    identifier: "KeyExpiringItem",
  },
)

/** One thing that needs attention now, of one project, with its evidence; its tag says what. */
export const TodayItem = Schema.Union([
  IncidentItem,
  ErrorItem,
  SlowerItem,
  QuietItem,
  KeyExpiringItem,
  PromotionItem,
  SilentItem,
]).annotate({
  identifier: "TodayItem",
})
export type TodayItem = typeof TodayItem.Type

/**
 * What needs attention now across the workspace's projects, the most urgent first: open incidents
 * not acknowledged, errors happening now, acknowledged incidents, new errors, slower operations,
 * quiet operations, ingest keys that expire soon, promotions that need a member, then projects that
 * sent nothing; and how each project is going
 * now. A project that didn't answer is in `unanswered`, its items and pulse missing: never read as
 * nothing to do.
 */
export const TodayList = Schema.Struct({
  items: Schema.Array(TodayItem),
  /** Every project asked, with its name. */
  projects: Schema.Array(Project),
  unanswered: Schema.Array(ProjectKey),
  /**
   * Each project that answered, in `projects`' order: its pulse. Absent from deployments older than
   * it.
   */
  pulses: Schema.optionalKey(Schema.Array(ProjectPulse)),
  /** When Today looked. */
  at: Instant,
}).annotate({ identifier: "TodayList" })
export type TodayList = typeof TodayList.Type

/**
 * One project's answer to Today, which the host merges with the others': its items, in no order, and
 * its pulse.
 */
export const ProjectToday = Schema.Struct({ items: Schema.Array(TodayItem), pulse: ProjectPulse }).annotate({
  identifier: "ProjectToday",
})
export type ProjectToday = typeof ProjectToday.Type
