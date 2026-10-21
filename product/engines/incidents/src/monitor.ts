import { ComponentKey, Uuidv7 } from "@cluenori/foundation"
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
  addedAt: Schema.DateTimeUtcFromString,
}) {}

/** The last check of a monitor: when, and what was wrong, absent when it passed. */
export const MonitorCheck = Schema.Struct({
  at: Schema.DateTimeUtcFromString,
  problem: Schema.optionalKey(Schema.String),
})
export type MonitorCheck = typeof MonitorCheck.Type

/** A monitor and its last check, absent until its first. */
export const MonitorState = Schema.Struct({ monitor: Monitor, lastCheck: Schema.optionalKey(MonitorCheck) })
export type MonitorState = typeof MonitorState.Type

/** The project's monitors, oldest first. */
export const MonitorList = Schema.Struct({ monitors: Schema.Array(MonitorState) })
export type MonitorList = typeof MonitorList.Type

export const AddMonitor = Schema.Struct({ component: ComponentKey, url: MonitorUrl })
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
