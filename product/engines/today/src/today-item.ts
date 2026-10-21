import { ComponentKey, EnvelopeName, EnvironmentKey, Instant, ProjectKey } from "@cluenori/foundation"
import { Incident } from "@cluenori/incidents"
import { Project } from "@cluenori/projects"
import { ErrorGroup } from "@cluenori/signals"
import { Schema } from "effect"

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
 * A project with components that sent no operation in the last day. `lastDataAt` is the end of the
 * last minute or hour anything was counted in the 7 days before; absent when nothing was.
 */
export const SilentItem = Schema.TaggedStruct("silent", {
  project: ProjectKey,
  lastDataAt: Schema.optionalKey(Instant),
}).annotate({ identifier: "SilentItem" })

/** One thing that needs attention now, of one project, with its evidence; its tag says what. */
export const TodayItem = Schema.Union([IncidentItem, ErrorItem, SlowerItem, SilentItem]).annotate({
  identifier: "TodayItem",
})
export type TodayItem = typeof TodayItem.Type

/**
 * What needs attention now across the workspace's projects, the most urgent first: open incidents
 * not acknowledged, errors happening now, acknowledged incidents, new errors, slower operations,
 * then projects that sent nothing. A project that didn't answer is in `unanswered`, its items
 * missing: never read as nothing to do.
 */
export const TodayList = Schema.Struct({
  items: Schema.Array(TodayItem),
  /** Every project asked, with its name. */
  projects: Schema.Array(Project),
  unanswered: Schema.Array(ProjectKey),
  /** When Today looked. */
  at: Instant,
}).annotate({ identifier: "TodayList" })
export type TodayList = typeof TodayList.Type
