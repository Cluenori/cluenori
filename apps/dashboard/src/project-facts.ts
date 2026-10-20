// What the pages say about a project, worked out once from the API's answers: when a chart's columns
// are, what got slower, when failures jumped, which errors are new, and what needs attention. Pages
// show these; they don't work them out again. Every rule is pure: "now" is the time an answer
// covers up to, never the clock, so a page renders the same for the same answers.

import type { Period, ProjectKey } from "@cluenori/foundation"
import type {
  EndpointRow,
  EndpointTable,
  ErrorGroup,
  ErrorGroupId,
  ErrorTable,
  LogCounts,
  LogException,
  RequestPoint,
  RequestSeries,
  SeriesStep,
} from "@cluenori/signals"
import { stepMillis } from "@cluenori/signals"
import { DateTime } from "effect"

import { componentColor } from "@/lib/colors"
import { ago, axisTime, count, dayOf, duration, share, viewerTimeZone } from "@/lib/format"
import type { PeriodKey } from "@/project-data"
import type { Attention } from "@/views/attention-list"
import type { Slower } from "@/views/endpoint-table"
import { titleParts } from "@/views/error-group"

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
 * Requests over time as a chart's columns, over the period they cover. A step without a point had
 * nothing reported, which is not none (the sender may have been silent), so its column is unknown.
 */
export const requestColumnsOf = (series: RequestSeries, valueOf: (point: RequestPoint) => number) =>
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

// An endpoint got slower when its p95 over the last day is at least this many times its usual p95,
// over the 7 days before, and at least this much more. The second keeps a fast endpoint going from
// 2 ms to 4 ms from counting.
const slowerTimes = 1.5
const slowerByMs = 100

/** What "slower" means, for the pages that mark it. */
export const slowerMeaning = `Slower: p95 over the last day at least ${slowerTimes} times its p95 over the 7 days before, and at least ${duration(slowerByMs)} more.`

/** Whether something timed got slower; absent when it didn't, or is too new to have a usual p95. */
export const slowerOf = (row: { readonly lastDayP95Ms: number; readonly usualP95Ms?: number }): Slower | undefined => {
  const usual = row.usualP95Ms
  if (usual === undefined || row.lastDayP95Ms < usual * slowerTimes || row.lastDayP95Ms - usual < slowerByMs) {
    return undefined
  }
  return { p95Ms: row.lastDayP95Ms, usualP95Ms: usual }
}

/** An endpoint row's identity: its component, environment, and name. */
export const endpointKeyOf = (row: Pick<EndpointRow, "component" | "environment" | "endpoint">) =>
  [row.component, row.environment ?? "", row.endpoint].join("\u0000")

/** The endpoints over the last day and over the 7 days before: what "slower" compares. */
export type Compared = { readonly lastDay: EndpointTable; readonly usual: EndpointTable }

/** An endpoint's p95 over the last day, and its usual p95 when it had requests in the 7 days before. */
export const usualOf = (compared: Compared, key: string) => {
  const lastDay = compared.lastDay.rows.find((row) => endpointKeyOf(row) === key)
  const usual = compared.usual.rows.find((row) => endpointKeyOf(row) === key)
  return lastDay === undefined
    ? undefined
    : { lastDayP95Ms: lastDay.p95Ms, ...(usual === undefined ? {} : { usualP95Ms: usual.p95Ms }) }
}

/** Which endpoints got slower, by `endpointKeyOf`. An endpoint new this week has no verdict. */
export const slowerEndpoints = (compared: Compared): ReadonlyMap<string, Slower> =>
  new Map(
    compared.lastDay.rows.flatMap((row) => {
      const timed = usualOf(compared, endpointKeyOf(row))
      const slower = timed === undefined ? undefined : slowerOf(timed)
      return slower === undefined ? [] : [[endpointKeyOf(row), slower] as const]
    }),
  )

/** A table's endpoints, each with whether it got slower, as the endpoint table shows them. */
export const endpointRowsOf = (
  table: EndpointTable,
  compared: Compared,
): ReadonlyArray<EndpointRow & { readonly slower?: Slower }> => {
  const slower = slowerEndpoints(compared)
  return table.rows.map((row) => {
    const found = slower.get(endpointKeyOf(row))
    return found === undefined ? row : { ...row, slower: found }
  })
}

// ---- Errors ----------------------------------------------------------------------------------------

// An error group is new while its first occurrence is under a day old, and ongoing while its last
// is under 15 minutes old.
const recently = 15 * 60_000

/** New: first seen within the day before `now`. Ongoing: seen in the 15 minutes before it. */
export const statusOf = (group: ErrorGroup, now: number) => ({
  isNew: now - DateTime.toEpochMillis(group.firstSeen) < 86_400_000,
  ongoing: now - DateTime.toEpochMillis(group.lastSeen) < recently,
})

/** A frame of a stack: the function, where in the source when known, and whether it is the app's own. */
export type StackFrame = { readonly method: string; readonly place?: string; readonly ours: boolean }

/**
 * An exception's stack as frames, the throwing frame first; absent when it came without one. Frames
 * are read as .NET writes them, `at Method(Args) in /src/File.cs:line 48`. A frame with a source
 * location is the app's own code: libraries' frames come without one.
 */
export const framesOf = (exception: LogException | undefined): ReadonlyArray<StackFrame> | undefined => {
  if (exception?.stack === undefined) {
    return undefined
  }
  return exception.stack
    .split("\n")
    .filter((line) => line.trimStart().startsWith("at "))
    .map((line) => {
      const [method = "", place] = line.trim().slice(3).split(" in ")
      return place === undefined ? { method, ours: false } : { method, place, ours: true }
    })
}

// ---- Needs attention -------------------------------------------------------------------------------

// The sum of the columns whose values are known.
const knownSumOf = (values: ReadonlyArray<number | undefined>) => sumOf(values.map((value) => value ?? 0))

/**
 * When failures jumped: the step with the highest error rate, widened to neighboring steps with at
 * least a quarter of it, from the start of the first to the end of the last, or now. Absent unless that
 * window's error rate is at least 2% and three times the period's. A step with nothing reported
 * has no rate, so it never joins a window.
 */
export const failureSpikeOf = (series: RequestSeries) => {
  const asked = requestColumnsOf(series, (point) => point.requests)
  const failed = requestColumnsOf(series, (point) => point.errors)
  const rateAt = (index: number) => {
    const requests = asked.values[index]
    const errors = failed.values[index]
    return requests === undefined || errors === undefined ? 0 : errors / Math.max(1, requests)
  }
  const peak = asked.values.reduce<number>((best, _, index) => (rateAt(index) > rateAt(best) ? index : best), 0)
  let first = peak
  let last = peak
  while (first > 0 && rateAt(first - 1) >= rateAt(peak) / 4 && rateAt(first - 1) > 0) {
    first -= 1
  }
  while (last < asked.values.length - 1 && rateAt(last + 1) >= rateAt(peak) / 4 && rateAt(last + 1) > 0) {
    last += 1
  }
  const windowFailed = knownSumOf(failed.values.slice(first, last + 1))
  const windowAsked = knownSumOf(asked.values.slice(first, last + 1))
  const overall = knownSumOf(failed.values) / Math.max(1, knownSumOf(asked.values))
  const rate = windowFailed / Math.max(1, windowAsked)
  if (asked.values.length === 0 || rate < 0.02 || rate < 3 * overall) {
    return undefined
  }
  const end = endOf(series) ?? asked.from + asked.values.length * asked.step
  return {
    from: asked.from + first * asked.step,
    to: Math.min(asked.from + (last + 1) * asked.step, end),
    failed: windowFailed,
    requests: windowAsked,
  }
}

// The most slower, against its usual, first.
const byHowMuchSlower = (left: Slower, right: Slower) => right.p95Ms / right.usualP95Ms - left.p95Ms / left.usualP95Ms

/**
 * What needs attention in the project now, the worst first: errors happening now, a jump in
 * failures, new errors, then endpoints that got slower; an error both new and happening now is one
 * item. Each item is one click from its detail.
 * "Now" is the time the errors cover up to.
 */
export const attentionOf = (facts: {
  readonly project: ProjectKey
  readonly errors: ErrorTable
  readonly requests: RequestSeries
  readonly compared: Compared
}): ReadonlyArray<Attention> => {
  const { project } = facts
  const now = endOf(facts.errors)
  const spike = failureSpikeOf(facts.requests)
  const slowerByKey = slowerEndpoints(facts.compared)
  const slower = facts.compared.lastDay.rows
    .flatMap((row) => {
      const found = slowerByKey.get(endpointKeyOf(row))
      return found === undefined ? [] : [{ row, ...found }]
    })
    .toSorted(byHowMuchSlower)
  const errorRoute = (error: ErrorGroupId) => ({ page: "errors" as const, project, error })
  // Nothing of the period is kept when it has no end, so there are no errors to judge.
  const groups =
    now === undefined
      ? []
      : facts.errors.groups.map((group) => ({
          group,
          ...statusOf(group, now),
          firstSeen: ago(DateTime.toEpochMillis(group.firstSeen), now),
          lastSeen: ago(DateTime.toEpochMillis(group.lastSeen), now),
        }))
  return [
    ...groups
      .filter((entry) => entry.ongoing)
      .map(({ group, lastSeen, isNew }) => ({
        key: `ongoing ${group.id}`,
        tone: "failure" as const,
        title: `${titleParts(group).type} is ${isNew ? "new, and " : ""}happening right now`,
        detail: `${count(group.occurrences)} occurrences in the period, last ${lastSeen}`,
        action: { label: "Open the error", to: errorRoute(group.id) },
      })),
    ...(spike === undefined
      ? []
      : [
          {
            key: "spike",
            tone: "failure" as const,
            title: `Error rate ${share(spike.failed, spike.requests)} between ${axisTime(spike.from)} and ${axisTime(spike.to)}`,
            detail: `${count(spike.failed)} failed requests of ${count(spike.requests)}`,
            action: { label: "Open the errors", to: { page: "errors" as const, project } },
          },
        ]),
    ...groups
      .filter((entry) => entry.isNew && !entry.ongoing)
      .map(({ group, firstSeen }) => ({
        key: `new ${group.id}`,
        tone: "warning" as const,
        title: `${titleParts(group).type} is new`,
        detail: `First seen ${firstSeen}, ${count(group.occurrences)} occurrences since`,
        action: { label: "Open the error", to: errorRoute(group.id) },
      })),
    ...slower.map((entry) => ({
      key: `slower ${endpointKeyOf(entry.row)}`,
      tone: "warning" as const,
      title: `${entry.row.endpoint} got slower`,
      detail: `p95 ${duration(entry.p95Ms)} over the last day, usually ${duration(entry.usualP95Ms)}`,
      action: {
        label: "Open the endpoint",
        to: { page: "endpoint" as const, project, component: entry.row.component, endpoint: entry.row.endpoint },
      },
    })),
  ]
}
