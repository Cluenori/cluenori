// What the analytics pages say about a project's apps, worked out once from the API's answers: a
// chart's days, a release's app health in words and measure by measure, retention as shares. Every
// rule here is pure. The rules that judge a release are Analytics' (`@cluenori/analytics`); these only
// say them.

import type { HealthMeasure, ReleaseHealth } from "@cluenori/analytics"
import {
  judgedAfterMs,
  launchesCompared,
  memoryCompared,
  memoryRule,
  rateRule,
  sessionsCompared,
} from "@cluenori/analytics"
import type { CalendarDay, ComponentKey, EnvironmentKey } from "@cluenori/foundation"
import { calendarDayOfNumber, dayNumberOf } from "@cluenori/foundation"
import type {
  AppHealth,
  AppRelease,
  AppUsage,
  LaunchTimes,
  RetentionCohort,
  TimelineEntry,
  UsageDay,
} from "@cluenori/signals"
import { slowerRule } from "@cluenori/signals"
import { DateTime } from "effect"

import { componentColor } from "@/lib/colors"
import { bytes, calendarDayText, count, duration, lasting, ratio } from "@/lib/format"
import type { AppPeriodKey } from "@/project-data"
import { appPeriods } from "@/project-data"
import type { Environments, VerdictTone } from "@/project-facts"

// ---- Period ----------------------------------------------------------------------------------------

/** The analytics period as a sentence says it: "the last 30 days". */
export const appPeriodWords = (key: AppPeriodKey) =>
  `the last ${appPeriods.find((entry) => entry.key === key)?.days ?? 30} days`

/**
 * The newest signal a list of releases says the apps sent, in Unix ms, for a page's header;
 * undefined when none sent anything in the period.
 */
export const latestSentOf = (list: { readonly releases: ReadonlyArray<{ readonly release: AppRelease }> }) => {
  const times = list.releases.map((each) => DateTime.toEpochMillis(each.release.lastSeen))
  return times.length === 0 ? undefined : Math.max(...times)
}

// ---- Environments ----------------------------------------------------------------------------------

/**
 * Which environment the analytics pages show, and those they offer: the environments the apps sent
 * from in the period, the project's production ones first, which may not be its services'. It shows
 * the one chosen, named by the address or picked on the project's pages, when the apps sent from
 * it; else the first they sent from, production first. None when they sent from none: the questions
 * then ask about every environment.
 */
export const appEnvironmentsOf = (
  sentFrom: ReadonlyArray<EnvironmentKey>,
  production: ReadonlyArray<EnvironmentKey>,
  chosen: EnvironmentKey | undefined,
): Environments => {
  const seen = [...new Set(sentFrom)]
  const offered = [
    ...seen.filter((environment) => production.includes(environment)),
    ...seen.filter((environment) => !production.includes(environment)),
  ]
  const shown = chosen !== undefined && offered.includes(chosen) ? chosen : offered[0]
  return { ...(shown === undefined ? {} : { shown }), offered, production }
}

/**
 * The color an analytics chart is in: the component's it shows, or, showing every one, the one
 * component the apps sent from when they all are its, else blue, as the other pages draw every
 * component.
 */
export const appColorOf = (
  component: ComponentKey | undefined,
  sentFrom: ReadonlyArray<ComponentKey>,
  components: ReadonlyArray<ComponentKey>,
) => {
  const only = [...new Set(sentFrom)]
  const shown = component ?? (only.length === 1 ? only[0] : undefined)
  return shown === undefined ? "var(--blue)" : componentColor(shown, components)
}

// ---- Days ------------------------------------------------------------------------------------------

/** A chart's UTC days, oldest first, and a value for each, undefined where it isn't known. */
export type DayColumns = {
  readonly days: ReadonlyArray<CalendarDay>
  readonly values: ReadonlyArray<number | undefined>
}

/** Every UTC day a period touches, oldest first: those a chart of it has a column for. */
export const daysOf = (period: { readonly from: DateTime.Utc; readonly to: DateTime.Utc }) => {
  const first = dayNumberOf(DateTime.toEpochMillis(period.from))
  const last = dayNumberOf(DateTime.toEpochMillis(period.to))
  return Array.from({ length: Math.max(0, last - first + 1) }, (_, index) => calendarDayOfNumber(first + index))
}

/**
 * A measure of usage as a chart's columns over the days of `period`: a day the answer doesn't list
 * isn't counted (before the apps first sent anything, or older than is kept), so it is unknown; a
 * day whose measure is absent, such as a week that reaches before them, is unknown too, never zero.
 */
export const usageColumnsOf = (
  usage: AppUsage,
  period: { readonly from: DateTime.Utc; readonly to: DateTime.Utc },
  valueOf: (day: UsageDay) => number | undefined,
): DayColumns => {
  const days = daysOf(period)
  const byDay = new Map(usage.days.map((entry) => [entry.day, entry] as const))
  return {
    days,
    values: days.map((day) => {
      const found = byDay.get(day)
      return found === undefined ? undefined : valueOf(found)
    }),
  }
}

/** Three evenly spaced days of a chart, to label its axis with, apart even on a phone: "Oct 20". */
export const dayTicksOf = (columns: DayColumns) =>
  [0, 1, 2].flatMap((third) => {
    const column = Math.floor((third * columns.days.length) / 3)
    const day = columns.days[column]
    return day === undefined ? [] : [{ column, label: calendarDayText(day) }]
  })

/** The latest known value of a chart's columns, if any: what its row's note says. */
export const latestOf = (columns: DayColumns) => columns.values.findLast((value) => value !== undefined)

/** The days a run of columns stands for, in words: "Oct 20", or "Oct 20 – Oct 22". */
export const daySpanText = (columns: DayColumns, span: { readonly first: number; readonly last: number }) => {
  const first = columns.days[span.first]
  const last = columns.days[span.last]
  if (first === undefined) {
    return ""
  }
  return last === undefined || last === first
    ? `${calendarDayText(first)} UTC`
    : `${calendarDayText(first)} – ${calendarDayText(last)} UTC`
}

// ---- Retention -------------------------------------------------------------------------------------

/** A cohort as the retention grid shows it: each week's share of its people, the last one so far. */
export type CohortRow = {
  readonly week: CalendarDay
  readonly people: number
  readonly weeks: ReadonlyArray<{ readonly active: number; readonly share: number; readonly soFar: boolean }>
}

/** Each cohort's weeks as shares of its people; the last week of each is the current one, so far. */
export const cohortRowsOf = (cohorts: ReadonlyArray<RetentionCohort>): ReadonlyArray<CohortRow> =>
  cohorts.map((cohort) => ({
    week: cohort.week,
    people: cohort.people,
    weeks: cohort.active.map((active, index) => ({
      active,
      share: cohort.people === 0 ? 0 : active / cohort.people,
      soFar: index === cohort.active.length - 1,
    })),
  }))

// ---- App health ------------------------------------------------------------------------------------

const worseWords: Readonly<Record<HealthMeasure, string>> = {
  coldLaunch: "cold launch slower",
  warmLaunch: "warm launch slower",
  memory: "more memory",
  crashes: "more crashes",
  hangs: "more hangs",
}

const betterWords: Readonly<Record<HealthMeasure, string>> = {
  coldLaunch: "cold launch faster",
  warmLaunch: "warm launch faster",
  memory: "less memory",
  crashes: "fewer crashes",
  hangs: "fewer hangs",
}

/**
 * How a release's app health compares with the release before it, in words, with what moved:
 * "Worse: cold launch slower, more crashes", "Better: fewer hangs", "About the same".
 */
export const healthWordsOf = (
  health: Pick<ReleaseHealth, "verdict" | "worse" | "better">,
): { readonly words: string; readonly tone: VerdictTone } => {
  switch (health.verdict) {
    case "worse":
      return {
        words:
          health.worse.length === 0 ? "Worse" : `Worse: ${health.worse.map((each) => worseWords[each]).join(", ")}`,
        tone: "warning",
      }
    case "better":
      return {
        words:
          health.better.length === 0
            ? "Better"
            : `Better: ${health.better.map((each) => betterWords[each]).join(", ")}`,
        tone: "better",
      }
    case "same":
      return { words: "About the same", tone: "quiet" }
    case "tooEarly":
      return { words: "Too early to tell", tone: "quiet" }
    case "first":
      return { words: "First release counted", tone: "quiet" }
    case "unmeasured":
      return { words: "Nothing measured yet", tone: "quiet" }
  }
}

/** What makes a release's app health worse, for the pages that judge one. */
export const healthMeaning = `Worse than the release before: a launch's p95 to its first frame at least ${slowerRule.times} times and ${duration(slowerRule.byMs)} more, with ${count(launchesCompared)} launches in both; peak memory's p95 ${memoryRule.times} times and ${bytes(memoryRule.byBytes)} more, with ${count(memoryCompared)} measurements in both; or crashes or hangs at least ${count(rateRule.atLeast)}, ${rateRule.times} times as often and ${count(rateRule.byPerThousand)} more per 1,000 sessions, with ${count(sessionsCompared)} sessions and MetricKit's reports in both. Too early to tell until a release ran ${lasting(judgedAfterMs)} and a measure compares.`

/**
 * One measure of a release beside the release before it: its value, and the earlier one, each
 * absent when the release didn't send it; and whether it moved for the worse or the better.
 */
export type HealthRow = {
  readonly label: string
  readonly now?: string
  readonly before?: string
  readonly moved?: "worse" | "better"
}

const movedOf = (health: ReleaseHealth, measure: HealthMeasure): "worse" | "better" | undefined => {
  if (health.worse.includes(measure)) {
    return "worse"
  }
  return health.better.includes(measure) ? "better" : undefined
}

// A row from a measure of each release's health, left out when neither release has it.
const rowOf = (
  label: string,
  now: number | undefined,
  before: number | undefined,
  format: (value: number) => string,
  moved?: "worse" | "better",
): ReadonlyArray<HealthRow> =>
  now === undefined && before === undefined
    ? []
    : [
        {
          label,
          ...(now === undefined ? {} : { now: format(now) }),
          ...(before === undefined ? {} : { before: format(before) }),
          ...(moved === undefined ? {} : { moved }),
        },
      ]

const launchRows = (
  kind: "Cold" | "Warm",
  measure: HealthMeasure,
  health: ReleaseHealth,
  now: LaunchTimes | undefined,
  before: LaunchTimes | undefined,
) => [
  ...rowOf(`${kind} launch p95`, now?.firstFrameP95Ms, before?.firstFrameP95Ms, duration, movedOf(health, measure)),
  ...rowOf(`${kind} launch p50`, now?.firstFrameP50Ms, before?.firstFrameP50Ms, duration),
  ...rowOf(`${kind} launch to first screen p95`, now?.ready?.p95Ms, before?.ready?.p95Ms, duration),
  ...rowOf(`${kind} launches`, now?.launches, before?.launches, count),
]

/**
 * A release's app health, measure by measure, beside the release before it's: launches cold and
 * warm, memory, crashes and hangs per 1,000 sessions, then what they were counted from. A measure
 * neither release sent isn't listed; one only one of them sent is unknown for the other.
 */
export const healthRowsOf = (health: ReleaseHealth): ReadonlyArray<HealthRow> => {
  const now: AppHealth = health.health
  const before: AppHealth | undefined = health.previousHealth
  return [
    ...launchRows("Cold", "coldLaunch", health, now.cold, before?.cold),
    ...launchRows("Warm", "warmLaunch", health, now.warm, before?.warm),
    ...rowOf(
      "Peak memory p95",
      now.memory?.peakP95Bytes,
      before?.memory?.peakP95Bytes,
      bytes,
      movedOf(health, "memory"),
    ),
    ...rowOf("Footprint p95", now.memory?.footprintP95Bytes, before?.memory?.footprintP95Bytes, bytes),
    ...rowOf(
      "Crashes per 1,000 sessions",
      health.crashesPerThousand,
      health.previousCrashesPerThousand,
      ratio,
      movedOf(health, "crashes"),
    ),
    ...rowOf(
      "Hangs per 1,000 sessions",
      health.hangsPerThousand,
      health.previousHangsPerThousand,
      ratio,
      movedOf(health, "hangs"),
    ),
    ...rowOf("Sessions", now.sessions, before?.sessions, count),
    ...rowOf("People", now.people, before?.people, count),
    ...rowOf("Prewarmed launches", now.prewarmed, before?.prewarmed, count),
    ...rowOf("MetricKit reports", now.diagnostics?.reports, before?.diagnostics?.reports, count),
    ...rowOf("Crashes", now.diagnostics?.crashes, before?.diagnostics?.crashes, count),
    ...rowOf("Hangs", now.diagnostics?.hangs, before?.diagnostics?.hangs, count),
  ]
}

/** A release's app health, keyed as the pages name it: by component, environment and version. */
export const healthKeyOf = (health: ReleaseHealth) =>
  `${health.release.component} ${health.release.environment} ${health.release.release}`

// ---- A person --------------------------------------------------------------------------------------

/**
 * A person's sessions by day, from the oldest day listed to `today`: a day between them not listed
 * had none, as the latest 90 active days are all listed.
 */
export const personDaysOf = (
  days: ReadonlyArray<{ readonly day: CalendarDay; readonly sessions: number }>,
  today: CalendarDay,
): DayColumns => {
  const numbers = days.map((entry) =>
    dayNumberOf(DateTime.toEpochMillis(DateTime.makeUnsafe(`${entry.day}T00:00:00Z`))),
  )
  const end = dayNumberOf(DateTime.toEpochMillis(DateTime.makeUnsafe(`${today}T00:00:00Z`)))
  if (numbers.length === 0) {
    return { days: [], values: [] }
  }
  const start = Math.min(...numbers)
  const sessions = new Map(days.map((entry) => [entry.day, entry.sessions] as const))
  const all = Array.from({ length: Math.max(0, end - start + 1) }, (_, index) => calendarDayOfNumber(start + index))
  return { days: all, values: all.map((day) => sessions.get(day) ?? 0) }
}

// An event's property as it reads: a string as it is, a number as a number, a boolean as true or false.
const propertyText = (value: unknown) => {
  if (typeof value === "string" || typeof value === "number") {
    return `${value}`
  }
  return value === true ? "true" : "false"
}

/** What one signal of a person's timeline says, in words: its kind, then its details. */
export const timelineWordsOf = (entry: TimelineEntry): { readonly title: string; readonly detail?: string } => {
  const signal = entry.signal
  switch (signal._tag) {
    case "session.started":
      return { title: "Session started" }
    case "session.ended":
      return { title: "Session ended", detail: `${duration(signal.foregroundMs)} in the foreground` }
    case "app.launched":
      return {
        title: `Launched ${signal.start}`,
        detail: [
          `first frame ${duration(signal.firstFrameMs)}`,
          ...(signal.readyMs === undefined ? [] : [`first screen ${duration(signal.readyMs)}`]),
          ...(signal.prewarmed ? ["prewarmed"] : []),
        ].join(", "),
      }
    case "screen":
      return { title: `Screen ${signal.screen}` }
    case "event": {
      const properties = Object.entries(signal.properties ?? {})
        .map(([name, value]) => `${name}: ${propertyText(value)}`)
        .join(", ")
      return properties === "" ? { title: signal.name } : { title: signal.name, detail: properties }
    }
    case "metrickit":
      return {
        title: signal.report === "diagnostics" ? "MetricKit diagnostics" : "MetricKit metrics",
        ...(signal.report === "diagnostics"
          ? {
              detail: `${count(signal.crashes)} ${signal.crashes === 1 ? "crash" : "crashes"}, ${count(signal.hangs)} ${signal.hangs === 1 ? "hang" : "hangs"}`,
            }
          : {}),
      }
  }
}
