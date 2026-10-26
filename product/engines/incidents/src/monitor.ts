import { CalendarDay, ComponentKey, Instant, Uuidv7 } from "@cluenori/foundation"
import { Schema } from "effect"

/** A monitor's ID. */
export const MonitorId = Uuidv7.pipe(Schema.brand("MonitorId"))
export type MonitorId = typeof MonitorId.Type

/**
 * The address a monitor checks: an absolute http or https URL, without spaces, at most 2,048
 * characters, such as a component's health endpoint.
 */
export const MonitorUrl = Schema.String.check(
  Schema.isMaxLength(2048),
  Schema.isPattern(/^https?:\/\/[^\s/?#]+[^\s]*$/, { expected: "an absolute http or https URL" }),
).pipe(Schema.brand("MonitorUrl"))
export type MonitorUrl = typeof MonitorUrl.Type

/** The most monitors a project has: each is fetched every minute. */
export const monitorLimit = 20

/**
 * An address Cluenori fetches every minute for one component. A check passes when it answers with
 * a status below 400 within 10 seconds.
 */
export class Monitor extends Schema.Class<Monitor>("Monitor")({
  id: MonitorId,
  component: ComponentKey,
  url: MonitorUrl,
  addedAt: Instant,
}) {}

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const Milliseconds = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))

/**
 * One check of a monitor: when; the HTTP status it answered with and how long the answer took, both
 * absent when it didn't answer; and what was wrong, absent when it passed. Checks before November
 * 2026 have no status or time.
 */
export const MonitorCheck = Schema.Struct({
  at: Instant,
  status: Schema.optionalKey(Schema.Int),
  ms: Schema.optionalKey(Milliseconds),
  problem: Schema.optionalKey(Schema.String),
}).annotate({ identifier: "MonitorCheck" })
export type MonitorCheck = typeof MonitorCheck.Type

/**
 * A monitor's checks over one UTC day: how many, how many failed, and the average time of those
 * answered, absent when none was.
 */
export const MonitorDay = Schema.Struct({
  day: CalendarDay,
  checks: Count,
  failed: Count,
  averageMs: Schema.optionalKey(Milliseconds),
}).annotate({ identifier: "MonitorDay" })
export type MonitorDay = typeof MonitorDay.Type

/**
 * A monitor now: its last check, absent until its first; since when it has passed, or failed, as
 * it does now, absent when that began before November 2026; and its days, oldest first, the last 90
 * that had checks. A day with none, while Cluenori didn't check it, isn't listed.
 */
export const MonitorState = Schema.Struct({
  monitor: Monitor,
  lastCheck: Schema.optionalKey(MonitorCheck),
  since: Schema.optionalKey(Instant),
  days: Schema.Array(MonitorDay),
}).annotate({ identifier: "MonitorState" })
export type MonitorState = typeof MonitorState.Type

/** The project's monitors, oldest first. */
export const MonitorList = Schema.Struct({ monitors: Schema.Array(MonitorState) }).annotate({
  identifier: "MonitorList",
})
export type MonitorList = typeof MonitorList.Type

/**
 * A monitor's checks over five minutes: how many, how many failed, and the average and slowest time
 * of those answered, absent when none was.
 */
export const MonitorStep = Schema.Struct({
  start: Instant,
  checks: Count,
  failed: Count,
  averageMs: Schema.optionalKey(Milliseconds),
  slowestMs: Schema.optionalKey(Milliseconds),
}).annotate({ identifier: "MonitorStep" })
export type MonitorStep = typeof MonitorStep.Type

export const AddMonitor = Schema.Struct({ component: ComponentKey, url: MonitorUrl }).annotate({
  identifier: "AddMonitor",
})
export type AddMonitor = typeof AddMonitor.Type

/** The project has no monitor with this ID. */
export class MonitorNotFound extends Schema.TaggedError<MonitorNotFound>()("MonitorNotFound", {
  monitor: MonitorId,
}) {}

/** The component already has a monitor of this URL. */
export class MonitorExists extends Schema.TaggedError<MonitorExists>()("MonitorExists", {
  component: ComponentKey,
  url: MonitorUrl,
}) {}

/** The project has as many monitors as it may: remove one first. */
export class MonitorLimitReached extends Schema.TaggedError<MonitorLimitReached>()("MonitorLimitReached", {
  limit: Schema.Int,
}) {}
