// What the pages say about a project, computed once from its data: what each component is (an
// app or a backend), who asked its backend, how healthy each app is, when failures jumped, what got
// slower, and what needs attention. Pages show these; they don't work them out again.

import { componentColor } from "@/lib/colors"
import { ago, axisTime, count, dayOf, duration, share, viewerTimeZone } from "@/lib/format"
import type {
  EndpointRow,
  AppStart,
  ErrorGroup,
  PeriodKey,
  Platform,
  RequestColumns,
  RequestRow,
  ScreenRow,
  StackFrame,
} from "@/sample/sample-project"
import {
  appSessionsHourly,
  columnCount,
  appStarts,
  endpointTable,
  errorGroups,
  errorStacks,
  appStacks,
  networkCalls,
  requestColumns,
  sampleComponents,
  screenTable,
  sampleNow,
  sampleTrace,
  slowAndFailedRequests,
} from "@/sample/sample-project"
import type { Attention } from "@/views/attention-list"
import type { Slower } from "@/views/endpoint-table"
import { titleParts } from "@/views/error-group"

// The project's data. It comes from the sample until the dashboard reads the public API; this file
// is the one that knows where data comes from, so pages and views ask it, never the sample.
export {
  appStartColumns,
  endpointColumns,
  errorGroups,
  logLines,
  periods,
  requestColumns,
  sampleNow as now,
  sampleProjects as projects,
  webVitals,
} from "@/sample/sample-project"

// An error group is new while its first occurrence is under a day old, and ongoing while its last
// is under 15 minutes old.
const recently = 15 * 60_000

/** New: first seen within the last day. Ongoing: seen in the last 15 minutes. */
export const statusOf = (group: ErrorGroup) => ({
  isNew: sampleNow - group.firstSeen < 86_400_000,
  ongoing: sampleNow - group.lastSeen < recently,
})

/** A request's trace by its ID; the sample has one trace, which every ID opens. */
export const traceOf = (trace: string) => ({ ...sampleTrace, trace })

export const sumOf = (values: ReadonlyArray<number>) => values.reduce((sum, value) => sum + value, 0)

export const periodWords: Readonly<Record<PeriodKey, string>> = {
  "1h": "Last hour",
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
}

/** The viewer's time zone as a short name, such as GMT+2, for the badge on charts of time. */
export const zoneName =
  new Intl.DateTimeFormat(navigator.language, { timeZone: viewerTimeZone, timeZoneName: "short" })
    .formatToParts(sampleNow)
    .find((part) => part.type === "timeZoneName")?.value ?? viewerTimeZone

/**
 * What a component is: an app runs on people's devices and has sessions, crashes, and screens; a
 * backend runs on servers and answers requests. Its platform decides it, and it decides what each
 * page shows of the component.
 */
export type ComponentRole = "app" | "backend"

const roleOfPlatform: Readonly<Record<Platform, ComponentRole>> = {
  ios: "app",
  android: "app",
  browser: "app",
  dotnet: "backend",
  node: "backend",
}

/** A platform as people say it. */
export const platformWords: Readonly<Record<Platform, string>> = {
  ios: "iOS app",
  android: "Android app",
  browser: "Web app",
  dotnet: ".NET backend",
  node: "Node.js backend",
}

const componentOf = (component: string) => sampleComponents.find((entry) => entry.key === component)

export const platformOf = (component: string): Platform => componentOf(component)?.platform ?? "dotnet"

export const roleOf = (component: string): ComponentRole => roleOfPlatform[platformOf(component)]

/** Whether anything has arrived from the component yet; an app sends nothing until it has the SDK. */
export const isReceiving = (component: string) => componentOf(component)?.receiving ?? false

/** The project's components, the backend first. */
export const components: ReadonlyArray<string> = sampleComponents.map((entry) => entry.key)

export const colorOf = (component: string) => componentColor(component, components)

/** The project's backend: the component whose requests are counted. */
export const backend = components.find((component) => roleOf(component) === "backend") ?? "folio-api"

/** An origin's name and color: an app of the project, or Other, in gray, for requests that name none. */
export const originLabel = (origin: string | undefined) =>
  origin === undefined || roleOf(origin) === "backend" ? "Other" : platformWords[platformOf(origin)]
export const originColor = (origin: string | undefined) =>
  origin === undefined ? "var(--muted-foreground)" : colorOf(origin)

// What makes an app's stacks readable, by platform; a .NET backend sends readable stacks.
const symbolFiles: Readonly<Record<Platform, string | undefined>> = {
  ios: "dSYM files",
  android: "R8 mapping files",
  browser: "source maps",
  dotnet: undefined,
  node: "source maps",
}

/** The one step that gets a component sending, for one that has sent nothing yet. */
export const setUpStepOf = (component: string) => {
  const platform = platformOf(component)
  const symbols = symbolFiles[platform]
  if (roleOf(component) === "backend") {
    return `Point ${component}'s OpenTelemetry exporter at Cluenori with its ingest key.`
  }
  return `Add the Cluenori SDK to ${component} and ship a release with it${symbols === undefined ? "." : `; upload its ${symbols} from your release pipeline, so its stacks are readable.`}`
}

/**
 * An app's health over the last day: its sessions and the ones a crash ended, in each hour and in
 * all. A crash is an error that ended the app: on a phone it closed, in a browser it was not
 * handled. Absent for a backend, and for an app that sends nothing.
 */
export const appHealthOf = (component: string) => {
  const sessionsHourly = appSessionsHourly(component)
  if (sessionsHourly === undefined) {
    return undefined
  }
  const crashGroups = errorGroups.filter((group) => group.lastComponent === component && group.crash)
  const crashesHourly = sessionsHourly.map((_, index) => sumOf(crashGroups.map((group) => group.hourly[index] ?? 0)))
  return {
    sessionsHourly,
    crashesHourly,
    sessions: sumOf(sessionsHourly),
    crashed: sumOf(crashesHourly),
  }
}

// A .NET stack as text, one frame a line: "at Method(Args) in /src/File.cs:line 48".
const dotnetFrames = (stack: string): ReadonlyArray<StackFrame> =>
  stack
    .split("\n")
    .filter((line) => line.trimStart().startsWith("at "))
    .map((line) => {
      const [method = "", place] = line.trim().slice(3).split(" in ")
      return { method, ...(place === undefined ? {} : { place }), ours: method.startsWith("Folio.") }
    })

/** An error's stack as frames, the throwing frame first; absent when none came with it. */
export const stackOf = (group: ErrorGroup): ReadonlyArray<StackFrame> | undefined => {
  const app = appStacks[group.id]
  if (app !== undefined) {
    return app
  }
  const text = errorStacks[group.id]
  return text === undefined ? undefined : dotnetFrames(text)
}

// Something timed, an endpoint, a screen, or an app's start, got slower when its p95 over the last
// day is at least this many times its usual p95, over the 7 days before, and at least this much
// more. The second keeps a fast endpoint going from 2 ms to 4 ms from counting.
const slowerTimes = 1.5
const slowerByMs = 100

/** What "slower" means, for the pages that mark it. */
export const slowerMeaning = `Slower: p95 over the last day at least ${slowerTimes} times its p95 over the 7 days before, and at least ${duration(slowerByMs)} more.`

/** Whether something timed got slower lately; absent when it didn't, or is too new to have a usual p95. */
export const slowerOf = (row: { readonly lastDayP95Ms: number; readonly usualP95Ms?: number }): Slower | undefined => {
  const usual = row.usualP95Ms
  if (usual === undefined || row.lastDayP95Ms < usual * slowerTimes || row.lastDayP95Ms - usual < slowerByMs) {
    return undefined
  }
  return { p95Ms: row.lastDayP95Ms, usualP95Ms: usual }
}

/** The backend's endpoints over the period, each with whether it got slower lately. */
export const endpointsOf = (period: PeriodKey): ReadonlyArray<EndpointRow & { readonly slower?: Slower }> =>
  endpointTable(period).rows.map((row) => {
    const slower = slowerOf(row)
    return slower === undefined ? row : { ...row, slower }
  })

/** An app's screens over the period, the most shown first, each with whether it got slower. */
export const screensOf = (
  component: string,
  period: PeriodKey,
): ReadonlyArray<ScreenRow & { readonly slower?: Slower }> =>
  screenTable(component, period).map((row) => {
    const slower = slowerOf(row)
    return slower === undefined ? row : { ...row, slower }
  })

/** A phone app's cold start, with whether it got slower; absent for a browser app or a backend. */
export const appStartOf = (component: string): (AppStart & { readonly slower?: Slower }) | undefined => {
  const start = appStarts[component]
  if (start === undefined) {
    return undefined
  }
  const slower = slowerOf(start)
  return slower === undefined ? start : { ...start, slower }
}

/**
 * The backend endpoints an app called over the period, the most called first: their p95 from the
 * app, network included, beside their p95 at the backend; the rest is the network and the app.
 */
export const networkCallsOf = (component: string, period: PeriodKey) => {
  const atBackend = endpointsOf(period)
  return networkCalls(component, period).map((row) => {
    const served = atBackend.find((entry) => entry.endpoint === row.endpoint)
    return served === undefined ? row : { ...row, backendP95Ms: served.p95Ms }
  })
}

/** A request worth opening; `slow` when it took longer than its endpoint's p95 that day. */
export type KeptRequest = RequestRow & { readonly slow: boolean }

export const failedRequest = (row: RequestRow) => row.status >= 500

const lastDayEndpoints = endpointsOf("24h")

// The requests the backend kept from the last day, newest first.
const keptRequests: ReadonlyArray<KeptRequest> = slowAndFailedRequests.map((row) => {
  const endpoint = lastDayEndpoints.find((entry) => entry.endpoint === row.endpoint)
  return { ...row, slow: endpoint !== undefined && row.durationMs > endpoint.lastDayP95Ms }
})

/** One endpoint's requests of the last day worth opening, newest first: its slowest, and failed ones. */
export const requestsOf = (endpoint: string) => keptRequests.filter((row) => row.endpoint === endpoint)

/**
 * The backend's requests of the last day worth opening, newest first: failed ones, and slow ones of
 * endpoints that got slower. The slowest of an endpoint that is as usual are on its own page.
 */
export const requestsToOpen: ReadonlyArray<KeptRequest> = keptRequests.filter(
  (row) =>
    failedRequest(row) ||
    (row.slow && lastDayEndpoints.some((entry) => entry.endpoint === row.endpoint && entry.slower !== undefined)),
)

/**
 * When each column of a chart of requests starts, and how its axis names it: by day when the
 * period is longer than two days, by time otherwise.
 */
export const columnTimesOf = (columns: { readonly from: number; readonly step: number }) => {
  const startOf = (column: number) => columns.from + column * columns.step
  const showsDays = columns.step * columnCount > 2 * 86_400_000
  return {
    startOf,
    whenOf: (column: number) => (showsDays ? dayOf(startOf(column)) : axisTime(startOf(column))),
  }
}

/**
 * When failures jumped: the column with the highest error rate, widened to neighbors with at least
 * a quarter of it. Absent unless that window's error rate is at least 2% and three times the
 * period's.
 */
export const failureSpikeOf = (columns: RequestColumns) => {
  const askedAt = (index: number) => columns.rows.reduce((sum, row) => sum + (row.values[index] ?? 0), 0)
  const rateAt = (index: number) => (columns.failed[index] ?? 0) / Math.max(1, askedAt(index))
  const peak = columns.failed.reduce((best, _, index) => (rateAt(index) > rateAt(best) ? index : best), 0)
  let first = peak
  let last = peak
  while (first > 0 && rateAt(first - 1) >= rateAt(peak) / 4) {
    first -= 1
  }
  while (last < columns.failed.length - 1 && rateAt(last + 1) >= rateAt(peak) / 4) {
    last += 1
  }
  const failed = sumOf(columns.failed.slice(first, last + 1))
  const requests = sumOf(columns.rows.flatMap((row) => row.values.slice(first, last + 1)))
  const overall = sumOf(columns.failed) / Math.max(1, sumOf(columns.rows.flatMap((row) => row.values)))
  const rate = failed / Math.max(1, requests)
  if (rate < 0.02 || rate < 3 * overall) {
    return undefined
  }
  return { from: columns.from + first * columns.step, to: columns.from + (last + 1) * columns.step, failed, requests }
}

// The most slower, against its usual, first.
const byHowMuchSlower = (left: Slower, right: Slower) => right.p95Ms / right.usualP95Ms - left.p95Ms / left.usualP95Ms

/**
 * What needs attention in the project now, the worst first: failing errors, a jump in failures,
 * new crashes, then new errors, then what got slower, endpoints before screens.
 */
export const attentionOf = (project: string, period: PeriodKey): ReadonlyArray<Attention> => {
  const spike = failureSpikeOf(requestColumns(period))
  const slower = lastDayEndpoints
    .flatMap((row) => (row.slower === undefined ? [] : [{ endpoint: row.endpoint, ...row.slower }]))
    .toSorted(byHowMuchSlower)
  const slowerScreens = components
    .flatMap((component) => screensOf(component, "24h"))
    .flatMap((row) =>
      row.slower === undefined ? [] : [{ component: row.component, screen: row.screen, ...row.slower }],
    )
    .toSorted(byHowMuchSlower)
  const fresh = errorGroups.filter((group) => statusOf(group).isNew)
  const errorRoute = (error: string) => ({ page: "errors" as const, project, error })
  return [
    ...errorGroups
      .filter((group) => statusOf(group).ongoing)
      .map((group) => ({
        key: `ongoing ${group.id}`,
        tone: "failure" as const,
        title: `${titleParts(group).type} is happening right now`,
        detail: `${count(group.occurrences)} occurrences in the last 24 hours, last ${ago(group.lastSeen, sampleNow)}`,
        action: { label: "Open the error", to: errorRoute(group.id) },
      })),
    ...(spike === undefined
      ? []
      : [
          {
            key: "spike",
            tone: "failure" as const,
            title: `Error rate ${share(spike.failed, spike.requests)} between ${axisTime(spike.from)} and ${axisTime(spike.to)}`,
            detail: `${count(spike.failed)} failed requests to ${backend}`,
            action: {
              label: "Open a failed request",
              to: { page: "trace" as const, project, trace: sampleTrace.trace },
            },
          },
        ]),
    ...fresh
      .filter((group) => group.crash)
      .map((group) => ({
        key: `new crash ${group.id}`,
        tone: "failure" as const,
        title: `${titleParts(group).type} is a new crash in ${group.lastComponent}${group.lastRelease === undefined ? "" : ` ${group.lastRelease}`}`,
        detail: `${count(group.occurrences)} crashes for ${count(group.people ?? 0)} people since ${ago(group.firstSeen, sampleNow)}`,
        action: { label: "Open the crash", to: errorRoute(group.id) },
      })),
    ...fresh
      .filter((group) => !group.crash)
      .map((group) => ({
        key: `new ${group.id}`,
        tone: "warning" as const,
        title: `${titleParts(group).type} is new`,
        detail: `First seen ${ago(group.firstSeen, sampleNow)}, ${count(group.occurrences)} occurrences since`,
        action: { label: "Open the error", to: errorRoute(group.id) },
      })),
    ...slower.map((row) => ({
      key: `slower ${row.endpoint}`,
      tone: "warning" as const,
      title: `${row.endpoint} got slower`,
      detail: `p95 ${duration(row.p95Ms)} over the last day, usually ${duration(row.usualP95Ms)}`,
      action: {
        label: "Open the endpoint",
        to: { page: "endpoint" as const, project, component: backend, endpoint: row.endpoint },
      },
    })),
    ...slowerScreens.map((row) => ({
      key: `slower ${row.component} ${row.screen}`,
      tone: "warning" as const,
      title: `${row.screen} in ${row.component} got slower`,
      detail: `p95 ${duration(row.p95Ms)} over the last day, usually ${duration(row.usualP95Ms)}`,
      action: {
        label: "Open its performance",
        to: { page: "performance" as const, project, component: row.component },
      },
    })),
  ]
}
