import { CalendarDay, ComponentKey, EnvelopeName, EnvironmentKey, Instant, Uuidv7 } from "@cluenori/foundation"
import { ErrorGroupId, LogMessageId } from "@cluenori/signals"
import { Schema } from "effect"

/** A monitor's ID. */
export const MonitorId = Uuidv7.pipe(Schema.brand("MonitorId"))
export type MonitorId = typeof MonitorId.Type

/**
 * The address a monitor fetches: an absolute http or https URL, without spaces or control
 * characters, at most 2,048 characters, such as a component's health endpoint.
 */
export const MonitorUrl = Schema.String.check(
  Schema.isMaxLength(2048),
  Schema.isPattern(/^https?:\/\/[^\s\p{Cc}/?#]+[^\s\p{Cc}]*$/u, { expected: "an absolute http or https URL" }),
).pipe(Schema.brand("MonitorUrl"))
export type MonitorUrl = typeof MonitorUrl.Type

/** The most monitors a project has: each is looked at every minute, and a URL's fetched. */
export const monitorLimit = 30

/**
 * How an alert reaches a phone:
 * - `alarm`: an AlarmKit alarm, which rings through silent mode and Do Not Disturb.
 * - `timeSensitive`: breaks through a Focus that allows it, with a sound.
 * - `quiet`: shows without a sound or lighting the screen.
 */
export const AlertLevel = Schema.Literals(["alarm", "timeSensitive", "quiet"]).annotate({ identifier: "AlertLevel" })
export type AlertLevel = typeof AlertLevel.Type

/** What a monitor watches: a URL; an operation; an error, a log message, or an app's event, by name. */
export const UrlSubject = Schema.TaggedStruct("url", { url: MonitorUrl }).annotate({ identifier: "UrlSubject" })
export const OperationSubject = Schema.TaggedStruct("operation", { operation: EnvelopeName }).annotate({
  identifier: "OperationSubject",
})
export const ErrorSubject = Schema.TaggedStruct("error", { error: ErrorGroupId }).annotate({
  identifier: "ErrorSubject",
})
export const MessageSubject = Schema.TaggedStruct("message", { message: LogMessageId }).annotate({
  identifier: "MessageSubject",
})
export const EventSubject = Schema.TaggedStruct("event", { event: EnvelopeName }).annotate({
  identifier: "EventSubject",
})

/** What "nothing for N" watches: an operation that doesn't run, or an app's event that doesn't come. */
export const QuietSubject = Schema.Union([OperationSubject, EventSubject]).annotate({ identifier: "QuietSubject" })

/** What "more than N" counts: an error, a log message, or an app's event. */
export const CountedSubject = Schema.Union([ErrorSubject, MessageSubject, EventSubject]).annotate({
  identifier: "CountedSubject",
})

/** What a monitor of counts last measured, and when; `value` absent when it couldn't. */
export const MonitorMeasure = Schema.Struct({ at: Instant, value: Schema.optionalKey(Schema.Finite) }).annotate({
  identifier: "MonitorMeasure",
})

// A window back from now, in whole minutes: a minute to a day; and how long nothing may come, a
// minute to a week. Counts are kept by the minute for two days, so a day is read by the minute.
const WindowMinutes = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1440 }))
const QuietMinutes = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10_080 }))

/**
 * When a monitor fires, each over its subject's counts as Signals keeps them:
 * - `noAnswer`: its URL failed two checks in a row (no answer in 10 s, or a status of 400 or more).
 * - `nothingFor`: its operation didn't run, or its event didn't arrive, for `minutes`; first judged
 *   `minutes` after the monitor was added.
 * - `moreThan`: its error, log message or event came more than `count` times in the last `minutes`.
 * - `p95Above`: its operation's p95 over the last `minutes` was above `ms`, of at least 5 runs.
 * - `errorRateAbove`: more than `percent` of its operation's runs over the last `minutes` failed, of
 *   at least 5 runs.
 */
export const MonitorCondition = Schema.Union([
  Schema.TaggedStruct("noAnswer", { subject: UrlSubject }).annotate({ identifier: "NoAnswer" }),
  Schema.TaggedStruct("nothingFor", {
    subject: QuietSubject,
    minutes: QuietMinutes,
  }).annotate({ identifier: "NothingFor" }),
  Schema.TaggedStruct("moreThan", {
    subject: CountedSubject,
    count: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1_000_000 })),
    minutes: WindowMinutes,
  }).annotate({ identifier: "MoreThan" }),
  Schema.TaggedStruct("p95Above", {
    subject: OperationSubject,
    ms: Schema.Finite.check(Schema.isBetween({ minimum: 1, maximum: 600_000 })),
    minutes: WindowMinutes,
  }).annotate({ identifier: "P95Above" }),
  Schema.TaggedStruct("errorRateAbove", {
    subject: OperationSubject,
    percent: Schema.Finite.check(Schema.isGreaterThan(0), Schema.isLessThan(100)),
    minutes: WindowMinutes,
  }).annotate({ identifier: "ErrorRateAbove" }),
]).annotate({ identifier: "MonitorCondition" })
export type MonitorCondition = typeof MonitorCondition.Type

/**
 * Something Cluenori watches every minute for one component, with when it fires and how its alert
 * reaches phones: a URL it fetches, or counts Signals keeps, in one environment or, absent, in any.
 * A URL's monitor has no environment.
 */
export class Monitor extends Schema.Class<Monitor>("Monitor")({
  id: MonitorId,
  component: ComponentKey,
  environment: Schema.optionalKey(EnvironmentKey),
  condition: MonitorCondition,
  level: AlertLevel,
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
 * A monitor now. A URL's: its last check, absent until its first; since when it has passed, or
 * failed, as it does now, absent when that began before November 2026; and its days, oldest first,
 * the last 90 that had checks. A day with none, while Cluenori didn't check it, isn't listed. One of
 * counts has no checks, and says what it last measured.
 */
export const MonitorState = Schema.Struct({
  monitor: Monitor,
  lastCheck: Schema.optionalKey(MonitorCheck),
  since: Schema.optionalKey(Instant),
  days: Schema.Array(MonitorDay),
  /**
   * What the last look at its counts found, for a monitor of counts; absent for a URL's, and until
   * its first look: how many ran or came in its window, its p95 in ms, or its error rate in percent,
   * the value absent when its operation ran fewer than 5 times.
   */
  measured: Schema.optionalKey(MonitorMeasure),
  /** Whether it has an open incident now. */
  firing: Schema.Boolean,
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

/** A monitor to add: of which component, in which environment (none for a URL's), when it fires, and its alerts' level. */
export const AddMonitor = Schema.Struct({
  component: ComponentKey,
  environment: Schema.optionalKey(EnvironmentKey),
  condition: MonitorCondition,
  level: AlertLevel,
})
  .check(
    Schema.makeFilter(
      (input: { readonly environment?: unknown; readonly condition: { readonly _tag: string } }) =>
        input.condition._tag !== "noAnswer" || input.environment === undefined,
      { expected: "no environment for a URL's monitor" },
    ),
  )
  .annotate({ identifier: "AddMonitor" })
export type AddMonitor = typeof AddMonitor.Type

/** The project has no monitor with this ID. */
export class MonitorNotFound extends Schema.TaggedError<MonitorNotFound>()("MonitorNotFound", {
  monitor: MonitorId,
}) {}

/** The component already has this monitor, in this environment: `monitor` is its ID. */
export class MonitorExists extends Schema.TaggedError<MonitorExists>()("MonitorExists", {
  monitor: MonitorId,
}) {}

/** The project has as many monitors as it may: remove one first. */
export class MonitorLimitReached extends Schema.TaggedError<MonitorLimitReached>()("MonitorLimitReached", {
  limit: Schema.Int,
}) {}
