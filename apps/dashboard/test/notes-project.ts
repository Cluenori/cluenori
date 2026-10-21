import {
  ComponentKey,
  EnvelopeName,
  EnvironmentKey,
  Period,
  ProjectKey,
  ReleaseVersion,
  TraceId,
} from "@cluenori/foundation"
import { Component, ComponentName, Project, ProjectDetail, ProjectList, ProjectName } from "@cluenori/projects"
import type { OperationRow, ErrorGroup, LogLine, SeriesStep } from "@cluenori/signals"
import {
  OperationTable,
  ErrorDetail,
  ErrorGroupId,
  ErrorGroupNotFound,
  ErrorTable,
  KeptRuns,
  LogCounts,
  LogPage,
  RunSeries,
  SeriesStep as SeriesStepSchema,
  SpanId,
  stepMillis,
  TraceView,
} from "@cluenori/signals"
import { Unauthorized } from "@cluenori/worker"
import { Clock, DateTime, Effect, Schema } from "effect"

import type { AnswerApi } from "./fake-api.ts"
import { reply } from "./fake-api.ts"

// A workspace as the public API answers it: Notes, with a .NET backend and an iOS app, and Landing,
// with nothing yet. Every answer is made for the period asked about, so pages read it as they would
// a deployment's, whenever the tests run.

const minute = 60_000
const hour = 60 * minute
const day = 24 * hour

export const notesToken = "notes-api-token"

const notes = ProjectKey.make("notes")
const api = ComponentKey.make("notes-api")
const ios = ComponentKey.make("notes-ios")
const created = DateTime.makeUnsafe("2026-09-01T00:00:00Z")

const projects = [
  new Project({ key: notes, name: ProjectName.make("Notes"), createdAt: created }),
  new Project({ key: ProjectKey.make("landing"), name: ProjectName.make("Landing"), createdAt: created }),
]

const components = [
  new Component({ key: api, name: ComponentName.make("Notes API"), createdAt: created }),
  new Component({ key: ios, name: ComponentName.make("Notes for iOS"), createdAt: created }),
]

export const ongoing = ErrorGroupId.make("4f1c9a2e7b3d5068")
const fresh = ErrorGroupId.make("a90e3b7c14d2f685")
export const exportTrace = TraceId.make("f2b7d04e9a1c3865e7d0b4a9c2f15e63")

// What a call asks, from its query parameters as the API names them.
const Asked = Schema.Struct({
  from: Schema.optionalKey(Schema.DateTimeUtcFromString),
  to: Schema.optionalKey(Schema.DateTimeUtcFromString),
  step: Schema.optionalKey(SeriesStepSchema),
  around: Schema.optionalKey(Schema.DateTimeUtcFromString),
  component: Schema.optionalKey(Schema.String),
  operation: Schema.optionalKey(Schema.String),
  level: Schema.optionalKey(Schema.String),
  search: Schema.optionalKey(Schema.String),
  by: Schema.optionalKey(Schema.String),
})
type Asked = typeof Asked.Type

// A question about a period: what it asks, the period, and the time it is asked.
type Question = { readonly asked: Asked; readonly period: Period; readonly now: number }

const stepOf = (asked: Asked) =>
  asked.step === undefined ? Effect.die("The dashboard asked for a series without a step.") : Effect.succeed(asked.step)

// The start of every step of a period, oldest first.
const stepsOf = (period: Period, step: SeriesStep) => {
  const width = stepMillis[step]
  const from = DateTime.toEpochMillis(period.from)
  const to = DateTime.toEpochMillis(period.to)
  const first = from - (from % width)
  return Array.from({ length: Math.ceil((to - first) / width) }, (_, index) => first + index * width)
}

const row = (
  operation: string,
  runs: number,
  errors: number,
  [p50Ms, p80Ms, p95Ms, p99Ms]: readonly [number, number, number, number],
): OperationRow => ({
  component: api,
  operation: EnvelopeName.make(operation),
  runs,
  errors,
  averageMs: p50Ms * 1.2,
  p50Ms,
  p80Ms,
  p95Ms,
  p99Ms,
})

// The last day: the feed got slower, from a usual p95 of 300 ms to 620 ms.
const lastDayRows = [
  row("GET /api/notes", 12_400, 12, [30, 55, 90, 180]),
  row("GET /api/feed", 8_000, 0, [80, 150, 620, 900]),
  row("POST /api/export", 1_200, 39, [900, 1_700, 4_200, 8_800]),
]
const usualRows = [
  row("GET /api/notes", 80_000, 70, [30, 55, 88, 170]),
  row("GET /api/feed", 52_000, 0, [70, 130, 300, 600]),
  row("POST /api/export", 8_100, 240, [880, 1_650, 4_000, 8_500]),
]

const operations = ({ asked, period, now }: Question) => {
  // The 7 days before the last day end a day ago; every other question ends now.
  const usual = now - DateTime.toEpochMillis(period.to) > 12 * hour
  const rows = (usual ? usualRows : lastDayRows).filter(
    (entry) =>
      (asked.component === undefined || entry.component === asked.component) &&
      (asked.operation === undefined || entry.operation === asked.operation),
  )
  return reply(OperationTable, {
    covered: period,
    rows,
    runs: rows.reduce((sum, entry) => sum + entry.runs, 0),
    errors: rows.reduce((sum, entry) => sum + entry.errors, 0),
    dataUntil: period.to,
  })
}

const runs = ({ asked, period }: Question) =>
  Effect.gen(function* () {
    const step = yield* stepOf(asked)
    const slow = asked.operation === "GET /api/feed"
    return yield* reply(RunSeries, {
      covered: period,
      step,
      points: stepsOf(period, step).map((start, index) => ({
        start: DateTime.makeUnsafe(start),
        runs: 40 + (index % 7) * 6,
        errors: index % 9 === 0 ? 1 : 0,
        p50Ms: 60,
        p80Ms: 120,
        p95Ms: slow ? 620 : 240 + (index % 5) * 20,
        p99Ms: 900,
      })),
    })
  })

// The export's runs kept: its slowest, which failed, and the next slowest. Kept 14 days.
const keptRuns = ({ asked, period, now }: Question) => {
  const kept = (trace: TraceId, ago: number, durationMs: number, status: number) => ({
    trace,
    component: api,
    environment: EnvironmentKey.make("production"),
    operation: EnvelopeName.make("POST /api/export"),
    start: DateTime.makeUnsafe(now - ago),
    durationMs,
    failed: status >= 500,
    status,
  })
  const failed = kept(exportTrace, 40 * minute, 4_210, 500)
  const slow = kept(TraceId.make("9c41e07b2d5af6831e0c7d2b4a9f6e15"), 3 * hour, 2_870, 200)
  const ofExport = asked.operation === undefined || asked.operation === "POST /api/export"
  return reply(KeptRuns, {
    covered: new Period({
      from: DateTime.makeUnsafe(Math.max(DateTime.toEpochMillis(period.from), now - 14 * day)),
      to: period.to,
    }),
    slowest: ofExport ? [failed, slow] : [],
    failed: ofExport ? [failed] : [],
  })
}

// Happening now, and seen for days; and new today.
const groupsOf = (period: Period): ReadonlyArray<ErrorGroup> => {
  const to = DateTime.toEpochMillis(period.to)
  return [
    {
      id: ongoing,
      kind: "exception",
      title: "NpgsqlException: Failed to connect to 10.0.0.5:5432",
      culprit: "Notes.Api.Exports.ExportStore.SaveAsync",
      occurrences: 42,
      firstSeen: DateTime.makeUnsafe(to - 3 * day),
      lastSeen: DateTime.makeUnsafe(to - 2 * minute),
      lastComponent: api,
      lastRelease: ReleaseVersion.make("1.8.2"),
    },
    {
      id: fresh,
      kind: "exception",
      title: "TimeoutException: The export took longer than 30 seconds",
      culprit: "Notes.Api.Exports.ExportEndpoint.HandleAsync",
      occurrences: 7,
      firstSeen: DateTime.makeUnsafe(to - 3 * hour),
      lastSeen: DateTime.makeUnsafe(to - 50 * minute),
      lastComponent: api,
    },
  ]
}

const errors = ({ asked, period }: Question) => {
  const groups = asked.component === ios ? [] : groupsOf(period)
  return reply(ErrorTable, {
    covered: period,
    groups,
    occurrences: groups.reduce((sum, group) => sum + group.occurrences, 0),
  })
}

const stack = [
  "Npgsql.NpgsqlException (0x80004005): Failed to connect to 10.0.0.5:5432",
  "   at Npgsql.Internal.NpgsqlConnector.Connect(NpgsqlTimeout timeout)",
  "   at Npgsql.NpgsqlConnection.OpenAsync(CancellationToken cancellationToken)",
  "   at Notes.Api.Exports.ExportStore.SaveAsync(Export export) in /src/Notes.Api/Exports/ExportStore.cs:line 48",
  "   at Notes.Api.Exports.ExportEndpoint.HandleAsync(ExportRequest request) in /src/Notes.Api/Exports/ExportEndpoint.cs:line 31",
].join("\n")

const line = (id: number, at: number, fields: Partial<LogLine> & Pick<LogLine, "level" | "message">): LogLine => ({
  id,
  component: api,
  time: DateTime.makeUnsafe(at),
  category: "Notes.Api.Exports.ExportEndpoint",
  attributes: {},
  ...fields,
})

const linesOf = (period: Period): ReadonlyArray<LogLine> => {
  const to = DateTime.toEpochMillis(period.to)
  return [
    line(3, to - 2 * minute, {
      level: "error",
      message: "Export 51c2 failed after 3 attempts",
      trace: exportTrace,
      error: ongoing,
      exception: { type: "Npgsql.NpgsqlException", message: "Failed to connect to 10.0.0.5:5432", stack },
    }),
    line(2, to - 20 * minute, { level: "warn", message: "Retrying the export, attempt 2 of 3" }),
    line(1, to - 50 * minute, { level: "error", message: "The export took longer than 30 seconds", error: fresh }),
  ]
}

const error = ({ period }: Question, id: string) => {
  const group = groupsOf(period).find((entry) => entry.id === id)
  if (group === undefined) {
    return reply(ErrorGroupNotFound, new ErrorGroupNotFound({ error: ErrorGroupId.make(id) }), 404)
  }
  return reply(ErrorDetail, { group, latest: linesOf(period).filter((entry) => entry.error === group.id) })
}

const logs = ({ asked, period }: Question) => {
  const errorsOnly = asked.level === "error"
  const search = asked.search?.toLowerCase()
  return reply(LogPage, {
    covered: period,
    lines: linesOf(period).filter(
      (entry) =>
        (!errorsOnly || entry.level !== "warn") &&
        (search === undefined || entry.message.toLowerCase().includes(search)),
    ),
  })
}

const logCounts = ({ asked, period }: Question) =>
  Effect.gen(function* () {
    const step = yield* stepOf(asked)
    const starts = stepsOf(period, step)
    const series = (key: string, every: number) => {
      const points = starts
        .filter((_, index) => index % every === 0)
        .map((start) => ({ start: DateTime.makeUnsafe(start), count: 2 }))
      return { key, total: points.length * 2, points }
    }
    const errorsOnly = asked.level === "error"
    const byLevel = [...(errorsOnly ? [] : [series("warn", 3)]), series("error", 5)]
    const byComponent = [series(api, 5)]
    const byError = [series(ongoing, 5), series(fresh, 11)]
    const kept = { level: byLevel, component: byComponent, error: byError }[asked.by ?? "level"]
    if (kept === undefined) {
      return yield* Effect.die(`The fake API counts logs by level, component, or error, not ${asked.by}.`)
    }
    return yield* reply(LogCounts, { covered: period, step, series: kept })
  })

const trace = (around: number, id: string) => {
  const start = around - 4_000
  const span = (
    spanId: string,
    depth: number,
    name: string,
    kind: "server" | "client" | "internal",
    offset: number,
    durationMs: number,
    attributes: Record<string, string>,
  ) => ({
    span: SpanId.make(spanId),
    ...(depth === 0 ? {} : { parent: SpanId.make("a1a1a1a1a1a1a1a1") }),
    depth,
    name,
    kind,
    component: api,
    start: DateTime.makeUnsafe(start + offset),
    durationMs,
    failed: depth === 0,
    attributes,
    events: [],
  })
  return reply(TraceView, {
    trace: TraceId.make(id),
    searched: new Period({
      from: DateTime.makeUnsafe(around - 2 * minute),
      to: DateTime.makeUnsafe(around + 2 * minute),
    }),
    spans:
      id === exportTrace
        ? [
            span("a1a1a1a1a1a1a1a1", 0, "POST /api/export", "server", 0, 4_210, { "http.route": "/api/export" }),
            span("b2b2b2b2b2b2b2b2", 1, "INSERT exports", "client", 3_840, 12, { "db.system.name": "postgresql" }),
          ]
        : [],
    logs:
      id === exportTrace
        ? [
            {
              time: DateTime.makeUnsafe(start + 4_100),
              level: "error" as const,
              category: "Notes.Api.Exports.ExportEndpoint",
              message: "Export 51c2 failed after 3 attempts",
              span: SpanId.make("a1a1a1a1a1a1a1a1"),
              component: api,
              attributes: {},
            },
          ]
        : [],
    files: { read: 2, unread: 0 },
  })
}

const signedOut = reply(
  Unauthorized,
  new Unauthorized({ message: "This call needs the API token: send it as a bearer token, or sign in with it." }),
  401,
)

const SignInBody = Schema.fromJsonString(Schema.Struct({ token: Schema.String }))

const noSuchCall = (method: string, path: ReadonlyArray<string>) =>
  Effect.die(`The fake API has no ${method} /api/${path.join("/")}.`)

/**
 * The public API with Notes in it, signed in or not; `workspace` replaces the workspace's projects,
 * such as none for a workspace that has just been set up.
 */
export const notesApi = ({
  signedIn = true,
  workspace = projects,
}: { readonly signedIn?: boolean; readonly workspace?: ReadonlyArray<Project> } = {}): AnswerApi => {
  let session = signedIn
  return (call) =>
    Effect.gen(function* () {
      const [first, project, area, id, more] = call.path
      if (call.method === "POST" && first === "sign-in") {
        const { token } = yield* Schema.decodeEffect(SignInBody)(call.body ?? "").pipe(Effect.orDie)
        if (token !== notesToken) {
          return yield* reply(Unauthorized, new Unauthorized({ message: "The API token is wrong." }), 401)
        }
        session = true
        return { status: 204 }
      }
      if (call.method === "POST" && first === "sign-out") {
        session = false
        return { status: 204 }
      }
      if (!session) {
        return yield* signedOut
      }
      if (first !== "projects") {
        return yield* noSuchCall(call.method, call.path)
      }
      if (project === undefined) {
        return yield* reply(ProjectList, { projects: workspace })
      }
      const known = workspace.find((entry) => entry.key === project)
      if (known === undefined) {
        return yield* Effect.die(`The fake API has no project ${project}.`)
      }
      const isNotes = known.key === notes
      if (area === undefined) {
        return yield* reply(ProjectDetail, { project: known, components: isNotes ? components : [] })
      }
      if (!isNotes) {
        return yield* Effect.die(`The fake API answers only Notes's signals, not ${project}'s.`)
      }
      const asked = yield* Schema.decodeEffect(Asked)(Object.fromEntries(call.query)).pipe(Effect.orDie)
      if (area === "traces" && id !== undefined) {
        const now = yield* Clock.currentTimeMillis
        return yield* trace(asked.around === undefined ? now : DateTime.toEpochMillis(asked.around), id)
      }
      if (asked.from === undefined || asked.to === undefined) {
        return yield* Effect.die(`The dashboard asked for ${area} without a period.`)
      }
      const question = {
        asked,
        period: new Period({ from: asked.from, to: asked.to }),
        now: yield* Clock.currentTimeMillis,
      }
      if (area === "operations") {
        return yield* operations(question)
      }
      if (area === "runs") {
        return yield* id === "kept" ? keptRuns(question) : runs(question)
      }
      if (area === "errors") {
        return yield* id === undefined ? errors(question) : error(question, id)
      }
      if (area === "logs") {
        return yield* id === "counts" && more === undefined ? logCounts(question) : logs(question)
      }
      return yield* noSuchCall(call.method, call.path)
    })
}
