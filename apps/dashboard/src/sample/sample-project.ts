// Sample answers for the dashboard's design: a project like folio, shaped like the public API's
// answers (@cluenori/signals), with times as epoch milliseconds. Deterministic, so screenshots
// compare. Only the design kit and tests read it; the pages read the API. Keys are the API's own,
// typed, so the views the kit shows take what they will take from the API.

import { ProjectKey, TraceId } from "@cluenori/foundation"
import { ErrorGroupId } from "@cluenori/signals"

/** The time every sample answer is "now": 2026-10-20 09:40 UTC. */
export const sampleNow = 1_792_489_200_000

const minute = 60_000
const hour = 60 * minute
const day = 24 * hour

/** How far back a page looks. */
export type PeriodKey = "1h" | "24h" | "7d" | "30d" | "90d"

export const periods: ReadonlyArray<{ readonly key: PeriodKey; readonly label: string; readonly millis: number }> = [
  { key: "1h", label: "1h", millis: hour },
  { key: "24h", label: "24h", millis: day },
  { key: "7d", label: "7d", millis: 7 * day },
  { key: "30d", label: "30d", millis: 30 * day },
  { key: "90d", label: "90d", millis: 90 * day },
]

const stepOf: Record<PeriodKey, number> = { "1h": minute, "24h": hour, "7d": hour, "30d": day, "90d": day }

// A small seeded generator (mulberry32), so every render of the sample is the same.
const seeded = (seed: number) => {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state)
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296
  }
}

// Traffic over a day, in UTC: quiet at night, busiest in the European afternoon.
const dailyShape = (epochMillis: number) => {
  const hourOfDay = (epochMillis % day) / hour
  const awake = Math.sin((Math.PI * (hourOfDay - 5)) / 19)
  return 0.18 + 0.82 * Math.max(0, awake)
}

/** The incident in the sample: exports failed for 40 minutes, about 2½ hours ago. */
export const incident = { from: sampleNow - 160 * minute, to: sampleNow - 120 * minute }

const inIncident = (start: number, step: number) => start + step > incident.from && start < incident.to

export type RequestPoint = {
  readonly start: number
  readonly requests: number
  readonly errors: number
  /** The step's p95 latency. Not in the API yet: its counts keep a sketch per bucket. */
  readonly p95Ms: number
}

/** Requests and errors over the period, one point per step that had requests, oldest first. */
export type RequestSeries = {
  readonly step: number
  readonly from: number
  readonly to: number
  readonly points: ReadonlyArray<RequestPoint>
}

// Requests each step at the busiest hour, by step width.
const peakPerMinute = 90

export const requestSeries = (period: PeriodKey): RequestSeries => {
  const random = seeded(11)
  const step = stepOf[period]
  const millis = periods.find((entry) => entry.key === period)?.millis ?? day
  const to = Math.floor(sampleNow / step) * step
  const from = to - millis
  const points: Array<RequestPoint> = []
  for (let start = from; start < to; start += step) {
    // A sender that was silent for a while: the counts have no point there, which isn't zero.
    const silent = period === "7d" && start > sampleNow - 4 * day - 5 * hour && start < sampleNow - 4 * day
    if (silent) {
      continue
    }
    const shape = step >= day ? 0.55 : dailyShape(start)
    const requests = Math.round(peakPerMinute * (step / minute) * shape * (0.85 + 0.3 * random()))
    // A day holds the 40-minute incident without being slow or failing all day.
    const incidentStep = inIncident(start, step) && step <= hour
    const failing = incidentStep ? 0.09 : 0.004
    const errors = Math.round(requests * failing * (0.5 + random()))
    // Busier is slower; the incident's exports waited on a slow thumbnail service.
    const p95Ms = incidentStep ? 1900 + 600 * random() : 38 + 330 * shape ** 2.2 * (0.85 + 0.3 * random())
    points.push({ start, requests, errors, p95Ms })
  }
  return { step, from, to, points }
}

// Who asks the API when, in UTC: the iOS app in the evening, the web app during working hours,
// webhooks and jobs all day.
const originShapes: ReadonlyArray<{
  readonly origin?: string
  readonly share: number
  readonly shape: (hourOfDay: number) => number
}> = [
  { origin: "folio-ios", share: 0.62, shape: (hourOfDay) => 0.15 + 0.85 * Math.exp(-((hourOfDay - 19) ** 2) / 14) },
  {
    origin: "folio-web",
    share: 0.26,
    shape: (hourOfDay) => 0.05 + 0.95 * Math.max(0, Math.sin((Math.PI * (hourOfDay - 7)) / 11)),
  },
  { share: 0.12, shape: (hourOfDay) => 0.45 + 0.25 * Math.sin((Math.PI * hourOfDay) / 6) },
]

/** Requests by endpoint, with how long they took: one row of the endpoint table. */
export type EndpointRow = {
  readonly component: string
  readonly environment?: string
  readonly endpoint: string
  readonly requests: number
  readonly errors: number
  readonly averageMs: number
  readonly p50Ms: number
  readonly p80Ms: number
  readonly p95Ms: number
  readonly p99Ms: number
  /**
   * Its p95 over the last day, and its usual p95, over the 7 days before, whatever the period: whether
   * it got slower lately. The usual is absent for an endpoint new this week. Not in the API yet.
   */
  readonly lastDayP95Ms: number
  readonly usualP95Ms?: number
}

export type EndpointTable = {
  readonly rows: ReadonlyArray<EndpointRow>
  readonly requests: number
  readonly errors: number
  readonly dataUntil: number
}

// The day's endpoints of folio-api, with their usual p95; other periods scale them. Feed and media
// uploads got slower, waiting on thumbnails; exports are slow by nature, but as usual; feedback is
// new this week.
const dayOfEndpoints: ReadonlyArray<EndpointRow> = [
  row("GET /api/notes/{id}", 48_210, 41, 24, 18, 31, 64, 140, 60),
  row("POST /api/auth/refresh", 31_005, 118, 15, 12, 17, 30, 62, 29),
  row("GET /api/feed", 22_400, 67, 131, 85, 160, 420, 1_210, 180),
  row("GET /api/media/{id}", 15_880, 32, 58, 35, 70, 210, 480, 190),
  row("POST /api/notes", 9_812, 22, 61, 42, 75, 160, 310, 150),
  row("GET /health", 8_640, 0, 1.2, 0.9, 1.1, 2.4, 6, 2.2),
  row("POST /api/media", 2_310, 25, 820, 640, 990, 2_100, 3_900, 1_250),
  row("POST /api/export", 1_204, 39, 1_450, 900, 1_700, 4_200, 8_800, 3_900),
  row("DELETE /api/notes/{id}", 610, 1, 33, 26, 38, 80, 120, 78),
  row("POST /webhooks/revenuecat", 140, 0, 71, 55, 80, 160, 210, 150),
  row("GET /api/notes", 12_480, 9, 48, 36, 58, 140, 260, 130),
  row("PUT /api/notes/{id}", 7_230, 14, 52, 40, 66, 150, 290, 145),
  row("GET /api/notes/{id}/history", 1_920, 2, 96, 70, 120, 260, 540, 240),
  row("POST /api/notes/{id}/share", 860, 3, 64, 50, 80, 170, 300, 160),
  row("GET /api/folders", 9_140, 4, 28, 21, 35, 80, 150, 75),
  row("POST /api/folders", 410, 0, 45, 34, 55, 110, 190, 120),
  row("GET /api/search", 6_550, 21, 210, 160, 260, 620, 1_400, 560),
  row("GET /api/me", 18_300, 6, 14, 11, 17, 34, 70, 31),
  row("PUT /api/me/settings", 520, 1, 38, 29, 46, 95, 160, 90),
  row("POST /api/auth/sign-in", 2_140, 37, 180, 150, 210, 380, 640, 360),
  row("POST /api/auth/sign-out", 960, 0, 18, 14, 21, 40, 70, 38),
  row("GET /api/exports/{id}", 3_310, 2, 22, 17, 27, 60, 110, 58),
  row("DELETE /api/media/{id}", 290, 0, 41, 33, 50, 100, 170, 95),
  row("POST /api/feedback", 75, 0, 66, 52, 78, 140, 190, undefined),
]

function row(
  endpoint: string,
  requests: number,
  errors: number,
  averageMs: number,
  p50Ms: number,
  p80Ms: number,
  p95Ms: number,
  p99Ms: number,
  usualP95Ms: number | undefined,
): EndpointRow {
  return {
    component: "folio-api",
    environment: "production",
    endpoint,
    requests,
    errors,
    averageMs,
    p50Ms,
    p80Ms,
    p95Ms,
    p99Ms,
    lastDayP95Ms: p95Ms,
    ...(usualP95Ms === undefined ? {} : { usualP95Ms }),
  }
}

export const endpointTable = (period: PeriodKey): EndpointTable => {
  const millis = periods.find((entry) => entry.key === period)?.millis ?? day
  const scale = millis / day
  const rows = dayOfEndpoints.map((entry) => ({
    ...entry,
    requests: Math.max(1, Math.round(entry.requests * scale)),
    errors: Math.round(entry.errors * scale),
  }))
  return {
    rows,
    requests: rows.reduce((sum, entry) => sum + entry.requests, 0),
    errors: rows.reduce((sum, entry) => sum + entry.errors, 0),
    dataUntil: sampleNow - minute,
  }
}

/** One error, as it shows in a list, with its occurrences in each of the last 24 hours. */
export type ErrorGroup = {
  readonly id: ErrorGroupId
  readonly kind: "exception" | "log"
  /** Whether it ended the app: a crash on a phone, an unhandled error in a browser. Never for a backend. */
  readonly crash: boolean
  readonly title: string
  readonly culprit: string
  readonly occurrences: number
  /** The people it happened to; an app always knows, a backend only when its requests name a person. */
  readonly people?: number
  readonly firstSeen: number
  readonly lastSeen: number
  readonly lastComponent: string
  readonly lastEnvironment?: string
  readonly lastRelease?: string
  /** Its occurrences in each release it happened in, the newest first; empty when releases are unknown. */
  readonly releases: ReadonlyArray<{ readonly release: string; readonly occurrences: number }>
  /** Occurrences in each hour of the last day, oldest first. Not in the API yet. */
  readonly hourly: ReadonlyArray<number>
  /** What the app did before the latest occurrence, oldest first, ending with it. Apps only. */
  readonly trail?: ReadonlyArray<TrailEvent>
}

/**
 * One thing an app did before an error, from its SDK: a screen it showed, something the person did,
 * a request it made (one click from the request's trace), and the error itself, last.
 */
export type TrailEvent =
  | { readonly time: number; readonly kind: "screen" | "action" | "error"; readonly text: string }
  | {
      readonly time: number
      readonly kind: "request"
      readonly endpoint: string
      readonly status: number
      readonly durationMs: number
      readonly trace: TraceId
    }

// A day of occurrences that adds up to `total`: a random level each hour from hour `from`, nine
// times as many in the hour of a spike, shared out by largest remainder.
const hourly = (seed: number, total: number, spikeAt: number | undefined, from = 0) => {
  const random = seeded(seed)
  const weights = Array.from({ length: 24 }, (_, index) =>
    index < from ? 0 : 0.2 + random() + (index === spikeAt ? 9 : 0),
  )
  const sum = weights.reduce((all, weight) => all + weight, 0)
  const exact = weights.map((weight) => (weight / sum) * total)
  const counts = exact.map(Math.floor)
  const left = total - counts.reduce((all, value) => all + value, 0)
  const byRemainder = exact
    .map((value, index) => ({ index, rest: value - Math.floor(value) }))
    .toSorted((a, b) => b.rest - a.rest)
  return counts.map((value, index) => value + (byRemainder.findIndex((entry) => entry.index === index) < left ? 1 : 0))
}

// A moment some seconds before an error, for its trail.
const before = (at: number, seconds: number) => at - seconds * 1000

const iosCrashAt = sampleNow - 26 * minute
const feedCrashAt = sampleNow - 3 * hour
const webErrorAt = sampleNow - 50 * minute

const unsortedGroups: ReadonlyArray<ErrorGroup> = [
  {
    id: ErrorGroupId.make("4f1c9a2e7b3d5068"),
    kind: "exception",
    crash: false,
    title: "NpgsqlException: Exception while reading from stream",
    culprit: "Folio.Api.Notes.NoteRepository.GetAsync(Guid id, CancellationToken token)",
    occurrences: 214,
    firstSeen: sampleNow - 9 * day,
    lastSeen: sampleNow - 4 * minute,
    lastComponent: "folio-api",
    lastEnvironment: "production",
    lastRelease: "2.14.0+412",
    releases: [{ release: "2.14.0+412", occurrences: 214 }],
    hourly: hourly(3, 214, 21),
  },
  {
    id: ErrorGroupId.make("a90e3b7c14d2f685"),
    kind: "exception",
    crash: false,
    title: "InvalidOperationException: Sequence contains no elements",
    culprit: "Folio.Api.Export.ExportService.BuildAsync(ExportRequest request)",
    occurrences: 97,
    firstSeen: sampleNow - 31 * day,
    lastSeen: sampleNow - 2 * hour,
    lastComponent: "folio-api",
    lastEnvironment: "production",
    lastRelease: "2.14.0+412",
    releases: [
      { release: "2.14.0+412", occurrences: 60 },
      { release: "2.13.2+398", occurrences: 37 },
    ],
    hourly: hourly(5, 97, 21),
  },
  {
    id: ErrorGroupId.make("c2d7e0f81a4b9356"),
    kind: "exception",
    crash: false,
    title: "TaskCanceledException: The operation was canceled.",
    culprit: "Folio.Api.Media.ThumbnailClient.FetchAsync(Uri source)",
    occurrences: 61,
    firstSeen: sampleNow - 64 * day,
    lastSeen: sampleNow - 38 * minute,
    lastComponent: "folio-api",
    lastEnvironment: "production",
    lastRelease: "2.13.2+398",
    releases: [{ release: "2.13.2+398", occurrences: 61 }],
    hourly: hourly(7, 61, undefined),
  },
  {
    id: ErrorGroupId.make("18b6f4a0d9c3e275"),
    kind: "log",
    crash: false,
    title: "Export {ExportId} failed after {Attempts} attempts",
    culprit: "Folio.Api.Export.ExportJob",
    occurrences: 33,
    firstSeen: sampleNow - 12 * day,
    lastSeen: sampleNow - 2 * hour - 12 * minute,
    lastComponent: "folio-api",
    lastEnvironment: "production",
    releases: [],
    hourly: hourly(9, 33, 21),
  },
  {
    id: ErrorGroupId.make("e73a5c1b0f8d2946"),
    kind: "exception",
    crash: false,
    title: "JsonException: The JSON value could not be converted to System.DateTime. Path: $.dueAt",
    culprit: "Folio.Api.Notes.NotesController.Update(Guid id, NoteUpdate update)",
    occurrences: 12,
    firstSeen: sampleNow - 3 * hour,
    lastSeen: sampleNow - 22 * minute,
    lastComponent: "folio-api",
    lastEnvironment: "production",
    lastRelease: "2.14.0+412",
    releases: [{ release: "2.14.0+412", occurrences: 12 }],
    hourly: [...Array.from({ length: 21 }, () => 0), 3, 5, 4],
  },
  {
    id: ErrorGroupId.make("5b0d8e2f6a1c7394"),
    kind: "exception",
    crash: false,
    title: "UnauthorizedAccessException: The refresh token has expired.",
    culprit: "Folio.Api.Auth.RefreshHandler.Handle(RefreshCommand command)",
    occurrences: 8,
    firstSeen: sampleNow - 80 * day,
    lastSeen: sampleNow - 7 * hour,
    lastComponent: "folio-api",
    lastEnvironment: "production",
    lastRelease: "2.13.2+398",
    releases: [{ release: "2.13.2+398", occurrences: 8 }],
    hourly: hourly(13, 8, undefined),
  },
  {
    id: ErrorGroupId.make("7c3a9e1f5b2d4068"),
    kind: "exception",
    crash: true,
    title: "EXC_BAD_ACCESS: KERN_INVALID_ADDRESS at 0x0000000000000010",
    culprit: "NoteEditorView.renderAttachment(_:)",
    occurrences: 41,
    people: 37,
    firstSeen: sampleNow - 20 * hour,
    lastSeen: iosCrashAt,
    lastComponent: "folio-ios",
    lastEnvironment: "production",
    lastRelease: "3.2.0+518",
    releases: [{ release: "3.2.0+518", occurrences: 41 }],
    hourly: hourly(17, 41, undefined, 4),
    trail: [
      { time: before(iosCrashAt, 48), kind: "screen", text: "FeedView" },
      {
        time: before(iosCrashAt, 47),
        kind: "request",
        endpoint: "GET /api/feed",
        status: 200,
        durationMs: 1_240,
        trace: TraceId.make("4be1c07a9d3f2e8615b0c7d9e2a4f381"),
      },
      { time: before(iosCrashAt, 31), kind: "action", text: "Tapped a note" },
      { time: before(iosCrashAt, 31), kind: "screen", text: "NoteEditorView" },
      {
        time: before(iosCrashAt, 30),
        kind: "request",
        endpoint: "GET /api/notes/{id}",
        status: 200,
        durationMs: 58,
        trace: TraceId.make("8d41f0c2a7b39e5d1c06f4a2b8e7d390"),
      },
      { time: before(iosCrashAt, 12), kind: "action", text: "Added a photo" },
      {
        time: before(iosCrashAt, 11),
        kind: "request",
        endpoint: "POST /api/media",
        status: 200,
        durationMs: 2_310,
        trace: TraceId.make("1d8e3f5a0b7c9264d1e8f3a5c0b7d926"),
      },
      { time: iosCrashAt, kind: "error", text: "EXC_BAD_ACCESS in NoteEditorView.renderAttachment(_:)" },
    ],
  },
  {
    id: ErrorGroupId.make("2e8d0b6f4a1c9357"),
    kind: "exception",
    crash: true,
    title: "Fatal error: Index out of range",
    culprit: "FeedViewModel.item(at:)",
    occurrences: 12,
    people: 11,
    firstSeen: sampleNow - 40 * day,
    lastSeen: feedCrashAt,
    lastComponent: "folio-ios",
    lastEnvironment: "production",
    lastRelease: "3.2.0+518",
    releases: [
      { release: "3.2.0+518", occurrences: 7 },
      { release: "3.1.4+507", occurrences: 5 },
    ],
    hourly: hourly(19, 12, undefined),
    trail: [
      { time: before(feedCrashAt, 22), kind: "screen", text: "FeedView" },
      {
        time: before(feedCrashAt, 21),
        kind: "request",
        endpoint: "GET /api/feed",
        status: 200,
        durationMs: 980,
        trace: TraceId.make("7a2c9e4f1b6d8305a7c2e9f4b1d6a830"),
      },
      { time: before(feedCrashAt, 6), kind: "action", text: "Pulled to refresh" },
      {
        time: before(feedCrashAt, 5),
        kind: "request",
        endpoint: "GET /api/feed",
        status: 200,
        durationMs: 1_410,
        trace: TraceId.make("0c5e8a2d7f1b4369c0e5a8d2f7b14362"),
      },
      { time: before(feedCrashAt, 1), kind: "action", text: "Scrolled the feed" },
      { time: feedCrashAt, kind: "error", text: "Fatal error: Index out of range in FeedViewModel.item(at:)" },
    ],
  },
  {
    id: ErrorGroupId.make("9a4f2c7e0d1b8365"),
    kind: "exception",
    crash: false,
    title: "URLError: The network connection was lost.",
    culprit: "SyncEngine.push()",
    occurrences: 230,
    people: 140,
    firstSeen: sampleNow - 70 * day,
    lastSeen: sampleNow - 18 * minute,
    lastComponent: "folio-ios",
    lastEnvironment: "production",
    lastRelease: "3.2.0+518",
    releases: [
      { release: "3.2.0+518", occurrences: 150 },
      { release: "3.1.4+507", occurrences: 80 },
    ],
    hourly: hourly(21, 230, undefined),
    trail: [
      { time: sampleNow - 18 * minute - 9_000, kind: "screen", text: "NoteEditorView" },
      { time: sampleNow - 18 * minute - 4_000, kind: "action", text: "Edited a note" },
      {
        time: sampleNow - 18 * minute,
        kind: "error",
        text: "URLError: The network connection was lost, in SyncEngine.push()",
      },
    ],
  },
  {
    id: ErrorGroupId.make("d5b1e8a3c6f04927"),
    kind: "exception",
    crash: true,
    title: "TypeError: Cannot read properties of undefined (reading 'id')",
    culprit: "NoteList (src/notes/note-list.tsx:48:21)",
    occurrences: 64,
    people: 40,
    firstSeen: sampleNow - 9 * day,
    lastSeen: webErrorAt,
    lastComponent: "folio-web",
    lastEnvironment: "production",
    lastRelease: "1.42.0+91",
    releases: [{ release: "1.42.0+91", occurrences: 64 }],
    hourly: hourly(25, 64, undefined),
    trail: [
      { time: before(webErrorAt, 40), kind: "screen", text: "/notes" },
      {
        time: before(webErrorAt, 39),
        kind: "request",
        endpoint: "GET /api/notes",
        status: 200,
        durationMs: 140,
        trace: TraceId.make("5f9b2d6e1a8c4073f5b9d2e6a1c84075"),
      },
      { time: before(webErrorAt, 3), kind: "action", text: "Deleted a note" },
      {
        time: before(webErrorAt, 2),
        kind: "request",
        endpoint: "DELETE /api/notes/{id}",
        status: 200,
        durationMs: 80,
        trace: TraceId.make("a3d7f1c5e9b20486a3d7f1c5e9b20488"),
      },
      { time: webErrorAt, kind: "error", text: "TypeError: Cannot read properties of undefined (reading 'id')" },
    ],
  },
]

/** The project's error groups, most frequent first, apps' and backends' together. */
export const errorGroups: ReadonlyArray<ErrorGroup> = unsortedGroups.toSorted(
  (left, right) => right.occurrences - left.occurrences,
)

/** The stacks the sample's errors were sent with, by error group. */
export const errorStacks: Readonly<Record<string, string>> = {
  "4f1c9a2e7b3d5068": `Npgsql.NpgsqlException (0x80004005): Exception while reading from stream
 ---> System.TimeoutException: Timeout during reading attempt
   at Npgsql.Internal.NpgsqlReadBuffer.<Ensure>g__EnsureLong|55_0(NpgsqlReadBuffer buffer, Int32 count, Boolean async, Boolean readingNotifications)
   at Npgsql.NpgsqlDataReader.NextResult(Boolean async, Boolean isConsuming, CancellationToken cancellationToken)
   at Npgsql.NpgsqlCommand.ExecuteReader(Boolean async, CommandBehavior behavior, CancellationToken cancellationToken)
   at Microsoft.EntityFrameworkCore.Query.Internal.SingleQueryingEnumerable\`1.AsyncEnumerator.MoveNextAsync()
   at Microsoft.EntityFrameworkCore.Query.ShapedQueryCompilingExpressionVisitor.SingleOrDefaultAsync[TSource](IAsyncEnumerable\`1 asyncEnumerable, CancellationToken cancellationToken)
   at Folio.Api.Notes.NoteRepository.GetAsync(Guid id, CancellationToken token) in /src/Folio.Api/Notes/NoteRepository.cs:line 48
   at Folio.Api.Notes.NotesController.Get(Guid id) in /src/Folio.Api/Notes/NotesController.cs:line 31
   at Microsoft.AspNetCore.Mvc.Infrastructure.ActionMethodExecutor.TaskOfIActionResultExecutor.Execute(ActionContext actionContext)`,
}

/** A log record of warning level or above, as the logs page lists it. */
export type LogLine = {
  readonly id: number
  readonly time: number
  readonly level: "warn" | "error" | "fatal"
  readonly component: string
  readonly category: string
  readonly message: string
  readonly trace?: string
  readonly error?: string
}

const logTemplates: ReadonlyArray<Omit<LogLine, "id" | "time">> = [
  {
    level: "error",
    component: "folio-api",
    category: "Folio.Api.Notes.NoteRepository",
    message: "Exception while reading from stream",
    trace: TraceId.make("8d41f0c2a7b39e5d1c06f4a2b8e7d390"),
    error: "4f1c9a2e7b3d5068",
  },
  {
    level: "warn",
    component: "folio-api",
    category: "Folio.Api.Media.ThumbnailClient",
    message: "Thumbnail fetch took 2,140 ms for media 7f3e…, over the 1,000 ms budget",
    trace: TraceId.make("3a90c1d7e2f84b6a05d9c3e1f7a2b648"),
  },
  {
    level: "error",
    component: "folio-api",
    category: "Folio.Api.Export.ExportJob",
    message: "Export 51c2… failed after 3 attempts",
    trace: TraceId.make("f2b7d04e9a1c3865e7d0b4a9c2f15e63"),
    error: "18b6f4a0d9c3e275",
  },
  {
    level: "warn",
    component: "folio-ios",
    category: "Sync",
    message: "Sync retried 2 times before the server answered",
  },
  {
    level: "warn",
    component: "folio-web",
    category: "media",
    message: "A thumbnail failed to load and was shown as a placeholder",
  },
  {
    level: "warn",
    component: "folio-api",
    category: "Microsoft.EntityFrameworkCore.Query",
    message: "Compiling a query which loads related collections for more than one collection navigation",
  },
  {
    level: "error",
    component: "folio-api",
    category: "Folio.Api.Notes.NotesController",
    message: "The JSON value could not be converted to System.DateTime. Path: $.dueAt",
    trace: TraceId.make("b5e8a3f1c0d74296e3b1a8f05c7d2e94"),
    error: "e73a5c1b0f8d2946",
  },
  {
    level: "error",
    component: "folio-api",
    category: "Folio.Api.Export.ExportService",
    message: "Sequence contains no elements",
    trace: TraceId.make("6c1e9b4d2f7a0853c6e1b9d4f2a70851"),
    error: "a90e3b7c14d2f685",
  },
  {
    level: "error",
    component: "folio-api",
    category: "Folio.Api.Media.ThumbnailClient",
    message: "The operation was canceled.",
    trace: TraceId.make("d4a7f0c3e6b92185d4a7f0c3e6b92187"),
    error: "c2d7e0f81a4b9356",
  },
  {
    level: "error",
    component: "folio-api",
    category: "Folio.Api.Auth.RefreshHandler",
    message: "The refresh token has expired.",
    trace: TraceId.make("2b8e5a1f4c7d0396b2e8a5f1c4d70398"),
    error: "5b0d8e2f6a1c7394",
  },
  {
    level: "fatal",
    component: "folio-api",
    category: "Microsoft.Hosting.Lifetime",
    message: "Application is shutting down: the database is unreachable",
  },
]

export const logLines: ReadonlyArray<LogLine> = (() => {
  const random = seeded(17)
  return Array.from({ length: 60 }, (_, index) => index).flatMap((index) => {
    const template = logTemplates[Math.floor(random() * logTemplates.length)]
    if (template === undefined) {
      return []
    }
    // Fatal records are rare: most draws of the fatal template become errors.
    const level = template.level === "fatal" && index % 9 !== 0 ? "error" : template.level
    const time = sampleNow - index * 23 * minute - Math.floor(random() * 20 * minute)
    // A line of an error group falls between the group's first and last occurrence.
    const group = errorGroups.find((entry) => entry.id === template.error)
    if (group !== undefined && (time < group.firstSeen || time > group.lastSeen)) {
      return []
    }
    return [{ ...template, level, id: 10_000 - index, time }]
  })
})()

/** A request worth opening: slow or failed, with its status and the app that started it. */
export type RequestRow = {
  readonly trace: TraceId
  readonly time: number
  readonly endpoint: string
  readonly durationMs: number
  readonly status: number
  readonly origin?: string
}

// Requests the backend kept from the last day: failed ones, and slow ones, over their endpoint's p95.
const keptByHand: ReadonlyArray<RequestRow> = [
  {
    trace: TraceId.make("f2b7d04e9a1c3865e7d0b4a9c2f15e63"),
    time: sampleNow - 132 * minute,
    endpoint: "POST /api/export",
    durationMs: 4_210,
    status: 500,
    origin: "folio-ios",
  },
  {
    trace: TraceId.make("9c41e07b2d5af6831e0c7d2b4a9f6e15"),
    time: sampleNow - 140 * minute,
    endpoint: "POST /api/export",
    durationMs: 4_870,
    status: 500,
    origin: "folio-web",
  },
  {
    trace: TraceId.make("1d8e3f5a0b7c9264d1e8f3a5c0b7d926"),
    time: sampleNow - 151 * minute,
    endpoint: "POST /api/media",
    durationMs: 2_640,
    status: 200,
    origin: "folio-ios",
  },
  {
    trace: TraceId.make("7a2c9e4f1b6d8305a7c2e9f4b1d6a830"),
    time: sampleNow - 3 * hour,
    endpoint: "GET /api/feed",
    durationMs: 1_380,
    status: 200,
    origin: "folio-ios",
  },
  {
    trace: TraceId.make("3e6b1d9f4a2c7058e3b6d1f9a4c2e705"),
    time: sampleNow - 5 * hour,
    endpoint: "POST /api/export",
    durationMs: 5_340,
    status: 200,
    origin: "folio-web",
  },
  {
    trace: TraceId.make("b5f0a3c8e1d6297b5f0a3c8e1d6297b4"),
    time: sampleNow - 7 * hour,
    endpoint: "PUT /api/notes/{id}",
    durationMs: 312,
    status: 500,
    origin: "folio-ios",
  },
  {
    trace: TraceId.make("c8d2f6a0e4b1937c8d2f6a0e4b193752"),
    time: sampleNow - 11 * hour,
    endpoint: "POST /webhooks/revenuecat",
    durationMs: 1_120,
    status: 502,
  },
  {
    trace: TraceId.make("e0a4c8f2b6d1359e0a4c8f2b6d135911"),
    time: sampleNow - 16 * hour,
    endpoint: "POST /api/media",
    durationMs: 3_110,
    status: 200,
    origin: "folio-web",
  },
]

// Who starts a backend request, about as often as the request columns say.
const originOf = (pick: number) => {
  if (pick < 0.62) {
    return { origin: "folio-ios" }
  }
  return pick < 0.88 ? { origin: "folio-web" } : {}
}

// The three slowest requests of each endpoint in the last day, past its p99, at random times.
const slowestOfEach: ReadonlyArray<RequestRow> = (() => {
  const random = seeded(29)
  // Never all zeros, which isn't a trace ID: the first digit is 1 to f.
  const traceId = () =>
    TraceId.make(
      Array.from({ length: 32 }, (_, index) =>
        Math.floor(index === 0 ? 1 + random() * 15 : random() * 16).toString(16),
      ).join(""),
    )
  return dayOfEndpoints.flatMap((entry) =>
    [1.1, 1.4, 2].map((times) => ({
      trace: traceId(),
      time: sampleNow - Math.floor(random() * day),
      endpoint: entry.endpoint,
      durationMs: Math.round(entry.p99Ms * times * (0.9 + 0.2 * random())),
      status: 200,
      ...originOf(random()),
    })),
  )
})()

/** The requests the backend kept from the last day, newest first: failed ones, and the slowest of each endpoint. */
export const slowAndFailedRequests: ReadonlyArray<RequestRow> = [...keptByHand, ...slowestOfEach].toSorted(
  (left, right) => right.time - left.time,
)

/** One operation of a trace, placed in its tree. */
export type TraceSpan = {
  readonly span: string
  readonly depth: number
  readonly name: string
  readonly kind: "server" | "client" | "internal" | "producer" | "consumer"
  readonly component: string
  readonly start: number
  readonly durationMs: number
  readonly failed: boolean
  readonly statusMessage?: string
  readonly attributes: Readonly<Record<string, string | number | boolean>>
}

export type TraceLog = {
  readonly time: number
  readonly level: "info" | "warn" | "error"
  readonly category: string
  readonly message: string
  readonly span?: string
}

export type TraceView = {
  readonly trace: TraceId
  readonly spans: ReadonlyArray<TraceSpan>
  readonly logs: ReadonlyArray<TraceLog>
}

const traceStart = sampleNow - 2 * hour - 12 * minute

const backendSpans: ReadonlyArray<TraceSpan> = [
  span("a1", 0, "POST /api/export", "server", "folio-api", 0, 4_210, "Export 51c2… failed after 3 attempts", {
    "http.request.method": "POST",
    "http.route": "/api/export",
    "http.response.status_code": 500,
    "url.scheme": "https",
    "user_agent.original": "Folio/3.2.0 (iPhone; iOS 26.1)",
  }),
  span("b2", 1, "ExportService.Build", "internal", "folio-api", 6, 4_180, "Sequence contains no elements", {
    "export.format": "pdf",
  }),
  span("c3", 2, "SELECT notes", "client", "folio-api", 12, 38, undefined, {
    "db.system.name": "postgresql",
    "db.query.text": "SELECT n.id, n.title, n.body FROM notes AS n WHERE n.owner_id = @p0",
  }),
  span("d4", 2, "SELECT media", "client", "folio-api", 54, 210, undefined, {
    "db.system.name": "postgresql",
    "db.query.text": "SELECT m.id, m.url FROM media AS m WHERE m.note_id = ANY (@p0)",
  }),
  span("e5", 2, "GET thumbnails.folio.app", "client", "folio-api", 270, 1_190, undefined, {
    "http.request.method": "GET",
    "server.address": "thumbnails.folio.app",
    "http.response.status_code": 200,
  }),
  span("f6", 2, "GET thumbnails.folio.app", "client", "folio-api", 1_470, 1_340, undefined, {
    "http.request.method": "GET",
    "server.address": "thumbnails.folio.app",
    "http.response.status_code": 200,
  }),
  span("g7", 2, "GET thumbnails.folio.app", "client", "folio-api", 2_820, 1_000, "The operation was canceled.", {
    "http.request.method": "GET",
    "server.address": "thumbnails.folio.app",
    "error.type": "System.Threading.Tasks.TaskCanceledException",
  }),
  span("h8", 2, "INSERT exports", "client", "folio-api", 3_840, 12, undefined, {
    "db.system.name": "postgresql",
    "db.query.text": "INSERT INTO exports (id, owner_id, status) VALUES (@p0, @p1, @p2)",
  }),
  span("i9", 1, "ProblemDetails", "internal", "folio-api", 4_190, 14, undefined, {}),
]

export const sampleTrace: TraceView = {
  trace: TraceId.make("f2b7d04e9a1c3865e7d0b4a9c2f15e63"),
  spans: [
    span("z0", 0, "POST /api/export", "client", "folio-ios", -140, 4_470, "The server answered 500", {
      "http.request.method": "POST",
      "url.full": "https://api.folio.app/api/export",
      "http.response.status_code": 500,
      "app.screen.name": "ExportSheet",
      "service.version": "3.2.0+518",
      "device.model.identifier": "iPhone16,2",
      "os.version": "26.1",
    }),
    ...backendSpans.map((entry) => ({ ...entry, depth: entry.depth + 1 })),
  ],
  logs: [
    {
      time: traceStart + 7,
      level: "info",
      category: "Folio.Api.Export.ExportJob",
      message: "Export 51c2… started for 38 notes",
      span: "b2",
    },
    {
      time: traceStart + 2_812,
      level: "warn",
      category: "Folio.Api.Media.ThumbnailClient",
      message: "Thumbnail fetch took 1,340 ms, over the 1,000 ms budget",
      span: "f6",
    },
    {
      time: traceStart + 3_821,
      level: "error",
      category: "Folio.Api.Media.ThumbnailClient",
      message: "The operation was canceled after 1,000 ms",
      span: "g7",
    },
    {
      time: traceStart + 4_200,
      level: "error",
      category: "Folio.Api.Export.ExportJob",
      message: "Export 51c2… failed after 3 attempts",
      span: "b2",
    },
  ],
}

function span(
  id: string,
  depth: number,
  name: string,
  kind: TraceSpan["kind"],
  component: string,
  offsetMs: number,
  durationMs: number,
  failure: string | undefined,
  attributes: TraceSpan["attributes"],
): TraceSpan {
  return {
    span: id,
    depth,
    name,
    kind,
    component,
    start: traceStart + offsetMs,
    durationMs,
    failed: failure !== undefined,
    ...(failure !== undefined ? { statusMessage: failure } : {}),
    attributes,
  }
}

/** The projects of the sample workspace, for the project switcher. */
export const sampleProjects: ReadonlyArray<{
  readonly key: ProjectKey
  readonly name: string
  readonly live: boolean
}> = [
  { key: ProjectKey.make("folio"), name: "Folio", live: true },
  { key: ProjectKey.make("notes"), name: "Notes", live: true },
  { key: ProjectKey.make("landing"), name: "Landing", live: false },
]

/** The sample's project, as links to its pages take it. */
export const sampleProject = ProjectKey.make("folio")

/** Where a component runs; whether it is an app or a backend follows from it. */
export type Platform = "ios" | "android" | "browser" | "dotnet" | "node"

/** A component of the sample project; `receiving` is false for one that has sent nothing yet. */
export type SampleComponent = { readonly key: string; readonly platform: Platform; readonly receiving: boolean }

/** The components of the sample project, in the order that gives each its color. */
export const sampleComponents: ReadonlyArray<SampleComponent> = [
  { key: "folio-api", platform: "dotnet", receiving: true },
  { key: "folio-ios", platform: "ios", receiving: true },
  { key: "folio-web", platform: "browser", receiving: true },
  { key: "folio-android", platform: "android", receiving: false },
]

/**
 * A screen of an app, or a page in a browser: how often it was shown, and how long it took to
 * show, from opening to drawn on a phone and to LCP in a browser, with its usual p95. Not in the
 * API yet.
 */
export type ScreenRow = {
  readonly component: string
  readonly screen: string
  readonly views: number
  readonly p50Ms: number
  readonly p80Ms: number
  readonly p95Ms: number
  readonly p99Ms: number
  readonly lastDayP95Ms: number
  readonly usualP95Ms?: number
}

const screen = (
  component: string,
  name: string,
  views: number,
  [p50Ms, p80Ms, p95Ms, p99Ms]: readonly [number, number, number, number],
  usualP95Ms: number,
): ScreenRow => ({ component, screen: name, views, p50Ms, p80Ms, p95Ms, p99Ms, lastDayP95Ms: p95Ms, usualP95Ms })

// A day of each app's screens. The feed got slower with GET /api/feed.
const dayOfScreens: ReadonlyArray<ScreenRow> = [
  screen("folio-ios", "FeedView", 9_800, [210, 380, 720, 1_400], 340),
  screen("folio-ios", "NoteEditorView", 7_400, [90, 150, 260, 480], 250),
  screen("folio-ios", "NoteListView", 6_100, [60, 110, 190, 350], 180),
  screen("folio-ios", "SearchView", 2_300, [140, 240, 520, 900], 480),
  screen("folio-ios", "MediaPicker", 1_900, [180, 320, 610, 1_100], 560),
  screen("folio-ios", "SettingsView", 640, [40, 70, 120, 200], 115),
  screen("folio-ios", "ExportSheet", 410, [120, 200, 340, 600], 330),
  screen("folio-ios", "SignInView", 380, [70, 120, 220, 410], 210),
  screen("folio-web", "/notes", 3_900, [900, 1_400, 2_300, 3_600], 2_200),
  screen("folio-web", "/notes/{id}", 3_100, [800, 1_250, 2_100, 3_300], 2_000),
  screen("folio-web", "/", 2_200, [1_100, 1_600, 2_600, 4_100], 2_500),
  screen("folio-web", "/search", 700, [950, 1_500, 2_500, 3_900], 2_400),
  screen("folio-web", "/sign-in", 520, [650, 950, 1_500, 2_300], 1_450),
  screen("folio-web", "/settings", 240, [700, 1_000, 1_600, 2_500], 1_550),
]

/** An app's screens over the period, the most shown first. */
export const screenTable = (component: string, period: PeriodKey): ReadonlyArray<ScreenRow> => {
  const millis = periods.find((entry) => entry.key === period)?.millis ?? day
  return dayOfScreens
    .filter((entry) => entry.component === component)
    .map((entry) => ({ ...entry, views: Math.max(1, Math.round((entry.views * millis) / day)) }))
}

/**
 * A backend endpoint as an app saw it over the period: how often it called it, and the p95 from
 * the app's side, network included. Not in the API yet: it comes from the app's own request spans.
 */
export type NetworkCallRow = {
  readonly component: string
  readonly endpoint: string
  readonly calls: number
  readonly p95Ms: number
}

// What each app adds to a request on top of the server's time, mostly network.
const networkOverheadMs: Readonly<Record<string, number>> = { "folio-ios": 240, "folio-web": 90 }

export const networkCalls = (component: string, period: PeriodKey): ReadonlyArray<NetworkCallRow> => {
  const overhead = networkOverheadMs[component]
  const share = originShapes.find((entry) => entry.origin === component)?.share
  if (overhead === undefined || share === undefined) {
    return []
  }
  const random = seeded(component.length * 17)
  // The apps call the API's routes, not health checks or webhooks.
  return endpointTable(period)
    .rows.filter((entry) => /^[A-Z]+ \/api\//.test(entry.endpoint))
    .map((entry) => ({
      component,
      endpoint: entry.endpoint,
      calls: Math.max(1, Math.round(entry.requests * share * (0.8 + 0.4 * random()))),
      p95Ms: entry.p95Ms + overhead * (0.8 + 0.5 * random()),
    }))
    .toSorted((left, right) => right.calls - left.calls)
}
