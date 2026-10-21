import { ComponentKey, EnvelopeName, EnvironmentKey, Instant, Uuidv7 } from "@cluenori/foundation"
import { Schema } from "effect"

import { MonitorId, MonitorUrl } from "./monitor.ts"

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const Rate = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 }))
const Milliseconds = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))

/** An incident's ID. */
export const IncidentId = Uuidv7.pipe(Schema.brand("IncidentId"))
export type IncidentId = typeof IncidentId.Type

/**
 * Which detector opened an incident, each comparing with its own usual, so none has a threshold to
 * set:
 * - `down`: a monitor's URL failed two checks in a row.
 * - `failing`: an operation's error rate over the last 15 minutes is at least 2% and three times
 *   its usual, the 7 days before, with at least five failures.
 * - `stopped`: an operation that runs on a schedule, learned from the minutes it ran in over the 2
 *   days before, or the 6 hours for one that runs every 5 to 15 minutes, missed twice its usual
 *   gap.
 */
export const Detector = Schema.Literals(["down", "failing", "stopped"])
export type Detector = typeof Detector.Type

/** What a detector saw when the incident opened, or last got worse; its tag is the detector. */
export const Evidence = Schema.Union([
  Schema.TaggedStruct("down", {
    monitor: MonitorId,
    url: MonitorUrl,
    /** How many checks in a row failed. */
    failures: Count,
    /** What was wrong with the last: `HTTP 503`, `No answer in 10 s`. */
    problem: Schema.String,
  }).annotate({ identifier: "DownEvidence" }),
  Schema.TaggedStruct("failing", {
    operation: EnvelopeName,
    /** How many failed, and ran, in the 15 minutes looked at. */
    failed: Count,
    count: Count,
    /** Its error rate over the 7 days before; 0 when it never failed then, or didn't run. */
    usualRate: Rate,
  }).annotate({ identifier: "FailingEvidence" }),
  Schema.TaggedStruct("stopped", {
    operation: EnvelopeName,
    /** The start of the last minute it ran in. */
    lastRanAt: Instant,
    /** Its usual gap between runs. */
    usualGapMs: Milliseconds,
  }).annotate({ identifier: "StoppedEvidence" }),
]).annotate({ identifier: "Evidence" })
export type Evidence = typeof Evidence.Type

/**
 * One problem from its start to its recovery: one for each detector and subject at a time. It opens
 * when its detector fires; resolves after 10 minutes without the problem; and a problem back within
 * 30 minutes of that reopens it.
 */
export class Incident extends Schema.Class<Incident>("Incident")({
  id: IncidentId,
  component: ComponentKey,
  /** Absent when the component didn't say. */
  environment: Schema.optionalKey(EnvironmentKey),
  /** What it is about: the operation's name, or the monitor's URL. */
  subject: Schema.String,
  /**
   * What is wrong, in words without times, which depend on who reads them:
   * `POST /api/card: 18% failed, usually 0.1%`.
   */
  title: Schema.String,
  evidence: Evidence,
  openedAt: Instant,
  /** Absent while it is open. */
  resolvedAt: Schema.optionalKey(Instant),
  /** When someone said they are on it, which stops its notifications; absent until then. */
  acknowledgedAt: Schema.optionalKey(Instant),
}) {}

/**
 * The project's incidents: the open ones, newest first, and up to 50 resolved in the last 7 days,
 * the latest resolved first. `checkedAt` is when the detectors last looked, absent before their
 * first look: a time long ago means they stopped.
 */
export const IncidentList = Schema.Struct({
  open: Schema.Array(Incident),
  resolved: Schema.Array(Incident),
  checkedAt: Schema.optionalKey(Instant),
}).annotate({ identifier: "IncidentList" })
export type IncidentList = typeof IncidentList.Type

/** The project has no incident with this ID. */
export class IncidentNotFound extends Schema.TaggedError<IncidentNotFound>()("IncidentNotFound", {
  incident: IncidentId,
}) {}

/**
 * What a check did to an incident, for whoever tells people: it opened, came back within 30 minutes
 * of resolving, got worse (a failure rate twice what was last told), or resolved.
 */
export const IncidentChange = Schema.Struct({
  change: Schema.Literals(["opened", "reopened", "worsened", "resolved"]),
  incident: Incident,
})
export type IncidentChange = typeof IncidentChange.Type
