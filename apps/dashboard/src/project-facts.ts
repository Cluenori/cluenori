// What the pages say about the projects, worked out once from the API's answers: what needs the
// founder now, how each project is, its people against last week, when a chart's columns are, what
// got slower, and which errors are new. Pages show these; they don't work them out again. Every rule
// is pure: "now" is the time an answer covers up to, never the clock, so a page renders the same for
// the same answers.

import type { CalendarDay, EnvironmentKey, Period, ProjectKey } from "@cluenori/foundation"
import type { Incident } from "@cluenori/incidents"
import type { ProjectSettings } from "@cluenori/projects"
import type { ReleaseChanges, ReleaseCommit, ReleaseSource, ReleaseSummary, StoreBuild } from "@cluenori/releases"
import type {
  Compared,
  OperationRow,
  OperationTable,
  KeptTraces,
  LogCounts,
  LogException,
  LoadPoint,
  LoadSeries,
  SeriesStep,
  Slower,
  SpanId,
  TraceSpan,
  TraceView,
} from "@cluenori/signals"
import { errorRule, operationKeyOf, slowerOperations, slowerRule, stepMillis } from "@cluenori/signals"
import { DateTime } from "effect"

import { componentColor } from "@/lib/colors"
import { ago, axisTime, count, dayOf, duration, lasting, share, viewerTimeZone } from "@/lib/format"
import type { PeriodKey, ProjectPulse, TodayItem, TodayList } from "@/project-data"
import { periodMillis, periods } from "@/project-data"
import type { Route } from "@/router"

export const sumOf = (values: ReadonlyArray<number>) => values.reduce((sum, value) => sum + value, 0)

export const periodWords: Readonly<Record<PeriodKey, string>> = {
  "1h": "Last hour",
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
}

// The viewer's time zone at `epochMillis` as a short name, such as GMT+2.
const zoneNameAt = (epochMillis: number) =>
  new Intl.DateTimeFormat(navigator.language, { timeZone: viewerTimeZone, timeZoneName: "short" })
    .formatToParts(epochMillis)
    .find((part) => part.type === "timeZoneName")?.value ?? viewerTimeZone

/** A component's color, by its place among its project's components: the same on every page. */
export const colorOf = (component: string, components: ReadonlyArray<string>) => componentColor(component, components)

// ---- Environments ----------------------------------------------------------------------------------

/**
 * The environments a project's pages offer, production first, and the one they show. A deployment
 * from before October 2026 says neither the project's settings nor its environments: it offers none.
 */
export type Environments = {
  /** The one every question asks about; absent where none is offered or named. */
  readonly shown?: EnvironmentKey
  /**
   * Those its telemetry named in the last 30 days, production first, then those its deploy targets
   * go to, with the one shown.
   */
  readonly offered: ReadonlyArray<EnvironmentKey>
  /** The project's production environments, seen lately or not. */
  readonly production: ReadonlyArray<EnvironmentKey>
}

/**
 * Which environment a project's page shows, and those it offers: the environments its telemetry
 * named lately, production first, then those its components' deploy targets go to, in their order.
 * It shows the one `chosen`, named by the address or picked before; else production, the first of
 * the project's production environments its telemetry named lately, else one a deploy target goes
 * to; else the first offered. While the project isn't known yet, pass `{}`.
 */
export const environmentsOf = (
  project: {
    readonly settings?: ProjectSettings
    readonly environments?: ReadonlyArray<EnvironmentKey>
    readonly components?: ReadonlyArray<{
      readonly deployTargets?: ReadonlyArray<{ readonly environment: EnvironmentKey }>
    }>
  },
  chosen: EnvironmentKey | undefined,
): Environments => {
  // A deployment that doesn't say its settings doesn't say environments either.
  const said = project.settings !== undefined
  const seen = said ? (project.environments ?? []) : []
  const targeted = said
    ? (project.components ?? []).flatMap((component) =>
        (component.deployTargets ?? []).map((target) => target.environment),
      )
    : []
  const known = [...new Set([...seen, ...targeted])]
  const production = project.settings?.productionEnvironments ?? []
  const shown =
    chosen ??
    production.find((environment) => seen.includes(environment)) ??
    production.find((environment) => known.includes(environment)) ??
    known[0]
  return {
    ...(shown === undefined ? {} : { shown }),
    offered: shown === undefined || known.includes(shown) ? known : [...known, shown],
    production,
  }
}

/**
 * Whether something of `environment` belongs on a page showing `environments`: anything, when it
 * shows none; else what is of the environment shown; and, when that is production, what doesn't
 * say its environment, which counts as production, as for alerts.
 */
export const isShownIn = (environments: Environments, environment: EnvironmentKey | undefined) =>
  environments.shown === undefined ||
  environment === environments.shown ||
  (environment === undefined && environments.production.includes(environments.shown))

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

// ---- Charts over time ------------------------------------------------------------------------------

/** The time an answer covers up to, which its rules measure "now" from; absent when nothing is kept. */
export const endOf = (answer: { readonly covered?: Period }) =>
  answer.covered === undefined ? undefined : DateTime.toEpochMillis(answer.covered.to)

/** The viewer's time zone, such as GMT+2, at the end of what an answer covers: the badge on its chart. */
export const zoneOf = (answer: { readonly covered?: Period }) => {
  const end = endOf(answer)
  return end === undefined ? undefined : zoneNameAt(end)
}

/** A chart's columns: when the first starts, how wide each is, and each one's value, if known. */
export type Columns = {
  readonly from: number
  readonly step: number
  readonly values: ReadonlyArray<number | undefined>
}

// Points as columns over the period covered, a step without a point given `absent`.
const columnsOf = <Point extends { readonly start: DateTime.Utc }>(
  covered: Period | undefined,
  step: SeriesStep,
  points: ReadonlyArray<Point>,
  valueOf: (point: Point) => number,
  absent: 0 | undefined,
): Columns => {
  const width = stepMillis[step]
  if (covered === undefined) {
    return { from: 0, step: width, values: [] }
  }
  const from = DateTime.toEpochMillis(covered.from)
  const to = DateTime.toEpochMillis(covered.to)
  const byStart = new Map(points.map((point) => [DateTime.toEpochMillis(point.start), point] as const))
  const first = from - (((from % width) + width) % width)
  const values = Array.from({ length: Math.max(0, Math.ceil((to - first) / width)) }, (_, index) => {
    const point = byStart.get(first + index * width)
    return point === undefined ? absent : valueOf(point)
  })
  return { from: first, step: width, values }
}

/**
 * The load over time as a chart's columns, over the period they cover. A step without a point had
 * nothing reported, which is not none (the sender may have been silent), so its column is unknown.
 */
export const loadColumnsOf = (series: LoadSeries, valueOf: (point: LoadPoint) => number) =>
  columnsOf(series.covered, series.step, series.points, valueOf, undefined)

/**
 * Warnings and errors over time as a chart's columns: the counts of the series with these keys
 * added up. A step without a point had none recorded, so its column is zero.
 */
export const logColumnsOf = (counts: LogCounts, keys: ReadonlyArray<string>) => {
  const kept = counts.series.filter((series) => keys.includes(series.key))
  const columns = kept.map((series) => columnsOf(counts.covered, counts.step, series.points, (point) => point.count, 0))
  const empty = columnsOf(counts.covered, counts.step, [], () => 0, 0)
  return {
    ...empty,
    values: empty.values.map((_, index) => sumOf(columns.map((column) => column.values[index] ?? 0))),
  }
}

/**
 * When each column of a chart starts, and how its axis names it: by day when the chart spans more
 * than two days, by time otherwise.
 */
export const columnTimesOf = (columns: Columns) => {
  const startOf = (column: number) => columns.from + column * columns.step
  const showsDays = columns.step * columns.values.length > 2 * 86_400_000
  return {
    startOf,
    whenOf: (column: number) => (showsDays ? dayOf(startOf(column)) : axisTime(startOf(column))),
  }
}

/** Four evenly spaced columns of a chart, to label its axis with. */
export const ticksOf = (columns: Columns) => {
  const { whenOf } = columnTimesOf(columns)
  return [0, 1, 2, 3].map((quarter) => {
    const column = Math.floor((quarter * columns.values.length) / 4)
    return { column, label: whenOf(column) }
  })
}

// ---- Slower than usual -----------------------------------------------------------------------------

/** What "slower" means, for the pages that mark it. */
export const slowerMeaning = `Slower: p95 over the last day at least ${slowerRule.times} times its p95 over the 7 days before, and at least ${duration(slowerRule.byMs)} more.`

/** A table's operations, each with whether it got slower, as the operation table shows them. */
export const operationRowsOf = (
  table: OperationTable,
  compared: Compared,
): ReadonlyArray<OperationRow & { readonly slower?: Slower }> => {
  const slower = slowerOperations(compared)
  return table.rows.map((row) => {
    const found = slower.get(operationKeyOf(row))
    return found === undefined ? row : { ...row, slower: found }
  })
}

// ---- Kept traces -------------------------------------------------------------------------------

/**
 * What a list of kept traces answers for, in words: the page's period, or, of a period longer than
 * traces are kept, the days its answer covers, such as "last 14 days".
 */
export const keptOverOf = (answer: KeptTraces, period: PeriodKey) => {
  const asked = periodWords[period].toLowerCase()
  if (answer.covered === undefined) {
    return asked
  }
  const covered = DateTime.toEpochMillis(answer.covered.to) - DateTime.toEpochMillis(answer.covered.from)
  // A covered period is in whole minutes, so only one cut to what is kept is a minute or more shorter.
  return covered < periodMillis[period] - 60_000 ? `last ${count(Math.round(covered / 86_400_000))} days` : asked
}

// ---- Errors ----------------------------------------------------------------------------------------

/** A frame of a stack: the function, where in the source when known, and whether it is the app's own. */
export type StackFrame = { readonly method: string; readonly place?: string; readonly ours: boolean }

/** One exception of a chain: its type, what it said, and its frames, the throwing one first. */
export type ThrownException = {
  readonly type: string
  readonly message: string
  readonly frames: ReadonlyArray<StackFrame>
}

// A frame as .NET writes it, `at Method(Args) in /src/File.cs:line 48`. One with a source location is
// the app's own code: libraries' frames come without one.
const frameOf = (line: string): StackFrame => {
  const [method = "", place] = line.trim().slice(3).split(" in ")
  return place === undefined ? { method, ours: false } : { method, place, ours: true }
}

// The first line of an exception as .NET writes it, `Type (0x80004005): message`.
const headerOf = (line: string) => {
  const match = /^(\S+?)(?: \(0x[0-9A-Fa-f]+\))?: (.*)$/.exec(line.trim())
  return match === null ? { type: line.trim(), message: "" } : { type: match[1] ?? "", message: match[2] ?? "" }
}

/**
 * An exception and the ones inside it, outermost first, read from its stack as .NET writes it
 * (`Exception.ToString()`): each inner exception's header starts with `--->`, the innermost's frames
 * come first, and `--- End of inner exception stack trace ---` ends each one's. The outermost's type
 * and message are the record's own. Without a stack, it is one exception without frames.
 * Not handled: an `AggregateException`'s several inner exceptions, read as one chain, and Java's
 * `Caused by:`, read as frames of one exception.
 */
export const exceptionsOf = (exception: LogException): ReadonlyArray<ThrownException> => {
  if (exception.stack === undefined) {
    return [{ type: exception.type, message: exception.message, frames: [] }]
  }
  const headers: Array<{ type: string; message: string }> = []
  const sections: Array<Array<StackFrame>> = [[]]
  for (const line of exception.stack.split("\n")) {
    const trimmed = line.trim()
    if (trimmed.startsWith("--->")) {
      headers.push(headerOf(trimmed.slice(4)))
    } else if (trimmed.startsWith("at ")) {
      sections.at(-1)?.push(frameOf(trimmed))
    } else if (trimmed === "--- End of inner exception stack trace ---") {
      sections.push([])
    } else if (trimmed.startsWith("--- ") || trimmed === "") {
      // An async boundary, such as `--- End of stack trace from previous location ---`, or a gap.
    } else if (headers.length === 0) {
      headers.push(headerOf(trimmed))
    } else if (sections.every((section) => section.length === 0)) {
      // A message of several lines, before the first frame.
      const last = headers.at(-1)
      if (last !== undefined) {
        last.message = `${last.message}\n${trimmed}`
      }
    }
  }
  // The outermost is the record's own exception: its type and whole message, as sent.
  const chain = [{ type: exception.type, message: exception.message }, ...headers.slice(1)]
  // The first section is the innermost exception's; each one after it, the next one out's.
  return chain.map((thrown, index) => ({
    type: thrown.type,
    message: thrown.message,
    frames: sections[chain.length - 1 - index] ?? [],
  }))
}

/**
 * The operation a log record was written in, from its trace: the server or consumer span it, or the
 * span it was written in, belongs to; else the trace's first span. Absent when the trace has none.
 */
export const operationSpanOf = (view: TraceView, span: SpanId | undefined): TraceSpan | undefined => {
  const byId = new Map(view.spans.map((entry) => [entry.span, entry] as const))
  let current = span === undefined ? undefined : byId.get(span)
  while (current !== undefined && current.kind !== "server" && current.kind !== "consumer") {
    current = current.parent === undefined ? undefined : byId.get(current.parent)
  }
  return current ?? view.spans[0]
}

// ---- Needs you -------------------------------------------------------------------------------------

// "1 occurrence", "36 occurrences".
const occurrencesText = (occurrences: number) =>
  `${count(occurrences)} ${occurrences === 1 ? "occurrence" : "occurrences"}`

/** Where an incident leads: its own page, which shows its life and links to what it is about. */
export const incidentActionOf = (project: ProjectKey, incident: Incident) => ({
  label: "Open the incident",
  to: { page: "incident" as const, project, incident: incident.id },
})

/** What found an incident, in a word: "Down", "Failing", "Stopped". */
export const detectorWords: Readonly<Record<Incident["evidence"]["_tag"], string>> = {
  down: "Down",
  failing: "Failing",
  stopped: "Stopped",
}

/**
 * What an incident's detector saw, in a line: "2 checks failed in a row, the last: HTTP 503",
 * "18% of 412 failed in the last 15 minutes, usually 0.1%", "Last ran 2 hours ago, usually every
 * 5 min". `now` is what "ago" is measured from.
 */
export const evidenceWords = (evidence: Incident["evidence"], now: number) => {
  switch (evidence._tag) {
    case "down":
      return `${count(evidence.failures)} checks failed in a row, the last: ${evidence.problem}`
    case "failing":
      return `${share(evidence.failed, evidence.count)} of ${count(evidence.count)} failed in the last 15 minutes, usually ${share(evidence.usualRate, 1)}`
    case "stopped":
      return `Last ran ${ago(DateTime.toEpochMillis(evidence.lastRanAt), now)}, usually every ${duration(evidence.usualGapMs)}`
  }
}

/**
 * One thing that needs the founder now, as Now and a project's page show it: what kind of thing, of
 * which project, what it is, a line of evidence, when, and the page that shows it.
 */
export type NeedsYou = {
  readonly key: string
  /** The kind of thing, in a word or two: "Down", "New error", "Slower", "Release". */
  readonly kind: string
  /** Red for what fails now, yellow for what to look at, purple for a release waiting for a member. */
  readonly tone: "failure" | "warning" | "release"
  readonly project: ProjectKey
  readonly title: string
  readonly detail: string
  /** When it started or was last seen, as a person says it: "12 minutes ago"; absent when unknown. */
  readonly when?: string
  readonly to: Route
}

/**
 * What a quiet operation's hint says, worded as the guess it is: "Usually runs about every 31
 * minutes; nothing for 3 hours. Maybe fine: Cluenori guessed this from its history."
 */
export const quietWords = (quiet: { readonly usualGapMs: number; readonly lastRanAt: DateTime.Utc }, now: number) =>
  `Usually runs about every ${lasting(quiet.usualGapMs)}; nothing for ${lasting(now - DateTime.toEpochMillis(quiet.lastRanAt))}. Maybe fine: Cluenori guessed this from its history`

// One of Today's items as a row; its times are measured from when Today looked.
const todayRowOf = (item: TodayItem, now: number): NeedsYou => {
  switch (item._tag) {
    case "incident": {
      const { incident } = item
      const acknowledged = incident.acknowledgedAt !== undefined
      return {
        key: `incident ${incident.id}`,
        kind: detectorWords[incident.evidence._tag],
        tone: acknowledged ? "warning" : "failure",
        project: item.project,
        title: incident.subject,
        detail: `${evidenceWords(incident.evidence, now)}${acknowledged ? "; acknowledged" : ""}`,
        when: ago(DateTime.toEpochMillis(incident.openedAt), now),
        to: incidentActionOf(item.project, incident).to,
      }
    }
    case "error": {
      const { error } = item
      const firstSeen = ago(DateTime.toEpochMillis(error.firstSeen), now)
      return {
        key: `error ${item.project} ${error.id}`,
        kind: item.ongoing ? "Happening now" : "New error",
        tone: item.ongoing ? "failure" : "warning",
        project: item.project,
        title: error.title,
        detail: `${occurrencesText(error.occurrences)} in the last day, ${error.lastComponent}${item.isNew && item.ongoing ? `; new, first seen ${firstSeen}` : ""}`,
        when: item.ongoing ? ago(DateTime.toEpochMillis(error.lastSeen), now) : firstSeen,
        to: {
          page: "error",
          project: item.project,
          ...(error.lastEnvironment === undefined ? {} : { environment: error.lastEnvironment }),
          error: error.id,
        },
      }
    }
    case "slower":
      return {
        key: `slower ${item.project} ${item.component} ${item.environment ?? ""} ${item.operation}`,
        kind: "Slower",
        tone: "warning",
        project: item.project,
        title: item.operation,
        detail: `p95 ${duration(item.p95Ms)} over the last day, usually ${duration(item.usualP95Ms)}; ${item.component}`,
        to: {
          page: "operation",
          project: item.project,
          component: item.component,
          ...(item.environment === undefined ? {} : { environment: item.environment }),
          operation: item.operation,
        },
      }
    case "quiet":
      return {
        key: `quiet ${item.project} ${item.component} ${item.environment ?? ""} ${item.operation}`,
        kind: "Quiet, a guess",
        tone: "warning",
        project: item.project,
        title: item.operation,
        detail: `${quietWords(item, now)}; ${item.component}`,
        when: ago(DateTime.toEpochMillis(item.lastRanAt), now),
        to: {
          page: "operation",
          project: item.project,
          component: item.component,
          ...(item.environment === undefined ? {} : { environment: item.environment }),
          operation: item.operation,
        },
      }
    case "silent": {
      const last = item.lastDataAt === undefined ? undefined : ago(DateTime.toEpochMillis(item.lastDataAt), now)
      return {
        key: `silent ${item.project}`,
        kind: "Silent",
        tone: "warning",
        project: item.project,
        title: "Nothing sent in the last day",
        detail: last === undefined ? "Nothing in the 7 days before it either" : `The last data came ${last}`,
        ...(last === undefined ? {} : { when: last }),
        to: { page: "tech", project: item.project },
      }
    }
    case "promotion": {
      const ended = item.endedAt === undefined ? undefined : DateTime.toEpochMillis(item.endedAt)
      return {
        key: `promotion ${item.promotion}`,
        kind: "Release",
        // One waiting for a member is a release's purple; one that ended without getting there failed.
        tone: item.state === "approved" || item.state === "waiting" ? "release" : "failure",
        project: item.project,
        ...promotionWords(item),
        when: ago(ended ?? DateTime.toEpochMillis(item.startedAt), now),
        to: releaseRouteOf(item.project, item),
      }
    }
  }
}

/**
 * What a promotion that needs a member is, in plain words: what happened, and what to do;
 * "2.5.0+318 passed App Store review", "notes-ios to production: release it when you're ready".
 */
export const promotionWords = (
  item: Extract<TodayItem, { readonly _tag: "promotion" }>,
): { readonly title: string; readonly detail: string } => {
  const { release, component, environment } = item
  switch (item.state) {
    case "approved":
      return {
        title: `${release} passed App Store review`,
        detail: `${component} to ${environment}: release it when you're ready`,
      }
    case "waiting":
      return {
        title: `${release} waits for approval on GitHub`,
        detail: `${component} to ${environment}: approve the environment on GitHub to go on`,
      }
    case "failed":
      return {
        title: `Promoting ${release} to ${environment} failed`,
        detail: `${component}: its workflow or its build failed, and nothing has reached ${environment} since`,
      }
    case "rejected":
      return {
        title: `${release} was rejected in App Store review`,
        detail: `${component}: change what Apple asked for, then send a new build to ${environment}`,
      }
    case "lost":
      return {
        title: `Promoting ${release} to ${environment} couldn't be followed`,
        detail: `${component}: no run or build turned up in time; GitHub or App Store Connect has what happened`,
      }
  }
}

/**
 * What needs the founder now, the most urgent first: Today's items in Today's order, of the
 * environments each project calls production, the releases that need a member among them.
 */
export const needsYouOf = (today: TodayList): ReadonlyArray<NeedsYou> => {
  const now = DateTime.toEpochMillis(today.at)
  return today.items.map((item) => todayRowOf(item, now))
}

// ---- A project's pulse: its last day, and its people ------------------------------------------------

const hourMs = 3_600_000

/**
 * A project's last 24 hours, from its pulse: how many ran, and failed, each hour, and in all; and the
 * viewer's time zone then, which its hours are named in.
 */
export type DayLoad = {
  readonly ran: Columns
  readonly failed: Columns
  readonly total: number
  readonly failures: number
  readonly zone: string
}

/**
 * A project's last 24 hours of load, from its pulse, as a chart's columns: the hour Today looked in
 * and the 23 before it. An hour the pulse doesn't list had nothing reported, which isn't none, so its
 * column is unknown.
 */
export const dayLoadOf = (pulse: ProjectPulse, at: DateTime.Utc): DayLoad => {
  const from = Math.floor(DateTime.toEpochMillis(at) / hourMs) * hourMs - 23 * hourMs
  const byStart = new Map(pulse.load.map((hour) => [DateTime.toEpochMillis(hour.start), hour] as const))
  const hours = Array.from({ length: 24 }, (_, index) => byStart.get(from + index * hourMs))
  return {
    ran: { from, step: hourMs, values: hours.map((hour) => hour?.count) },
    failed: { from, step: hourMs, values: hours.map((hour) => hour?.errors) },
    total: sumOf(pulse.load.map((hour) => hour.count)),
    failures: sumOf(pulse.load.map((hour) => hour.errors)),
    zone: zoneNameAt(DateTime.toEpochMillis(at)),
  }
}

/** People counted on one UTC day and on the same day a week before; either absent when not counted. */
export type PeopleCount = { readonly value?: number; readonly weekBefore?: number }

/**
 * The project's apps' daily and monthly people on the latest whole UTC day, each beside the same day
 * a week before.
 */
export type People = { readonly day: CalendarDay; readonly daily: PeopleCount; readonly monthly: PeopleCount }

const peopleCountOf = (value: number | undefined, weekBefore: number | undefined): PeopleCount => ({
  ...(value === undefined ? {} : { value }),
  ...(weekBefore === undefined ? {} : { weekBefore }),
})

/**
 * Daily and monthly people from a project's pulse: on the latest whole UTC day, and the same day a
 * week before. A day not counted is unknown, never none; so is a month that reaches before the apps
 * first sent.
 */
export const peopleOf = (people: NonNullable<ProjectPulse["people"]>): People => ({
  day: people.latest.day,
  daily: peopleCountOf(people.latest.people, people.weekBefore?.people),
  monthly: peopleCountOf(people.latest.monthPeople, people.weekBefore?.monthPeople),
})

/**
 * How much a count moved since the week before, as a share of it: 0.06 for 6% more. Undefined when
 * either is unknown, or the week before had none, which nothing compares to.
 */
export const changeOf = (people: PeopleCount) =>
  people.value === undefined || people.weekBefore === undefined || people.weekBefore === 0
    ? undefined
    : people.value / people.weekBefore - 1

// ---- Releases --------------------------------------------------------------------------------------

/** A release is live while it ran in the last 15 minutes: the window an error is happening now in. */
export const liveForMs = errorRule.ongoingForMs

/** When a release ran: from the start of the first minute it ran in to the end of the last. */
export type Ran = { readonly firstSeen: DateTime.Utc; readonly lastSeen: DateTime.Utc }

/** When a release ran, or absent for one without telemetry, which hasn't run as far as anyone can tell. */
export const ranOf = (release: ReleaseSummary): Ran | undefined =>
  release.firstSeen === undefined || release.lastSeen === undefined
    ? undefined
    : { firstSeen: release.firstSeen, lastSeen: release.lastSeen }

/**
 * Whether a release still runs: it ran within `liveForMs` of `asOf`, the time its answer is of. One
 * without telemetry doesn't.
 */
export const isLive = (release: ReleaseSummary, asOf: DateTime.Utc) =>
  release.lastSeen !== undefined && DateTime.toEpochMillis(asOf) - DateTime.toEpochMillis(release.lastSeen) < liveForMs

/**
 * The shortest period that covers a release from when it first ran to `asOf`, so a page filtered to
 * it shows all of it, in the finest steps that do; the longest period when none covers it all.
 */
export const periodCovering = (firstSeen: DateTime.Utc, asOf: DateTime.Utc): PeriodKey => {
  const span = DateTime.toEpochMillis(asOf) - DateTime.toEpochMillis(firstSeen)
  return periods.find((period) => periodMillis[period.key] >= span)?.key ?? "90d"
}

/** How a verdict reads: worse is a warning, better is good news, the rest says there is no news. */
export type VerdictTone = "warning" | "better" | "quiet"

// "1 new error", "2 new errors".
const counted = (value: number, one: string, many: string) => `${count(value)} ${value === 1 ? one : many}`

/**
 * How a release compares with the one before it, in words, with what "worse" counts:
 * "Worse: 2 slower, 1 new error", "About the same", "Too early to tell".
 */
export const verdictOf = (release: ReleaseSummary): { readonly words: string; readonly tone: VerdictTone } => {
  switch (release.verdict) {
    case "worse": {
      const counts = [
        ...(release.slower > 0 ? [`${count(release.slower)} slower`] : []),
        ...(release.failingMore > 0 ? [counted(release.failingMore, "fails more", "fail more")] : []),
        ...(release.newErrors > 0 ? [counted(release.newErrors, "new error", "new errors")] : []),
      ]
      return { words: counts.length === 0 ? "Worse" : `Worse: ${counts.join(", ")}`, tone: "warning" }
    }
    case "better":
      return { words: "Better", tone: "better" }
    case "same":
      return { words: "About the same", tone: "quiet" }
    case "tooEarly":
      return { words: "Too early to tell", tone: "quiet" }
    case "first":
      return { words: "First release counted", tone: "quiet" }
    case "unmeasured":
      return { words: "No telemetry yet", tone: "quiet" }
  }
}

/** What a release's commit is called: its tag, else the first 7 characters of its SHA, as GitHub shortens it. */
export const commitNameOf = (commit: Pick<ReleaseCommit, "sha" | "tag">) => commit.tag ?? commit.sha.slice(0, 7)

/** Each source of releases by its name. */
export const sourceWords: Readonly<Record<ReleaseSource, string>> = {
  github: "GitHub",
  appStoreConnect: "App Store Connect",
}

/**
 * Apple's word for a state as a person reads it: `IN_BETA_TESTING` is "In beta testing". Words that
 * aren't one of Apple's constants are kept as they are.
 */
export const appleWords = (state: string) =>
  /^[A-Z][A-Z_]*$/.test(state) ? `${state.slice(0, 1)}${state.slice(1).toLowerCase().replaceAll("_", " ")}` : state

// How many days a phased release takes: Apple's, 7.
const phasedDays = 7

/**
 * Where an app's build stands, in words: "In TestFlight", "In review", "Phased release, day 3 of 7",
 * "On the App Store"; `failed` when Apple failed or rejected it, which is said in red.
 */
export const storeStageOf = (build: StoreBuild): { readonly words: string; readonly failed: boolean } => {
  switch (build.stage) {
    case "processing":
      return { words: "Processing", failed: false }
    case "failed":
      return { words: "Failed processing", failed: true }
    case "testing":
      return { words: "In TestFlight", failed: false }
    case "waitingForReview":
      return { words: "Waiting for review", failed: false }
    case "inReview":
      return { words: "In review", failed: false }
    case "rejected":
      return { words: "Rejected in review", failed: true }
    case "pendingRelease":
      return { words: "Approved, waiting for release", failed: false }
    case "releasing": {
      const phased = build.phasedRelease
      const paused = phased?.state === "PAUSED" ? " paused" : ""
      const day = phased?.day === undefined ? "" : `, day ${count(phased.day)} of ${count(phasedDays)}`
      return { words: `Phased release${paused}${day}`, failed: false }
    }
    case "live":
      return { words: "On the App Store", failed: false }
    case "replaced":
      return { words: "Replaced by a later build", failed: false }
    case "expired":
      return { words: "Expired in TestFlight", failed: false }
    case "other":
      return {
        words: build.appStoreState === undefined ? "In a state Cluenori doesn't know" : appleWords(build.appStoreState),
        failed: false,
      }
  }
}

/**
 * How much changed since the release before, as far as it is known: "12 commits, 34 files,
 * +820 −112"; from a deploy report alone, only its commits.
 */
export const changesCountOf = (changes: ReleaseChanges) =>
  [
    counted(changes.totalCommits, "commit", "commits"),
    ...(changes.filesChanged === undefined ? [] : [counted(changes.filesChanged, "file", "files")]),
    ...(changes.additions === undefined || changes.deletions === undefined
      ? []
      : [`+${count(changes.additions)} −${count(changes.deletions)}`]),
  ].join(", ")

/** A release's own page: by its component and version, and its environment when it has one. */
export const releaseRouteOf = (
  project: ProjectKey,
  release: Pick<ReleaseSummary, "component" | "release" | "environment">,
): Route => ({
  page: "release",
  project,
  component: release.component,
  release: release.release,
  ...(release.environment === undefined ? {} : { environment: release.environment }),
})
