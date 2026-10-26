import { FeedList } from "@cluenori/feeds"
import {
  calendarDayOf,
  ComponentKey,
  EnvelopeName,
  EnvironmentKey,
  Instant,
  MemberId,
  NotAllowed,
  Period,
  ProjectKey,
  ReleaseVersion,
  TraceId,
  Uuidv7,
} from "@cluenori/foundation"
import {
  AddMonitor,
  Incident,
  IncidentDetail,
  IncidentId,
  IncidentList,
  IncidentNotFound,
  Monitor,
  MonitorDetail,
  MonitorId,
  MonitorList,
  MonitorNotFound,
  MonitorUrl,
} from "@cluenori/incidents"
import type { MonitorDay, MonitorState } from "@cluenori/incidents"
import { Email, Member, MemberList } from "@cluenori/members"
import {
  BundleId,
  Component,
  ComponentLinks,
  ComponentName,
  ComponentNotFound,
  DeployTarget,
  Project,
  ProjectDetail,
  ProjectList,
  ProjectName,
  ProjectSettings,
} from "@cluenori/projects"
import type {
  ComparedOperation,
  ComponentDelivery,
  EnvironmentDelivery,
  NextStep,
  PromotionState,
  ReleaseChanges,
  ReleaseNote,
  ReleaseSummary,
  SourceProblem,
  LifePoint,
  ReleaseLife,
} from "@cluenori/releases"
import {
  AppStoreSubmission,
  ComponentVersion,
  ComponentVersions,
  defaultNotesStyle,
  Delivery,
  DraftUnavailable,
  NoteLocale,
  NotesDraft,
  NotesStyle,
  NoteText,
  Promotion,
  PromotionId,
  PromotionInProgress,
  PromotionNotFound,
  PromotionReason,
  PromotionRefused,
  ReleaseCommit,
  ReleaseDetail,
  ReleaseList,
  ReleaseNotes,
  ReleaseNotFound,
  Runner,
  SemanticVersion,
  BuildNumber,
  VersionRefused,
  compareVersions,
  hasEnded,
} from "@cluenori/releases"
import type { OperationRow, SeriesStep } from "@cluenori/signals"
import {
  OperationTable,
  LogLine,
  LogLineNotFound,
  ErrorDetail,
  ErrorGroup,
  ErrorGroupId,
  ErrorGroupNotFound,
  ErrorTable,
  KeptTraces,
  LogCounts,
  LogMessageDetail,
  LogMessageId,
  LogMessageNotFound,
  LogMessageTable,
  LogPage,
  LoadSeries,
  SeriesStep as SeriesStepSchema,
  SpanId,
  errorStatusOf,
  operationKeyOf,
  slowerOperations,
  stepMillis,
  TraceView,
  UsageDay,
} from "@cluenori/signals"
import { Unauthorized } from "@cluenori/worker"
import { Clock, DateTime, Effect, Schema } from "effect"

import type { TodayList } from "@/project-data"

import type { AnswerApi, ApiCall } from "./fake-api.ts"
import { reply } from "./fake-api.ts"
import { withApps } from "./notes-apps.ts"

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
// A background service the API's workflow deploys too, in the world of the first numbered release.
const worker = ComponentKey.make("notes-worker")
const created = DateTime.makeUnsafe("2026-09-01T00:00:00Z")

const projects = [
  new Project({ key: notes, name: ProjectName.make("Notes"), createdAt: created }),
  new Project({ key: ProjectKey.make("landing"), name: ProjectName.make("Landing"), createdAt: created }),
]

const production = EnvironmentKey.make("production")
const staging = EnvironmentKey.make("staging")
export const workflowFile = (name: string) => DeployTarget.fields.workflow.schema.make(name)
export const repositoryOf = (name: string) => ComponentLinks.fields.repository.schema.make(name)

// The API is linked to its repository, with a workflow that deploys to each environment, staging
// first; the iPhone app, without its repository, to its App Store app, whose builds go to App Store
// review.
const linksAtStart: ReadonlyMap<string, ComponentLinks> = new Map([
  [
    api,
    {
      repository: repositoryOf("notesapp/notes-api"),
      deployTargets: [
        { environment: staging, workflow: workflowFile("promote-to-staging.yml") },
        { environment: production, workflow: workflowFile("promote-to-prod.yml") },
      ],
    },
  ],
  [
    ios,
    {
      deployTargets: [
        {
          environment: production,
          appStore: { bundleId: BundleId.make("com.notesapp.notes"), distribution: "appStore" },
        },
      ],
    },
  ],
])

/**
 * The iPhone app linked to three App Store Connect apps: its repository, and a target for internal
 * testers, one for beta testers, and the App Store, each built by `ios.yml` into its own app.
 */
export const iosWithThreeApps: ReadonlyMap<string, ComponentLinks> = new Map([
  ...linksAtStart,
  [
    ios,
    {
      repository: repositoryOf("notesapp/notes-ios"),
      deployTargets: [
        {
          environment: EnvironmentKey.make("internal"),
          workflow: workflowFile("ios.yml"),
          appStore: { bundleId: BundleId.make("com.notesapp.notes.internal"), distribution: "testFlight" },
        },
        {
          environment: EnvironmentKey.make("beta"),
          workflow: workflowFile("ios.yml"),
          appStore: { bundleId: BundleId.make("com.notesapp.notes.beta"), distribution: "testFlight" },
        },
        {
          environment: production,
          workflow: workflowFile("ios.yml"),
          appStore: { bundleId: BundleId.make("com.notesapp.notes"), distribution: "appStore" },
        },
      ],
    },
  ],
])

// Who signs in: Ada, an owner; Mira is a member.
export const ada = new Member({
  id: MemberId.make("0199a000-1111-7aaa-8aaa-000000000001"),
  role: "owner",
  email: Email.make("ada@notesapp.dev"),
  addedAt: created,
  passkeys: 1,
})
export const mira = new Member({
  id: MemberId.make("0199a000-2222-7bbb-8bbb-000000000002"),
  role: "member",
  email: Email.make("mira@notesapp.dev"),
  projects: [notes],
  addedAt: created,
  passkeys: 1,
})

// The project's components, by key: the API and the iPhone app, and the worker where it has links.
const componentsWith = (links: ReadonlyMap<string, ComponentLinks>) => [
  new Component({ key: api, name: ComponentName.make("Notes API"), createdAt: created, ...links.get(api) }),
  new Component({ key: ios, name: ComponentName.make("Notes for iOS"), createdAt: created, ...links.get(ios) }),
  ...(links.has(worker)
    ? [
        new Component({
          key: worker,
          name: ComponentName.make("Notes worker"),
          createdAt: created,
          ...links.get(worker),
        }),
      ]
    : []),
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
  environment: Schema.optionalKey(Schema.String),
  operation: Schema.optionalKey(Schema.String),
  level: Schema.optionalKey(Schema.String),
  search: Schema.optionalKey(Schema.String),
  by: Schema.optionalKey(Schema.String),
  release: Schema.optionalKey(Schema.String),
  message: Schema.optionalKey(Schema.String),
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
  count: number,
  errors: number,
  [p50Ms, p80Ms, p95Ms, p99Ms]: readonly [number, number, number, number],
): OperationRow => ({
  component: api,
  operation: EnvelopeName.make(operation),
  count,
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

// Whether a question about one release is about one of the API's, which ran its operations, wrote
// its log lines, and had its errors: the latest's, as the API's answers have them.
const ofApiRelease = (asked: Asked) =>
  asked.release === undefined || apiReleases.some((entry) => entry === asked.release)
const ofLatestApiRelease = (asked: Asked) => asked.release === undefined || asked.release === worseRelease

// Whether a question is about production, where the API's errors and log lines are; staging runs a
// little of the same, without failing.
const ofProduction = (asked: Asked) => asked.environment === undefined || asked.environment === "production"
const inStaging = (entry: OperationRow): OperationRow => ({
  ...entry,
  environment: EnvironmentKey.make("staging"),
  count: Math.max(1, Math.round(entry.count / 40)),
  errors: 0,
})

// The import, retired: it last ran 3 days ago, and only a question about it alone lists it.
const retired = "POST /api/import"
const retiredRow = row(retired, 140, 2, [200, 340, 610, 900])

const operations = ({ asked, period, now }: Question) => {
  // The 7 days before the last day end a day ago; every other question ends now.
  const usual = now - DateTime.toEpochMillis(period.to) > 12 * hour
  const retiredUntil = now - 3 * day
  const coversRetired = DateTime.toEpochMillis(period.from) < retiredUntil
  const rows = [
    ...(usual ? usualRows : lastDayRows),
    ...(asked.operation === retired && coversRetired ? [retiredRow] : []),
  ]
    .filter(
      (entry) =>
        ofApiRelease(asked) &&
        (asked.component === undefined || entry.component === asked.component) &&
        (asked.operation === undefined || entry.operation === asked.operation),
    )
    .map((entry) => (ofProduction(asked) ? entry : inStaging(entry)))
  const known =
    asked.operation === undefined ||
    asked.operation === retired ||
    lastDayRows.some((entry) => entry.operation === asked.operation)
  return reply(OperationTable, {
    covered: period,
    rows,
    count: rows.reduce((sum, entry) => sum + entry.count, 0),
    errors: rows.reduce((sum, entry) => sum + entry.errors, 0),
    ...(rows.length === 0 ? {} : { dataUntil: period.to }),
    ...(known ? { lastSeen: DateTime.makeUnsafe(asked.operation === retired ? retiredUntil : now - minute) } : {}),
  })
}

const load = ({ asked, period }: Question) =>
  Effect.gen(function* () {
    const step = yield* stepOf(asked)
    const slow = asked.operation === "GET /api/feed"
    return yield* reply(LoadSeries, {
      covered: period,
      step,
      points: stepsOf(period, step).map((start, index) => ({
        start: DateTime.makeUnsafe(start),
        count: ofProduction(asked) ? 40 + (index % 7) * 6 : 1 + (index % 3),
        errors: ofProduction(asked) && index % 9 === 0 ? 1 : 0,
        p50Ms: 60,
        p80Ms: 120,
        p95Ms: slow ? 620 : 240 + (index % 5) * 20,
        p99Ms: 900,
      })),
    })
  })

// The export's traces kept: its slowest, which failed, and the next slowest. Kept 14 days.
const keptTraces = ({ asked, period, now }: Question) => {
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
  const from = Math.max(DateTime.toEpochMillis(period.from), now - 14 * day)
  const inPeriod = (entry: typeof failed) =>
    ofExport &&
    DateTime.toEpochMillis(entry.start) >= from &&
    DateTime.toEpochMillis(entry.start) < DateTime.toEpochMillis(period.to)
  return reply(KeptTraces, {
    covered: new Period({ from: DateTime.makeUnsafe(from), to: period.to }),
    slowest: [failed, slow].filter(inPeriod),
    failed: [failed].filter(inPeriod),
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
      lastRelease: worseRelease,
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
  const groups = asked.component === ios || !ofLatestApiRelease(asked) || !ofProduction(asked) ? [] : groupsOf(period)
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

// Each line written by the API's latest release, in production.
const line = (
  id: number,
  at: number,
  fields: Partial<LogLine> & Pick<LogLine, "level" | "message" | "messageId">,
): LogLine => ({
  id,
  component: api,
  time: DateTime.makeUnsafe(at),
  category: "Notes.Api.Exports.ExportEndpoint",
  environment: EnvironmentKey.make("production"),
  release: worseRelease,
  attributes: {},
  ...fields,
})

const linesOf = (period: Period): ReadonlyArray<LogLine> => {
  const to = DateTime.toEpochMillis(period.to)
  return [
    line(3, to - 2 * minute, {
      level: "error",
      message: "Export 51c2 failed after 3 attempts",
      messageId: LogMessageId.make(1),
      trace: exportTrace,
      error: ongoing,
      exception: { type: "Npgsql.NpgsqlException", message: "Failed to connect to 10.0.0.5:5432", stack },
    }),
    line(2, to - 20 * minute, {
      level: "warn",
      message: "Retrying the export, attempt 2 of 3",
      messageId: LogMessageId.make(2),
    }),
    line(1, to - 50 * minute, {
      level: "error",
      message: "The export took longer than 30 seconds",
      messageId: LogMessageId.make(3),
      error: fresh,
    }),
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
        (asked.release === undefined || entry.release === asked.release) &&
        (asked.environment === undefined || entry.environment === asked.environment) &&
        (!errorsOnly || entry.level !== "warn") &&
        (asked.message === undefined || `${entry.messageId}` === asked.message) &&
        (search === undefined || entry.message.toLowerCase().includes(search)),
    ),
  })
}

// How many lines each message had in the period: more of the export's failures than of the others.
const messageLines: Readonly<Record<number, number>> = { 1: 42, 2: 18, 3: 7 }

// Each line is a message of its own, named by its template, seen first three days before it.
const titles: Readonly<Record<number, string>> = {
  1: "Export {ExportId} failed after {Attempts} attempts",
  2: "Retrying the export, attempt {Attempt} of {Attempts}",
  3: "The export took longer than {Seconds} seconds",
}

const linesOfMessage = (entry: LogLine) => messageLines[entry.messageId] ?? 1

const messageOf = (entry: LogLine, lines: number) => ({
  id: entry.messageId,
  level: entry.level,
  title: titles[entry.messageId] ?? entry.message,
  category: entry.category,
  lines,
  firstSeen: DateTime.makeUnsafe(DateTime.toEpochMillis(entry.time) - 3 * day),
  lastSeen: entry.time,
  lastComponent: entry.component,
  ...(entry.environment === undefined ? {} : { lastEnvironment: entry.environment }),
  ...(entry.release === undefined ? {} : { lastRelease: entry.release }),
})

const logMessages = ({ asked, period }: Question) => {
  const errorsOnly = asked.level === "error"
  const search = asked.search?.toLowerCase()
  const shown = linesOf(period).filter(
    (entry) =>
      ofLatestApiRelease(asked) &&
      ofProduction(asked) &&
      asked.component !== ios &&
      (!errorsOnly || entry.level !== "warn") &&
      (search === undefined || entry.message.toLowerCase().includes(search)),
  )
  const messages = shown.map((entry) => messageOf(entry, linesOfMessage(entry)))
  return reply(LogMessageTable, {
    covered: period,
    messages: messages.toSorted((left, right) => right.lines - left.lines),
    unshown: 0,
    lines: messages.reduce((sum, message) => sum + message.lines, 0),
  })
}

const logMessage = ({ asked, period }: Question, id: string) => {
  const entry = linesOf(period).find((each) => `${each.messageId}` === id)
  if (entry === undefined) {
    return reply(LogMessageNotFound, new LogMessageNotFound({ logMessage: LogMessageId.make(Number(id)) }), 404)
  }
  const inScope = ofLatestApiRelease(asked) && ofProduction(asked) && asked.component !== ios
  return reply(LogMessageDetail, {
    message: messageOf(entry, inScope ? (messageLines[entry.messageId] ?? 1) : 0),
    errors: inScope ? groupsOf(period).filter((group) => group.id === entry.error) : [],
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
    const byMessage = [series("1", 5), series("2", 3), series("3", 11)]
    const kept = { level: byLevel, component: byComponent, error: byError, message: byMessage }[asked.by ?? "level"]
    if (kept === undefined) {
      return yield* Effect.die(`The fake API counts logs by level, component, or error, not ${asked.by}.`)
    }
    return yield* reply(LogCounts, {
      covered: period,
      step,
      series: ofLatestApiRelease(asked) && ofProduction(asked) ? kept : [],
    })
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
    attributes: Record<string, string | number>,
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
            span("a1a1a1a1a1a1a1a1", 0, "POST /api/export", "server", 0, 4_210, {
              "http.route": "/api/export",
              "http.response.status_code": 500,
            }),
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

// Releases, each component's versions as its telemetry, its CI's deploy reports, and App Store
// Connect know them. The API's latest went out 3 hours ago and made the feed slower and the export
// fail more, with a new error; GitHub knows its pull requests. The one before it made things better;
// only its deploy report listed its commits. Staging ran the latest first. The iPhone app's latest
// build is in review, with no telemetry yet; the one before is on day 3 of its phased release, while
// phones still run the one before that, the first counted. GitHub refused 8 minutes ago: Cluenori
// isn't connected to it.
const worseRelease = ReleaseVersion.make("2026.10.21-e91f09c")
const betterRelease = ReleaseVersion.make("2026.10.20-7b2c4d1")
const sameRelease = ReleaseVersion.make("2026.10.17-c3d9a02")
const firstApiRelease = ReleaseVersion.make("2026.10.14-5e8f210")
const apiReleases = [worseRelease, betterRelease, sameRelease, firstApiRelease]
export const inReviewRelease = ReleaseVersion.make("1.9.0+420")
export const appRelease = ReleaseVersion.make("1.8.2+412")
const firstAppRelease = ReleaseVersion.make("1.8.1+398")

const sha = (text: string) => ReleaseCommit.fields.sha.make(text)
const repository = "https://github.com/notesapp/notes-api"
const worseSha = sha("e91f09c4b7a2d85f3c6e1b0a9d4f7c2e8b5a3d61")
const betterSha = sha("7b2c4d1e8f3a6b9c0d5e2f7a4b1c8d3e6f9a0b25")

// Counts are kept by the minute: a release runs from the start of its first to the end of its last.
const minuteOf = (at: number) => DateTime.makeUnsafe(at - (at % minute))

const release = (
  now: number,
  fields: Omit<ReleaseSummary, "firstSeen" | "lastSeen" | "slower" | "failingMore" | "newErrors"> & {
    /** How long ago it first and last ran; absent without telemetry. */
    readonly ran?: readonly [number, number]
    readonly worse?: readonly [number, number, number]
  },
): ReleaseSummary => {
  const { ran, worse = [0, 0, 0], ...summary } = fields
  const [slower, failingMore, newErrors] = worse
  return {
    ...summary,
    ...(ran === undefined
      ? {}
      : {
          firstSeen: minuteOf(now - ran[0]),
          lastSeen: DateTime.makeUnsafe(DateTime.toEpochMillis(minuteOf(now - ran[1])) + minute),
        }),
    slower,
    failingMore,
    newErrors,
  }
}

// Every release, the latest first, as the API lists them.
const releasesAt = (now: number): ReadonlyArray<ReleaseSummary> => [
  release(now, {
    component: ios,
    release: inReviewRelease,
    previous: appRelease,
    verdict: "unmeasured",
    store: {
      version: "1.9.0",
      buildNumber: "420",
      uploadedAt: DateTime.makeUnsafe(now - 5 * hour),
      stage: "inReview",
      appStoreState: "IN_REVIEW",
      internalTesting: "IN_BETA_TESTING",
      externalTesting: "IN_BETA_TESTING",
    },
  }),
  release(now, {
    component: ios,
    environment: production,
    release: appRelease,
    ran: [40 * minute, 2 * minute],
    count: 820,
    errors: 3,
    previous: firstAppRelease,
    verdict: "tooEarly",
    store: {
      version: "1.8.2",
      buildNumber: "412",
      uploadedAt: DateTime.makeUnsafe(now - 4 * day),
      stage: "releasing",
      appStoreState: "READY_FOR_SALE",
      phasedRelease: { state: "ACTIVE", startedAt: DateTime.makeUnsafe(now - 2 * day - 3 * hour), day: 3 },
    },
  }),
  release(now, {
    component: api,
    environment: production,
    release: worseRelease,
    ran: [3 * hour, minute],
    count: 9_640,
    errors: 51,
    previous: betterRelease,
    verdict: "worse",
    worse: [1, 1, 1],
    commit: {
      sha: worseSha,
      message: "Share a note by link (#212)",
      author: "mira",
      committedAt: DateTime.makeUnsafe(now - 3 * hour - 40 * minute),
      url: `${repository}/commit/${worseSha}`,
    },
    deployedAt: DateTime.makeUnsafe(now - 3 * hour - 2 * minute),
  }),
  release(now, {
    component: api,
    environment: staging,
    release: worseRelease,
    ran: [5 * hour, 4 * hour + 20 * minute],
    count: 340,
    errors: 2,
    verdict: "first",
    commit: {
      sha: worseSha,
      message: "Share a note by link (#212)",
      author: "mira",
      committedAt: DateTime.makeUnsafe(now - 3 * hour - 40 * minute),
      url: `${repository}/commit/${worseSha}`,
    },
    deployedAt: DateTime.makeUnsafe(now - 5 * hour - 3 * minute),
  }),
  release(now, {
    component: api,
    environment: production,
    release: betterRelease,
    ran: [27 * hour, 3 * hour],
    count: 61_200,
    errors: 96,
    previous: sameRelease,
    verdict: "better",
    // Only its deploy report named its commit: GitHub refused the token since.
    commit: { sha: betterSha, tag: "prod-2026.10.20-7b2c4d1" },
    deployedAt: DateTime.makeUnsafe(now - 27 * hour - 4 * minute),
  }),
  release(now, {
    component: api,
    environment: production,
    release: sameRelease,
    ran: [4 * day + 2 * hour, 27 * hour],
    count: 190_400,
    errors: 410,
    previous: firstApiRelease,
    verdict: "same",
  }),
  release(now, {
    component: ios,
    environment: production,
    release: firstAppRelease,
    ran: [6 * day, 5 * minute],
    count: 14_300,
    errors: 21,
    verdict: "first",
    store: {
      version: "1.8.1",
      buildNumber: "398",
      uploadedAt: DateTime.makeUnsafe(now - 9 * day),
      stage: "replaced",
      appStoreState: "REPLACED_WITH_NEW_VERSION",
    },
  }),
  release(now, {
    component: api,
    environment: production,
    release: firstApiRelease,
    ran: [8 * day, 4 * day + 2 * hour],
    count: 88_000,
    errors: 300,
    verdict: "first",
  }),
]

const problemsAt = (now: number): ReadonlyArray<SourceProblem> => [
  {
    component: api,
    source: "github",
    problem:
      "GitHub refused: Cluenori isn't connected to GitHub yet: an owner connects it on the web, on the GitHub page.",
    at: DateTime.makeUnsafe(now - 8 * minute),
  },
]

const promotionId = (n: number) => PromotionId.make(`019a1000-0000-7000-8000-${String(n).padStart(12, "0")}`)

// How the API's latest release was promoted from Cluenori: to staging by CI, then to production by
// Mira, each run ended.
const promotionsAt = (now: number): ReadonlyArray<Promotion> => [
  {
    id: promotionId(2),
    component: api,
    release: worseRelease,
    environment: production,
    repository: repositoryOf("notesapp/notes-api"),
    workflow: workflowFile("promote-to-prod.yml"),
    runner: "auto",
    startedBy: mira.id,
    reason: PromotionReason.make("Share links for everyone"),
    startedAt: DateTime.makeUnsafe(now - 3 * hour - 6 * minute),
    state: "succeeded",
    run: { id: 9_120, url: `${repository}/actions/runs/9120` },
    endedAt: DateTime.makeUnsafe(now - 3 * hour - 2 * minute),
  },
  {
    id: promotionId(1),
    component: api,
    release: worseRelease,
    environment: staging,
    repository: repositoryOf("notesapp/notes-api"),
    workflow: workflowFile("promote-to-staging.yml"),
    runner: "auto",
    startedAt: DateTime.makeUnsafe(now - 5 * hour - 6 * minute),
    state: "succeeded",
    run: { id: 9_087, url: `${repository}/actions/runs/9087` },
    endedAt: DateTime.makeUnsafe(now - 5 * hour - 3 * minute),
  },
]

export const approvedId = PromotionId.make("019a1000-0000-7000-8000-000000000023")

// The iPhone app's promotions: to the App Store, approved and waiting to be released; to beta,
// processing; and an earlier one to the App Store, rejected.
export const appStorePromotions = (now: number): ReadonlyArray<Promotion> => {
  const ofApp = {
    component: ios,
    release: appRelease,
    repository: repositoryOf("notesapp/notes-ios"),
    workflow: workflowFile("ios.yml"),
    runner: "auto" as const,
  }
  return [
    {
      ...ofApp,
      id: approvedId,
      environment: production,
      appStore: { bundleId: BundleId.make("com.notesapp.notes"), distribution: "appStore" },
      submission: { releaseType: "manual", phased: true },
      startedAt: DateTime.makeUnsafe(now - 26 * 60 * 60_000),
      state: "approved",
      run: { id: 9_310, url: "https://github.com/notesapp/notes-ios/actions/runs/9310" },
    },
    {
      ...ofApp,
      id: PromotionId.make("019a1000-0000-7000-8000-000000000022"),
      environment: EnvironmentKey.make("beta"),
      appStore: { bundleId: BundleId.make("com.notesapp.notes.beta"), distribution: "testFlight" },
      startedAt: DateTime.makeUnsafe(now - 27 * 60 * 60_000),
      state: "processing",
      run: { id: 9_305, url: "https://github.com/notesapp/notes-ios/actions/runs/9305" },
    },
    {
      ...ofApp,
      id: PromotionId.make("019a1000-0000-7000-8000-000000000021"),
      environment: production,
      appStore: { bundleId: BundleId.make("com.notesapp.notes"), distribution: "appStore" },
      submission: { releaseType: "afterApproval", phased: true },
      startedAt: DateTime.makeUnsafe(now - 50 * 60 * 60_000),
      state: "rejected",
      run: { id: 9_290, url: "https://github.com/notesapp/notes-ios/actions/runs/9290" },
      endedAt: DateTime.makeUnsafe(now - 40 * 60 * 60_000),
    },
  ]
}

// Whether a release did anything in a period, as the API lists it: ran, was deployed, or was uploaded then.
const activeIn = (entry: ReleaseSummary, from: number, to: number) => {
  const within = (time: DateTime.Utc | undefined) =>
    time !== undefined && DateTime.toEpochMillis(time) >= from && DateTime.toEpochMillis(time) < to
  const ran =
    entry.firstSeen !== undefined &&
    entry.lastSeen !== undefined &&
    DateTime.toEpochMillis(entry.lastSeen) > from &&
    DateTime.toEpochMillis(entry.firstSeen) < to
  return ran || within(entry.deployedAt) || within(entry.store?.uploadedAt)
}

const releases = ({ asked, period, now }: Question, world: World) => {
  const from = DateTime.toEpochMillis(period.from)
  const to = DateTime.toEpochMillis(period.to)
  return reply(ReleaseList, {
    releases: world
      .releasesAt(now)
      .filter(
        (entry) => activeIn(entry, from, to) && (asked.component === undefined || entry.component === asked.component),
      ),
    problems: problemsAt(now).filter((entry) => asked.component === undefined || entry.component === asked.component),
  })
}

const compared = (
  operation: string,
  [count, failed, p95Ms]: readonly [number, number, number],
  [previousCount, previousErrors, previousP95Ms]: readonly [number, number, number],
): ComparedOperation => ({
  operation: EnvelopeName.make(operation),
  count,
  errors: failed,
  p95Ms,
  previousCount,
  previousErrors,
  previousP95Ms,
})

const releaseIncident = (
  now: number,
  id: string,
  title: string,
  [opened, resolved]: readonly [number, number | undefined],
) =>
  new Incident({
    id: IncidentId.make(id),
    component: api,
    environment: production,
    subject: "POST /api/export",
    title,
    evidence: {
      _tag: "failing",
      operation: EnvelopeName.make("POST /api/export"),
      failed: 10,
      count: 50,
      usualRate: 0.001,
    },
    openedAt: DateTime.makeUnsafe(now - opened),
    ...(resolved === undefined ? {} : { resolvedAt: DateTime.makeUnsafe(now - resolved) }),
  })

// What changed in the repository since the release before: in the API's latest, as GitHub tells it,
// with its pull requests; in the one before it, the commits its deploy report listed.
const changesOf = (now: number, summary: ReleaseSummary): ReleaseChanges | undefined => {
  if (summary.release === worseRelease && summary.environment === production) {
    const commit = (id: string, message: string, author: string, ago: number, pullRequest: number) => ({
      sha: sha(id),
      message,
      author,
      committedAt: DateTime.makeUnsafe(now - ago),
      url: `${repository}/commit/${id}`,
      pullRequest,
    })
    return {
      totalCommits: 4,
      commits: [
        commit(worseSha, "Share a note by link (#212)", "mira", 3 * hour + 40 * minute, 212),
        commit(
          "c4d8e2f6a0b3c7d1e5f9a2b6c0d4e8f1a5b9c3d7",
          "Retry exports on connection errors (#214)",
          "theo",
          5 * hour,
          214,
        ),
        commit(
          "a1f3e5c7b9d2f4a6c8e0b2d4f6a8c1e3b5d7f9a2",
          "Load the feed with one query (#209)",
          "theo",
          9 * hour,
          209,
        ),
        commit("f0e2d4c6b8a1c3e5d7f9b2a4c6e8d0f1b3a5c7e9", "Bump Npgsql to 9.0.2 (#211)", "dependabot", 20 * hour, 211),
      ],
      pullRequests: [
        {
          number: 214,
          title: "Retry exports on connection errors",
          author: "theo",
          url: "https://github.com/notesapp/notes-api/pull/214",
          labels: ["bug", "exports"],
        },
        {
          number: 212,
          title: "Share a note by link",
          author: "mira",
          url: "https://github.com/notesapp/notes-api/pull/212",
          labels: ["feature"],
        },
        {
          number: 211,
          title: "Bump Npgsql to 9.0.2",
          author: "dependabot",
          url: "https://github.com/notesapp/notes-api/pull/211",
          labels: ["dependencies"],
        },
        {
          number: 209,
          title: "Load the feed with one query",
          author: "theo",
          url: "https://github.com/notesapp/notes-api/pull/209",
          labels: ["performance"],
        },
      ],
      filesChanged: 23,
      additions: 640,
      deletions: 182,
      url: `${repository}/compare/7b2c4d1...e91f09c`,
    }
  }
  if (summary.release === firstNumbered && summary.component === api) {
    const commit = (id: string, message: string, author: string, ago: number, pullRequest: number) => ({
      sha: sha(id),
      message,
      author,
      committedAt: DateTime.makeUnsafe(now - ago),
      url: `${repository}/commit/${id}`,
      pullRequest,
    })
    return {
      totalCommits: 2,
      commits: [
        commit(numberedSha, "Open shared notes offline (#218)", "theo", 2 * hour + 20 * minute, 218),
        commit("d3a9f6c2e8b5a1d7f4c0e6b3a9d5f2c8e1b7a4d0", "Retry exports that time out (#217)", "mira", 6 * hour, 217),
      ],
      pullRequests: [
        {
          number: 218,
          title: "Open shared notes offline",
          author: "theo",
          url: "https://github.com/notesapp/notes-api/pull/218",
          labels: ["feature"],
        },
        {
          number: 217,
          title: "Retry exports that time out",
          author: "mira",
          url: "https://github.com/notesapp/notes-api/pull/217",
          labels: ["bug", "exports"],
        },
      ],
      filesChanged: 9,
      additions: 214,
      deletions: 61,
      url: `${repository}/compare/e91f09c...b8e4f1a`,
    }
  }
  if (summary.release === betterRelease) {
    const reported = (id: string, message: string, author: string, ago: number) => ({
      sha: sha(id),
      message,
      author,
      committedAt: DateTime.makeUnsafe(now - ago),
    })
    return {
      totalCommits: 3,
      commits: [
        reported(betterSha, "Cache the notes list per account", "theo", 28 * hour),
        reported("9d1b3f5a7c0e2d4f6b8a1c3e5d7f9a0b2c4e6d8f", "Fail an export once, not three times", "mira", 30 * hour),
        reported("2e4a6c8e0b1d3f5a7c9e1b3d5f7a9c0e2b4d6f8a", "Log the export's size", "mira", 31 * hour),
      ],
      pullRequests: [],
    }
  }
  return undefined
}

// A release's life as the API counts it: by the hour while it ran under 3 days, else by UTC day,
// its runs and failures spread over its steps, a few warnings and errors with them, and the people
// of the iPhone app's releases; the API's release before the latest left one hour uncounted.
const lifeOf = (summary: ReleaseSummary): ReleaseLife | undefined => {
  if (summary.firstSeen === undefined || summary.lastSeen === undefined || summary.count === undefined) {
    return undefined
  }
  const from = DateTime.toEpochMillis(summary.firstSeen)
  const to = DateTime.toEpochMillis(summary.lastSeen)
  const stepping = [
    ["5m", 6 * hour, 5 * minute],
    ["1h", 3 * day, hour],
  ] as const
  const [step, , width] = stepping.find(([, under]) => to - from < under) ?? (["1d", Infinity, day] as const)
  const first = from - (from % width)
  const steps = Math.max(1, Math.ceil((to - first) / width))
  const weights = Array.from(
    { length: steps },
    (_, index) => 1.1 + Math.sin(index * 0.9) * 0.6 + Math.cos(index * 0.37) * 0.3,
  )
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  const spread = (value: number) => weights.map((weight) => Math.round((value * weight) / total))
  const requests = spread(summary.count)
  const failed = spread(summary.errors ?? 0)
  const app = summary.component === ios
  const uncounted = summary.release === betterRelease ? 6 : -1
  const points = requests.map((count, index): LifePoint => ({
    start: DateTime.makeUnsafe(first + index * width),
    ...(index === uncounted ? {} : { requests: count, failed: failed[index] ?? 0, p95Ms: 180 + ((index * 37) % 90) }),
    warnings: Math.round(count / 400),
    // Only the API's latest logged errors.
    errors: summary.release === worseRelease ? Math.round((failed[index] ?? 0) / 3) : 0,
    ...(app && step === "1d" ? { people: Math.round(count / 9) } : {}),
  }))
  const sum = (of: (point: LifePoint) => number | undefined) => points.reduce((all, point) => all + (of(point) ?? 0), 0)
  return {
    step,
    points,
    totals: {
      from: summary.firstSeen,
      to: summary.lastSeen,
      requests: sum((point) => point.requests),
      failed: sum((point) => point.failed),
      warnings: sum((point) => point.warnings),
      errors: sum((point) => point.errors),
      ...(app ? { people: Math.round(summary.count / 6) } : {}),
    },
  }
}

// What moved in a release against the one before it, each the biggest change first: in the API's
// latest, in production, and in the one before it; nothing in the others.
const movedIn = (now: number, summary: ReleaseSummary) => {
  if (
    summary.release === worseRelease &&
    summary.environment === production &&
    summary.firstSeen !== undefined &&
    summary.lastSeen !== undefined
  ) {
    const ran = new Period({ from: summary.firstSeen, to: summary.lastSeen })
    return {
      slower: [compared("GET /api/feed", [2_400, 0, 620], [15_800, 0, 290])],
      failingMore: [compared("POST /api/export", [410, 13, 4_300], [2_600, 10, 4_100])],
      faster: [compared("GET /api/notes", [5_900, 6, 62], [38_000, 40, 180])],
      newOperations: [EnvelopeName.make("POST /api/notes/{id}/share")],
      errors: groupsOf(ran).map((group) => (group.id === fresh ? { ...group, firstRelease: worseRelease } : group)),
      incidents: [
        releaseIncident(now, "0199f7a2-6d2f-7e4b-8c3a-5f9b2d7e1a64", "POST /api/export: 20% failed, usually 0.1%", [
          40 * minute,
          undefined,
        ]),
        releaseIncident(now, "0199f74c-1b0e-7c55-9a21-3d4e8f6b2c90", "POST /api/export: 8% failed, usually 0.1%", [
          2 * hour + 30 * minute,
          2 * hour,
        ]),
      ],
    }
  }
  if (summary.release === betterRelease) {
    return {
      faster: [compared("GET /api/notes/{id}", [24_000, 3, 140], [71_000, 12, 260])],
      failingLess: [compared("POST /api/export", [7_100, 28, 4_000], [21_800, 410, 4_200])],
    }
  }
  return {}
}

// One release against the one before it, with its promotions, the latest first, its notes, and its
// component's deploy targets; or the API's 404 for one it doesn't know.
const releaseDetail = (
  now: number,
  world: World,
  component: string,
  version: string,
  environment: string | undefined,
  promotions: ReadonlyArray<Promotion>,
  links: ReadonlyMap<string, ComponentLinks>,
  releaseNotes: ReadonlyArray<ReleaseNote>,
  numbered: ReadonlyArray<ReleaseSummary>,
) => {
  // A release numbered for a commit nothing has seen yet is found in whichever environment is asked.
  const unseen = numbered.find((entry) => entry.component === component && entry.release === version)
  const summary =
    world
      .releasesAt(now)
      .find(
        (entry) => entry.component === component && entry.release === version && entry.environment === environment,
      ) ??
    (unseen === undefined
      ? undefined
      : { ...unseen, ...(environment === undefined ? {} : { environment: EnvironmentKey.make(environment) }) })
  if (summary === undefined) {
    return reply(
      ReleaseNotFound,
      new ReleaseNotFound({ component: ComponentKey.make(component), release: ReleaseVersion.make(version) }),
      404,
    )
  }
  const none = {
    slower: [],
    failingMore: [],
    faster: [],
    failingLess: [],
    newOperations: [],
    errors: [],
    incidents: [],
  }
  const changes = changesOf(now, summary)
  const life = lifeOf(summary)
  const previous = world
    .releasesAt(now)
    .find(
      (entry) =>
        entry.component === summary.component &&
        entry.environment === summary.environment &&
        entry.release === summary.previous,
    )
  const before = previous === undefined ? undefined : lifeOf(previous)
  const linkedRepository = links.get(summary.component)?.repository
  return reply(ReleaseDetail, {
    summary,
    ...(life === undefined ? {} : { life: { ...life, ...(before === undefined ? {} : { previous: before.totals }) } }),
    ...none,
    ...movedIn(now, summary),
    ...(changes === undefined ? {} : { changes }),
    problems: problemsAt(now).filter((entry) => entry.component === summary.component),
    promotions: promotions.filter((entry) => entry.component === summary.component && entry.release === version),
    deployTargets: links.get(summary.component)?.deployTargets ?? [],
    notes: releaseNotes,
    ...(linkedRepository === undefined ? {} : { repository: linkedRepository }),
    // Cluenori published the API's production releases on its repository's Releases page.
    ...(summary.component === "notes-api" && summary.environment === "production" && linkedRepository !== undefined
      ? {
          gitHubRelease: {
            url: `https://github.com/${linkedRepository}/releases/tag/${summary.release}`,
            publishedAt: DateTime.makeUnsafe(now),
          },
        }
      : {}),
  })
}

const signedOut = reply(
  Unauthorized,
  new Unauthorized({ message: "This call needs the API token: send it as a bearer token, or sign in with it." }),
  401,
)

const SignInBody = Schema.fromJsonString(Schema.Struct({ token: Schema.String }))
const LinksBody = Schema.fromJsonString(ComponentLinks)
const PromoteLatestBody = Schema.fromJsonString(
  Schema.Struct({
    environment: EnvironmentKey,
    commit: Schema.optionalKey(ReleaseCommit.fields.sha),
    reason: Schema.optionalKey(PromotionReason),
    runner: Schema.optionalKey(Runner),
    submission: Schema.optionalKey(AppStoreSubmission),
  }),
)
// The newest commit on a repository's default branch, as GitHub would say.
export const newestCommit = sha("5d2e8a7c1b9f4e6a3c0d8b2f7e1a9c4d6b3f0e82")

const PromoteBody = Schema.fromJsonString(
  Schema.Struct({
    environment: EnvironmentKey,
    reason: Schema.optionalKey(PromotionReason),
    runner: Schema.optionalKey(Runner),
    submission: Schema.optionalKey(AppStoreSubmission),
  }),
)
const NotesBody = Schema.fromJsonString(Schema.Struct({ notes: ReleaseNotes }))
const DraftBody = Schema.fromJsonString(Schema.Struct({ environment: EnvironmentKey }))
const VersionBody = Schema.fromJsonString(
  Schema.Struct({ version: SemanticVersion, firstBuild: Schema.optionalKey(BuildNumber) }),
)
const StyleBody = Schema.fromJsonString(NotesStyle)

// The API's version line when the tests start: its builds numbered up to 57 in 1.4.0; the iPhone
// app has none yet.
const versionsAt: ReadonlyArray<ComponentVersion> = [
  { component: api, version: SemanticVersion.make("1.4.0"), lastBuild: 57, setAt: created },
]

// What a draft of a release's notes says, as the project's language model would write it.
const draftText = NoteText.make(
  "Share a note with anyone by a link.\nExports that failed on a bad connection now finish on their own.",
)
const SettingsBody = Schema.fromJsonString(ProjectSettings)
const AddMonitorBody = Schema.fromJsonString(AddMonitor)

const noSuchCall = (method: string, path: ReadonlyArray<string>) =>
  Effect.die(`The fake API has no ${method} /api/${path.join("/")}.`)

// The API's health endpoint, which a monitor checks every minute; its last check passed.
const healthUrl = MonitorUrl.make("https://api.notes.example/health")
const healthMonitor = new Monitor({
  id: MonitorId.make("0199f7a2-6d2f-7e4b-8c3a-5f9b2d7e1a70"),
  component: api,
  condition: { _tag: "noAnswer", subject: { _tag: "url", url: healthUrl } },
  level: "alarm",
  addedAt: created,
})

// The nightly cleanup, declared a job: it runs every 30 minutes, and it ran.
const cleanupMonitor = new Monitor({
  id: MonitorId.make("0199f7a2-6d2f-7e4b-8c3a-5f9b2d7e1a71"),
  component: api,
  environment: EnvironmentKey.make("production"),
  condition: {
    _tag: "nothingFor",
    subject: { _tag: "operation", operation: EnvelopeName.make("cleanup.run") },
    minutes: 60,
  },
  level: "timeSensitive",
  addedAt: created,
})

// The export has failed since 40 minutes ago, which the detectors saw: one open incident. Two days
// ago the health endpoint was down for 14 minutes.
const incidentsAt = (now: number, acknowledgedAt?: DateTime.Utc): IncidentList => ({
  open: [
    new Incident({
      id: IncidentId.make("0199f7a2-6d2f-7e4b-8c3a-5f9b2d7e1a64"),
      component: api,
      environment: EnvironmentKey.make("production"),
      subject: "POST /api/export",
      title: "POST /api/export: 20% failed, usually 0.1%",
      evidence: {
        _tag: "failing",
        operation: EnvelopeName.make("POST /api/export"),
        failed: 10,
        count: 50,
        usualRate: 0.001,
      },
      openedAt: DateTime.makeUnsafe(now - 40 * minute),
      ...(acknowledgedAt === undefined ? {} : { acknowledgedAt }),
    }),
  ],
  resolved: [
    new Incident({
      id: IncidentId.make("0199f7a2-6d2f-7e4b-8c3a-5f9b2d7e1a65"),
      component: api,
      environment: EnvironmentKey.make("production"),
      subject: healthUrl,
      title: `${healthUrl}: down`,
      evidence: { _tag: "down", monitor: healthMonitor.id, url: healthUrl, failures: 2, problem: "HTTP 503" },
      openedAt: DateTime.makeUnsafe(now - 2 * day),
      resolvedAt: DateTime.makeUnsafe(now - 2 * day + 14 * minute),
    }),
  ],
  checkedAt: DateTime.makeUnsafe(now),
  // The sync endpoint the app calls about every half hour hasn't been called for three hours: a
  // guess, shown as a hint.
  quiet: [
    {
      component: api,
      environment: EnvironmentKey.make("production"),
      operation: EnvelopeName.make("GET /api/sync"),
      usualGapMs: 30 * minute,
      lastRanAt: DateTime.makeUnsafe(now - 3 * hour),
    },
  ],
})

// Each incident's life and the release that ran when it opened: the export failed in the latest
// release, and got worse 10 minutes after it opened; the health endpoint was down, someone was on it,
// and it came back.
const incidentDetailOf = (incident: Incident, now: number): IncidentDetail => {
  const opened = DateTime.toEpochMillis(incident.openedAt)
  return incident.evidence._tag === "failing"
    ? {
        incident,
        updates: [
          { change: "opened", at: incident.openedAt, title: "POST /api/export: 8% failed, usually 0.1%" },
          { change: "worsened", at: DateTime.makeUnsafe(opened + 10 * minute), title: incident.title },
          ...(incident.acknowledgedAt === undefined
            ? []
            : [{ change: "acknowledged" as const, at: incident.acknowledgedAt }]),
        ],
        releases: [{ environment: EnvironmentKey.make("production"), release: worseRelease }],
      }
    : {
        incident,
        updates: [
          { change: "opened", at: incident.openedAt, title: incident.title },
          { change: "acknowledged", at: DateTime.makeUnsafe(opened + 3 * minute) },
          { change: "resolved", at: DateTime.makeUnsafe(now - 2 * day + 14 * minute) },
        ],
        releases: [
          { environment: EnvironmentKey.make("production"), release: betterRelease },
          { environment: EnvironmentKey.make("staging"), release: worseRelease },
        ],
      }
}

// The health endpoint's days since it was added: every minute checked, answering in about 84 ms;
// 14 checks failed two days ago, and ten days ago Cluenori didn't check it.
const monitorDaysAt = (now: number): ReadonlyArray<MonitorDay> => {
  const today = Math.floor(now / day)
  const first = Math.max(Math.floor(DateTime.toEpochMillis(created) / day), today - 89)
  return Array.from({ length: today - first + 1 }, (_, index) => first + index)
    .filter((number) => number !== today - 10)
    .map((number) => ({
      day: calendarDayOf(DateTime.makeUnsafe(number * day)),
      checks: number === today ? Math.max(1, Math.floor((now % day) / minute)) : 1440,
      failed: number === today - 2 ? 14 : 0,
      averageMs: 80 + (number % 7),
    }))
}

const monitorStateAt = (now: number): MonitorState => ({
  monitor: healthMonitor,
  lastCheck: { at: DateTime.makeUnsafe(now - minute), status: 200, ms: 84 },
  since: DateTime.makeUnsafe(now - 2 * day + 14 * minute),
  days: monitorDaysAt(now),
  firing: false,
})

const monitors = Effect.gen(function* () {
  const now = yield* Clock.currentTimeMillis
  return yield* reply(MonitorList, {
    monitors: [
      monitorStateAt(now),
      {
        monitor: cleanupMonitor,
        days: [],
        measured: { at: DateTime.makeUnsafe(now - minute), value: 2 },
        firing: false,
      },
    ],
  })
})

const monitorDetail = (id: string) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis
    if (id !== healthMonitor.id) {
      return yield* reply(MonitorNotFound, new MonitorNotFound({ monitor: MonitorId.make(id) }), 404)
    }
    const step = 5 * minute
    const last = Math.floor(now / step) * step
    const down = now - 2 * day
    return yield* reply(MonitorDetail, {
      state: monitorStateAt(now),
      recent: Array.from({ length: 288 }, (_, index) => last - (287 - index) * step).map((start, index) => ({
        start: DateTime.makeUnsafe(start),
        checks: 5,
        failed: 0,
        averageMs: 70 + ((index * 37) % 50),
        slowestMs: 120 + ((index * 53) % 90),
      })),
      failures: Array.from({ length: 14 }, (_, index) => ({
        at: DateTime.makeUnsafe(down + (13 - index) * minute),
        status: 503,
        ms: 31,
        problem: "HTTP 503",
      })),
      incidents: incidentsAt(now).resolved,
    })
  })

// Today's answer, as the API encodes it. Its schema is the Today engine's, which the dashboard
// reaches only through the API's definition, so this one is made of the same parts, and the compiler
// checks it says the same as the API's (`sameAsTheApi`).
const TodayAnswer = Schema.Struct({
  items: Schema.Array(
    Schema.Union([
      Schema.TaggedStruct("incident", { project: ProjectKey, incident: Incident }),
      Schema.TaggedStruct("error", {
        project: ProjectKey,
        error: ErrorGroup,
        isNew: Schema.Boolean,
        ongoing: Schema.Boolean,
      }),
      Schema.TaggedStruct("slower", {
        project: ProjectKey,
        component: ComponentKey,
        environment: Schema.optionalKey(EnvironmentKey),
        operation: EnvelopeName,
        p95Ms: Schema.Finite,
        usualP95Ms: Schema.Finite,
      }),
      Schema.TaggedStruct("quiet", {
        project: ProjectKey,
        component: ComponentKey,
        environment: Schema.optionalKey(EnvironmentKey),
        operation: EnvelopeName,
        usualGapMs: Schema.Finite,
        lastRanAt: Instant,
      }),
      Schema.TaggedStruct("promotion", {
        project: ProjectKey,
        component: ComponentKey,
        environment: EnvironmentKey,
        release: ReleaseVersion,
        promotion: Uuidv7,
        state: Schema.Literals(["approved", "waiting", "failed", "rejected", "lost"]),
        startedAt: Instant,
        endedAt: Schema.optionalKey(Instant),
      }),
      Schema.TaggedStruct("silent", { project: ProjectKey, lastDataAt: Schema.optionalKey(Instant) }),
    ]),
  ),
  projects: Schema.Array(Project),
  unanswered: Schema.Array(ProjectKey),
  pulses: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        project: ProjectKey,
        load: Schema.Array(Schema.Struct({ start: Instant, count: Schema.Int, errors: Schema.Int })),
        people: Schema.optionalKey(Schema.Struct({ latest: UsageDay, weekBefore: Schema.optionalKey(UsageDay) })),
      }),
    ),
  ),
  at: Instant,
})
const sameAsTheApi = (answer: TodayList): typeof TodayAnswer.Type => answer
const sameAsThisOne = (answer: typeof TodayAnswer.Type): TodayList => answer

type TodayItem = TodayList["items"][number]

// Today's order: incidents not acknowledged, errors happening now, then new ones, slower operations,
// releases that need a member, then projects that sent nothing.
const todayRank = (item: TodayItem) =>
  ({ incident: 0, error: item._tag === "error" && item.ongoing ? 1 : 2, slower: 3, quiet: 4, promotion: 5, silent: 6 })[
    item._tag
  ]

// What Today says of a promotion: one that waits for a member, or ended without its release getting
// there, the latest to each of the project's production environments.
const promotionItemsOf = (
  promotions: ReadonlyArray<Promotion>,
  productionEnvironments: ReadonlyArray<EnvironmentKey>,
): ReadonlyArray<TodayItem> => {
  const latest = new Map<string, Promotion>()
  for (const promotion of promotions) {
    const key = `${promotion.component} ${promotion.environment}`
    const earlier = latest.get(key)
    if (
      earlier === undefined ||
      DateTime.toEpochMillis(earlier.startedAt) < DateTime.toEpochMillis(promotion.startedAt)
    ) {
      latest.set(key, promotion)
    }
  }
  return [...latest.values()].flatMap((promotion): ReadonlyArray<TodayItem> => {
    const { state } = promotion
    const needsAMember =
      state === "approved" || state === "waiting" || state === "failed" || state === "rejected" || state === "lost"
    if (!productionEnvironments.includes(promotion.environment) || !needsAMember) {
      return []
    }
    return [
      {
        _tag: "promotion",
        project: notes,
        component: promotion.component,
        environment: promotion.environment,
        release: promotion.release,
        promotion: promotion.id,
        state,
        startedAt: promotion.startedAt,
        ...(promotion.endedAt === undefined ? {} : { endedAt: promotion.endedAt }),
      },
    ]
  })
}

/**
 * Notes's pulse at `now`: its API's load in production by the hour, every hour of the last 24
 * answered, and its iPhone app's people yesterday and the same day a week before, when the app had
 * sent for under 30 days, so without monthly people. Landing's has no load and no people.
 */
const pulsesAt = (now: number, workspace: ReadonlyArray<Project>): NonNullable<TodayList["pulses"]> => {
  const thisHour = Math.floor(now / hour) * hour
  const dayOn = (daysAgo: number, people: number) => ({
    day: calendarDayOf(DateTime.makeUnsafe(now - daysAgo * day)),
    people,
    installations: people,
    weekPeople: people * 4,
    sessions: people * 2,
    foregroundMs: people * 6 * minute,
  })
  return workspace.map((project) =>
    project.key === notes
      ? {
          project: project.key,
          load: Array.from({ length: 24 }, (_, index) => ({
            start: DateTime.makeUnsafe(thisHour - (23 - index) * hour),
            count: 40 + (index % 7) * 6,
            errors: index % 9 === 0 ? 1 : 0,
          })),
          people: { latest: dayOn(1, 46), weekBefore: dayOn(8, 43) },
        }
      : { project: project.key, load: [] },
  )
}

/**
 * What needs attention now across `workspace`, as Today works it out at `now` in the environments
 * each project calls production: Notes's open incident, its errors happening now or new, its
 * operations slower than over the 7 days before, and its promotions that need a member; and how each
 * project is going, unless the deployment is `older` than pulses. Landing, without components, has
 * nothing to say.
 */
const todayAt = (
  now: number,
  workspace: ReadonlyArray<Project>,
  promotions: ReadonlyArray<Promotion>,
  productionEnvironments: ReadonlyArray<EnvironmentKey>,
  older: boolean,
): TodayList => {
  const lastDay = new Period({ from: DateTime.makeUnsafe(now - day), to: DateTime.makeUnsafe(now) })
  const slower = slowerOperations({
    lastDay: { rows: lastDayRows, count: 0, errors: 0 },
    usual: { rows: usualRows, count: 0, errors: 0 },
  })
  const notesItems: TodayList["items"] = [
    ...incidentsAt(now).open.map((incident) => ({ _tag: "incident" as const, project: notes, incident })),
    ...groupsOf(lastDay).flatMap((group) => {
      const status = errorStatusOf(group, now)
      return status.isNew || status.ongoing
        ? [{ _tag: "error" as const, project: notes, error: { ...group, lastEnvironment: production }, ...status }]
        : []
    }),
    ...lastDayRows.flatMap((each) => {
      const found = slower.get(operationKeyOf(each))
      return found === undefined
        ? []
        : [
            {
              _tag: "slower" as const,
              project: notes,
              component: each.component,
              environment: production,
              operation: each.operation,
              ...found,
            },
          ]
    }),
    ...incidentsAt(now).quiet.map((quiet) => ({ _tag: "quiet" as const, project: notes, ...quiet })),
    ...promotionItemsOf(promotions, productionEnvironments),
  ]
  return sameAsThisOne({
    items: workspace.some((project) => project.key === notes)
      ? notesItems.toSorted((left, right) => todayRank(left) - todayRank(right))
      : [],
    projects: workspace,
    unanswered: [],
    ...(older ? {} : { pulses: pulsesAt(now, workspace) }),
    at: DateTime.makeUnsafe(now),
  })
}

/** Today's answer, encoded as the API sends it. */
const today = (answer: TodayList) => reply(TodayAnswer, sameAsTheApi(answer))

// What a project with nothing yet, Landing, answers: no load, no incidents, nothing delivered.
const nothingYet = (call: ApiCall) =>
  Effect.gen(function* () {
    const area = call.path[2]
    if (call.method === "GET" && area === "load") {
      const step = yield* Schema.decodeUnknownEffect(SeriesStepSchema)(call.query.get("step")).pipe(Effect.orDie)
      return yield* reply(LoadSeries, { step, points: [] })
    }
    if (call.method === "GET" && area === "incidents") {
      return yield* reply(IncidentList, { open: [], resolved: [], quiet: [] })
    }
    if (call.method === "GET" && area === "monitors") {
      return yield* reply(MonitorList, { monitors: [] })
    }
    if (call.method === "GET" && area === "delivery") {
      return yield* reply(Delivery, { components: [] })
    }
    return yield* noSuchCall(call.method, call.path)
  })

// ---- The day Notes numbers its first release --------------------------------------------------------

// The API's deploys go to dev, then prod, both by `deploy.yml`, and deploy the worker too; CI
// deployed the first release Cluenori numbered, 1.0.0+1, to dev two hours ago, while prod still
// runs the API's latest dated release, which dev ran before. The iPhone app's builds go to internal
// testers, beta testers, and the App Store: build 422 is with internal testers, 421 with beta
// testers and in App Store review, and the App Store has 1.8.2, on day 3 of its phased release.
export const firstNumbered = ReleaseVersion.make("1.0.0+1")
export const internalBuild = ReleaseVersion.make("1.9.0+422")
export const betaBuild = ReleaseVersion.make("1.9.0+421")
const dev = EnvironmentKey.make("dev")
const prod = EnvironmentKey.make("prod")
const internal = EnvironmentKey.make("internal")
const beta = EnvironmentKey.make("beta")
const numberedSha = sha("b8e4f1a7c2d9e6b3a0f5c8d1e4b7a2f9c6d3e0b8")
const iosRepository = "https://github.com/notesapp/notes-ios"

const deployYml = workflowFile("deploy.yml")
const iosTargets: ReadonlyArray<DeployTarget> = [
  {
    environment: internal,
    workflow: workflowFile("ios.yml"),
    appStore: { bundleId: BundleId.make("com.notesapp.notes.internal"), distribution: "testFlight" },
  },
  {
    environment: beta,
    workflow: workflowFile("ios.yml"),
    appStore: { bundleId: BundleId.make("com.notesapp.notes.beta"), distribution: "testFlight" },
  },
  {
    environment: production,
    workflow: workflowFile("ios.yml"),
    appStore: { bundleId: BundleId.make("com.notesapp.notes"), distribution: "appStore" },
  },
]

/** The links the day Notes numbers its first release: the worker ships with the API. */
export const numberedLinks: ReadonlyMap<string, ComponentLinks> = new Map([
  [
    api,
    {
      repository: repositoryOf("notesapp/notes-api"),
      deployTargets: [
        { environment: dev, workflow: deployYml },
        { environment: prod, workflow: deployYml },
      ],
    },
  ],
  [worker, { repository: repositoryOf("notesapp/notes-api"), shipsWith: api }],
  [ios, { repository: repositoryOf("notesapp/notes-ios"), deployTargets: iosTargets }],
])

const numberedCommit = (now: number) => ({
  sha: numberedSha,
  message: "Open shared notes offline (#218)",
  author: "theo",
  committedAt: DateTime.makeUnsafe(now - 2 * hour - 20 * minute),
  url: `${repository}/commit/${numberedSha}`,
})
const worseCommit = (now: number) => ({
  sha: worseSha,
  message: "Share a note by link (#212)",
  author: "mira",
  committedAt: DateTime.makeUnsafe(now - 5 * hour - 40 * minute),
  url: `${repository}/commit/${worseSha}`,
})
const iosCommit = (id: string, message: string, at: number) => ({
  sha: sha(id),
  message,
  author: "jun",
  committedAt: DateTime.makeUnsafe(at),
  url: `${iosRepository}/commit/${id}`,
})

// Every release that day, the latest first: the API's and the worker's in dev and prod, and the
// iPhone app's builds where their apps are.
const numberedReleasesAt = (now: number): ReadonlyArray<ReleaseSummary> => {
  const ofApi = (component: typeof api, count: number) => [
    release(now, {
      component,
      environment: dev,
      release: firstNumbered,
      ran: [2 * hour, 0],
      count: Math.round(count / 20),
      errors: 0,
      previous: worseRelease,
      verdict: "tooEarly",
      commit: numberedCommit(now),
      deployedAt: DateTime.makeUnsafe(now - 2 * hour - 5 * minute),
    }),
    release(now, {
      component,
      environment: prod,
      release: worseRelease,
      ran: [3 * hour, minute],
      count,
      errors: component === api ? 51 : 0,
      previous: betterRelease,
      verdict: component === api ? "worse" : "same",
      ...(component === api ? { worse: [1, 1, 1] as const } : {}),
      commit: worseCommit(now),
      deployedAt: DateTime.makeUnsafe(now - 3 * hour - 2 * minute),
    }),
    release(now, {
      component,
      environment: dev,
      release: worseRelease,
      ran: [5 * hour, 2 * hour + 5 * minute],
      count: Math.round(count / 30),
      errors: 0,
      verdict: "first",
      commit: worseCommit(now),
      deployedAt: DateTime.makeUnsafe(now - 5 * hour - 3 * minute),
    }),
    release(now, {
      component,
      environment: prod,
      release: betterRelease,
      ran: [27 * hour, 3 * hour],
      count: count * 6,
      errors: component === api ? 96 : 0,
      verdict: "first",
      commit: { sha: betterSha, tag: "prod-2026.10.20-7b2c4d1" },
      deployedAt: DateTime.makeUnsafe(now - 27 * hour - 4 * minute),
    }),
  ]
  return [
    release(now, {
      component: ios,
      environment: internal,
      release: internalBuild,
      verdict: "unmeasured",
      commit: iosCommit(
        "a7c3e9f1b5d2a8c4e0f6b2d8a4c1e7f3b9d5a2c6",
        "Open shared notes offline (#92)",
        now - 3 * hour - 30 * minute,
      ),
      store: {
        version: "1.9.0",
        buildNumber: "422",
        uploadedAt: DateTime.makeUnsafe(now - 3 * hour),
        stage: "testing",
        internalTesting: "IN_BETA_TESTING",
      },
    }),
    ...ofApi(api, 9_640),
    ...ofApi(worker, 2_100),
    release(now, {
      component: ios,
      environment: beta,
      release: betaBuild,
      ran: [25 * hour, 30 * minute],
      count: 140,
      errors: 0,
      verdict: "first",
      commit: iosCommit(
        "c1e7a3f9d5b2c8e4a0f6d2b8c4a1e7f3d9b5c2a8",
        "Release 1.9.0 (#90)",
        now - 26 * hour - 40 * minute,
      ),
      store: {
        version: "1.9.0",
        buildNumber: "421",
        uploadedAt: DateTime.makeUnsafe(now - 26 * hour),
        stage: "inReview",
        appStoreState: "IN_REVIEW",
        internalTesting: "IN_BETA_TESTING",
        externalTesting: "IN_BETA_TESTING",
      },
    }),
    ...releasesAt(now).filter((entry) => entry.component === ios && entry.environment === production),
  ]
}

// That day's promotions: the API's dated release to prod by Mira, ended; build 421 to the App
// Store by Ada, in review; and build 422 to beta testers an hour ago, whose workflow failed.
const numberedPromotionsAt = (now: number): ReadonlyArray<Promotion> => [
  {
    id: promotionId(33),
    component: ios,
    release: internalBuild,
    environment: beta,
    repository: repositoryOf("notesapp/notes-ios"),
    workflow: workflowFile("ios.yml"),
    runner: "auto",
    appStore: { bundleId: BundleId.make("com.notesapp.notes.beta"), distribution: "testFlight" },
    startedBy: ada.id,
    startedAt: DateTime.makeUnsafe(now - hour),
    state: "failed",
    run: { id: 9_340, url: `${iosRepository}/actions/runs/9340` },
    endedAt: DateTime.makeUnsafe(now - 50 * minute),
  },
  {
    // Out of the range of those started here, which are numbered on from the count.
    id: promotionId(32),
    component: ios,
    release: betaBuild,
    environment: production,
    repository: repositoryOf("notesapp/notes-ios"),
    workflow: workflowFile("ios.yml"),
    runner: "auto",
    appStore: { bundleId: BundleId.make("com.notesapp.notes"), distribution: "appStore" },
    submission: { releaseType: "afterApproval", phased: true },
    startedBy: ada.id,
    reason: PromotionReason.make("Offline notes for everyone"),
    startedAt: DateTime.makeUnsafe(now - 20 * hour),
    state: "inReview",
    run: { id: 9_330, url: `${iosRepository}/actions/runs/9330` },
  },
  {
    id: promotionId(31),
    component: api,
    release: worseRelease,
    environment: prod,
    repository: repositoryOf("notesapp/notes-api"),
    workflow: deployYml,
    runner: "auto",
    startedBy: mira.id,
    reason: PromotionReason.make("Share links for everyone"),
    startedAt: DateTime.makeUnsafe(now - 3 * hour - 6 * minute),
    state: "succeeded",
    run: { id: 9_120, url: `${repository}/actions/runs/9120` },
    endedAt: DateTime.makeUnsafe(now - 3 * hour - 2 * minute),
  },
]

/**
 * A state of Notes's releases: its components' links, the environments its telemetry named lately
 * and those it calls production, its releases, the promotions there were, and its versions.
 */
export type World = {
  readonly linked: ReadonlyMap<string, ComponentLinks>
  readonly seen: ReadonlyArray<EnvironmentKey>
  readonly production: ReadonlyArray<EnvironmentKey>
  readonly releasesAt: (now: number) => ReadonlyArray<ReleaseSummary>
  readonly promotionsAt: (now: number) => ReadonlyArray<Promotion>
  readonly versions: ReadonlyArray<ComponentVersion>
}

/** Notes as it has run for weeks: production and staging, the API's dated releases, the app's builds. */
export const weeksIn: World = {
  linked: linksAtStart,
  seen: [production, staging],
  production: [production],
  releasesAt,
  promotionsAt,
  versions: versionsAt,
}

/**
 * Notes the day it numbers its first release: the API in dev and prod, the worker shipping with
 * it, the iPhone app's three apps, and production called prod for the API and production for the
 * app.
 */
export const firstNumberedDay: World = {
  linked: numberedLinks,
  seen: [prod, production, dev, beta],
  production: [prod, production],
  releasesAt: numberedReleasesAt,
  promotionsAt: numberedPromotionsAt,
  versions: [
    { component: api, version: SemanticVersion.make("1.0.0"), lastBuild: 1, setAt: created },
    { component: ios, version: SemanticVersion.make("1.9.0"), lastBuild: 422, setAt: created },
  ],
}

// When a release reached an environment, as the API's delivery reads it: an App Store app's build
// once released there, a TestFlight build once processed, when uploaded; elsewhere, when it was last
// deployed there or first ran there, whichever is later.
const reachedAt = (summary: ReleaseSummary, target: DeployTarget | undefined): number | undefined => {
  const store = summary.store
  if (target?.appStore !== undefined) {
    if (store === undefined) {
      return undefined
    }
    if (target.appStore.distribution === "appStore") {
      const out = store.stage === "releasing" || store.stage === "live"
      return out ? DateTime.toEpochMillis(store.phasedRelease?.startedAt ?? store.uploadedAt) : undefined
    }
    const testable = store.stage !== "processing" && store.stage !== "failed" && store.stage !== "expired"
    return testable ? DateTime.toEpochMillis(store.uploadedAt) : undefined
  }
  const times = [summary.deployedAt, summary.firstSeen].flatMap((time) =>
    time === undefined ? [] : [DateTime.toEpochMillis(time)],
  )
  return times.length === 0 ? undefined : Math.max(...times)
}

/**
 * Each component's delivery, as the API works it out (`deliveryOf` in Releases): its deploy
 * targets' environments, or those it ran in; in each, the release that reached it last, the
 * promotion to it that hasn't ended, the latest promotion to it when that one failed and nothing
 * reached it since it started, and the next step: to the first with a workflow, building the latest
 * commit; to each after it, the release of the one before, when that appeared later.
 */
const deliveryOf = (
  components: ReadonlyArray<Component>,
  summaries: ReadonlyArray<ReleaseSummary>,
  promotions: ReadonlyArray<Promotion>,
  versions: ReadonlyArray<ComponentVersion>,
): Delivery => {
  // When a release first appeared anywhere, which orders a component's releases.
  const appeared = (summary: ReleaseSummary | undefined) => {
    if (summary === undefined) {
      return Number.NEGATIVE_INFINITY
    }
    const times = summaries
      .filter((each) => each.component === summary.component && each.release === summary.release)
      .flatMap((each) =>
        [each.firstSeen, each.deployedAt, each.store?.uploadedAt].flatMap((time) =>
          time === undefined ? [] : [DateTime.toEpochMillis(time)],
        ),
      )
    return Math.min(...times)
  }
  const deliveryOfOne = (component: Component): ComponentDelivery => {
    const own = summaries.filter((summary) => summary.component === component.key)
    const targets = component.deployTargets ?? []
    const environments =
      targets.length > 0
        ? targets.map((target) => ({ environment: target.environment, target }))
        : [...new Set(own.flatMap((summary) => (summary.environment === undefined ? [] : [summary.environment])))]
            .toSorted()
            .map((environment) => ({ environment, target: undefined }))
    const stages = environments.map(({ environment, target }) => {
      const current = own
        .filter((summary) => summary.environment === environment)
        .flatMap((summary) => {
          const at = reachedAt(summary, target)
          return at === undefined ? [] : [{ summary, at }]
        })
        .toSorted((a, b) => b.at - a.at)[0]
      const toHere = promotions
        .filter((each) => each.component === component.key && each.environment === environment)
        .toSorted((a, b) => DateTime.toEpochMillis(b.startedAt) - DateTime.toEpochMillis(a.startedAt))
      const promotion = toHere.find((each) => !hasEnded(each.state))
      // The latest promotion here, when it ended without its release getting here and nothing came since.
      const last = toHere[0]
      const unsuccessful =
        last !== undefined &&
        (last.state === "failed" || last.state === "cancelled" || last.state === "rejected" || last.state === "lost")
      const failedPromotion =
        unsuccessful && (current === undefined || current.at < DateTime.toEpochMillis(last.startedAt))
          ? last
          : undefined
      return { environment, target, current, promotion, failedPromotion }
    })
    const nextOf = (
      stage: (typeof stages)[number],
      before: (typeof stages)[number] | undefined,
    ): NextStep | undefined => {
      if (stage.target === undefined || stage.promotion !== undefined) {
        return undefined
      }
      if (before === undefined) {
        return stage.target.workflow === undefined ? undefined : { _tag: "buildLatest" }
      }
      const candidate = before.current?.summary
      if (
        candidate === undefined ||
        candidate.release === stage.current?.summary.release ||
        appeared(candidate) <= appeared(stage.current?.summary)
      ) {
        return undefined
      }
      return { _tag: "promote", release: candidate.release, from: before.environment }
    }
    const version = versions.find((each) => each.component === component.key)
    return {
      component: component.key,
      ...(component.shipsWith === undefined ? {} : { shipsWith: component.shipsWith }),
      ...(version === undefined ? {} : { version }),
      environments: stages.map((stage, index): EnvironmentDelivery => {
        const next = nextOf(stage, stages[index - 1])
        return {
          environment: stage.environment,
          ...(stage.target === undefined ? {} : { target: stage.target }),
          ...(stage.current === undefined
            ? {}
            : { current: { summary: stage.current.summary, since: DateTime.makeUnsafe(stage.current.at) } }),
          ...(stage.promotion === undefined ? {} : { promotion: stage.promotion }),
          ...(stage.failedPromotion === undefined ? {} : { failedPromotion: stage.failedPromotion }),
          ...(next === undefined ? {} : { next }),
        }
      }),
    }
  }
  return { components: components.map(deliveryOfOne) }
}

/**
 * The public API with Notes in it, signed in or not, as Ada, an owner, or as Mira, a member, `as`
 * says; `workspace` replaces the workspace's projects, such as none for a workspace that has just
 * been set up. Notes is as `world` has it, as it has run for weeks unless another is given; its
 * telemetry named the world's environments lately, or those `seen` names; production is the
 * world's until the dashboard changes it, as it changes components' links and promotes releases. A
 * promotion started here moves through the states `following` lists, one each time its release is
 * asked for after it started, as Cluenori follows its run on GitHub; it stays starting without
 * them. An `older` deployment says neither environments nor settings. Its apps' analytics, SDK keys
 * and version policy are `withApps`'.
 */
export const notesApi = ({
  signedIn = true,
  as = ada,
  workspace = projects,
  world = weeksIn,
  seen = world.seen,
  older = false,
  following = [],
  linked = world.linked,
  seeded,
  drafts = true,
}: {
  readonly signedIn?: boolean
  readonly as?: Member
  readonly workspace?: ReadonlyArray<Project>
  /** The state of Notes's releases at the start: `weeksIn`, or `firstNumberedDay`. */
  readonly world?: World
  readonly seen?: ReadonlyArray<EnvironmentKey>
  readonly older?: boolean
  readonly following?: ReadonlyArray<PromotionState>
  /** Each component's links at the start, such as `iosWithThreeApps`. */
  readonly linked?: ReadonlyMap<string, ComponentLinks>
  /** The promotions there were, in place of the world's. */
  readonly seeded?: (now: number) => ReadonlyArray<Promotion>
  /** Whether a draft of notes is written; without, the model doesn't answer. */
  readonly drafts?: boolean
} = {}): AnswerApi => {
  let session = signedIn
  const links = new Map(linked)
  // Each release's notes, by component and version.
  const notesOf = new Map<string, ReadonlyArray<ReleaseNote>>()
  let versions: ReadonlyArray<ComponentVersion> = world.versions
  // Releases numbered here, from commits that had none.
  let numbered: ReadonlyArray<ReleaseSummary> = []
  let style: string | undefined
  let settings: ProjectSettings = { productionEnvironments: world.production }
  let promotions: ReadonlyArray<Promotion> | undefined
  // When someone acknowledged the open incident here, once they did.
  let acknowledgedAt: DateTime.Utc | undefined
  // The monitors added here, after the fake's own.
  const added: Array<Monitor> = []
  const incidentsNow = (now: number): IncidentList => {
    return incidentsAt(now, acknowledgedAt)
  }
  // How many times each promotion started here was asked about since.
  const timesAsked = new Map<string, number>()
  // A promotion started here, as Cluenori follows it: the next of `following`, with its run once it
  // has one, and when it ended once it has.
  const followed = (promotion: Promotion, now: number): Promotion => {
    const times = timesAsked.get(promotion.id)
    if (times === undefined) {
      return promotion
    }
    timesAsked.set(promotion.id, times + 1)
    const state = following[Math.min(times, following.length - 1)] ?? promotion.state
    const run = state === "starting" ? {} : { run: { id: 9_200, url: `${repository}/actions/runs/9200` } }
    const ended = hasEnded(state) ? { endedAt: DateTime.makeUnsafe(now) } : {}
    // Without a workflow, there is no run.
    return { ...promotion, state, ...(promotion.workflow === undefined ? {} : run), ...ended }
  }
  return withApps((call) =>
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
      if (call.method === "GET" && first === "me" && project === undefined) {
        return yield* reply(Member, as)
      }
      if (call.method === "GET" && first === "members" && project === undefined) {
        return as.role === "owner"
          ? yield* reply(MemberList, { members: [ada, mira] })
          : yield* reply(NotAllowed, new NotAllowed(), 403)
      }
      if (call.method === "GET" && first === "today" && project === undefined) {
        const now = yield* Clock.currentTimeMillis
        promotions ??= (seeded ?? world.promotionsAt)(now)
        return yield* today(todayAt(now, workspace, promotions, settings.productionEnvironments, older))
      }
      // No feeds: the feeds journey answers its own (test/feeds-journey.test.tsx).
      if (call.method === "GET" && first === "feeds" && project === undefined) {
        return yield* reply(FeedList, { feeds: [] })
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
        return yield* reply(ProjectDetail, {
          project: known,
          components: isNotes ? componentsWith(links) : [],
          ...(older ? {} : { settings, environments: isNotes ? seen : [] }),
        })
      }
      if (!isNotes) {
        return yield* nothingYet(call)
      }
      if (call.method === "PUT" && area === "settings") {
        settings = yield* Schema.decodeEffect(SettingsBody)(call.body ?? "").pipe(Effect.orDie)
        return yield* reply(ProjectSettings, settings)
      }
      if (call.method === "PUT" && area === "components" && id !== undefined && more === "links") {
        const linkedComponent = componentsWith(links).find((entry) => entry.key === id)
        if (linkedComponent === undefined) {
          return yield* reply(ComponentNotFound, new ComponentNotFound({ component: ComponentKey.make(id) }), 404)
        }
        const payload = yield* Schema.decodeEffect(LinksBody)(call.body ?? "").pipe(Effect.orDie)
        const shipsWith = payload.shipsWith
        if (
          shipsWith !== undefined &&
          (shipsWith === linkedComponent.key || !componentsWith(links).some((entry) => entry.key === shipsWith))
        ) {
          return yield* reply(ComponentNotFound, new ComponentNotFound({ component: shipsWith }), 404)
        }
        links.set(linkedComponent.key, payload)
        return yield* reply(
          Component,
          new Component({ key: linkedComponent.key, name: linkedComponent.name, createdAt: created, ...payload }),
        )
      }
      if (area === "incidents") {
        const now = yield* Clock.currentTimeMillis
        const list = incidentsNow(now)
        if (id === undefined) {
          return yield* reply(IncidentList, list)
        }
        if (call.method === "POST" && more === "acknowledge" && id === list.open[0]?.id) {
          acknowledgedAt ??= DateTime.makeUnsafe(now)
          const [acknowledged] = incidentsNow(now).open
          return yield* reply(Incident, acknowledged)
        }
        const found = [...list.open, ...list.resolved].find((incident) => incident.id === id)
        return found === undefined
          ? yield* reply(IncidentNotFound, new IncidentNotFound({ incident: IncidentId.make(id) }), 404)
          : yield* reply(IncidentDetail, incidentDetailOf(found, now))
      }
      if (call.method === "POST" && area === "monitors" && id === undefined) {
        const input = yield* Schema.decodeEffect(AddMonitorBody)(call.body ?? "").pipe(Effect.orDie)
        const monitor = new Monitor({
          id: MonitorId.make(`0199f7a2-6d2f-7e4b-8c3a-${(0x5f9b2d7e1b00 + added.length).toString(16)}`),
          ...input,
          addedAt: DateTime.makeUnsafe(yield* Clock.currentTimeMillis),
        })
        added.push(monitor)
        return yield* reply(Monitor, monitor, 201)
      }
      const addedHere = added.find((monitor) => monitor.id === id)
      if (call.method === "GET" && area === "monitors" && addedHere !== undefined) {
        return yield* reply(MonitorDetail, {
          state: { monitor: addedHere, days: [], firing: false },
          recent: [],
          failures: [],
          incidents: [],
        })
      }
      if (call.method === "GET" && area === "monitors") {
        return yield* id === undefined ? monitors : monitorDetail(id)
      }
      if (call.method === "POST" && area === "components" && id !== undefined && more === "promotions") {
        // A commit that has no release: numbered as the component's next, then promoted.
        const now = yield* Clock.currentTimeMillis
        promotions ??= (seeded ?? world.promotionsAt)(now)
        const payload = yield* Schema.decodeEffect(PromoteLatestBody)(call.body ?? "").pipe(Effect.orDie)
        const target = links.get(id)?.deployTargets?.find((each) => each.environment === payload.environment)
        const linkedRepository = links.get(id)?.repository
        if (target?.workflow === undefined || linkedRepository === undefined) {
          return yield* reply(
            PromotionRefused,
            new PromotionRefused({ reason: `${id} has no workflow for ${payload.environment}`, fix: "links" }),
            422,
          )
        }
        const versionLine = versions.find((each) => each.component === id)
        if (versionLine === undefined) {
          return yield* reply(
            PromotionRefused,
            new PromotionRefused({
              reason: `${id} has no version yet: set it, and its builds are numbered in it`,
              fix: "version",
            }),
            422,
          )
        }
        const running = promotions.find(
          (each) => each.component === id && each.environment === payload.environment && !hasEnded(each.state),
        )
        if (running !== undefined) {
          return yield* reply(PromotionInProgress, new PromotionInProgress({ promotion: running }), 409)
        }
        const build = versionLine.lastBuild + 1
        const numberedRelease = ReleaseVersion.make(`${versionLine.version}+${build}`)
        versions = versions.map((each) => (each.component === id ? { ...each, lastBuild: build } : each))
        numbered = [
          ...numbered,
          {
            component: ComponentKey.make(id),
            release: numberedRelease,
            verdict: "unmeasured",
            slower: 0,
            failingMore: 0,
            newErrors: 0,
            commit: { sha: payload.commit ?? newestCommit },
          },
        ]
        const promotion: Promotion = {
          id: promotionId(promotions.length + 1),
          component: ComponentKey.make(id),
          release: numberedRelease,
          environment: payload.environment,
          repository: linkedRepository,
          workflow: target.workflow,
          runner: payload.runner ?? "auto",
          ...(target.appStore === undefined ? {} : { appStore: target.appStore }),
          ...(target.appStore?.distribution === "appStore"
            ? { submission: payload.submission ?? { releaseType: "afterApproval", phased: true } }
            : {}),
          startedBy: as.id,
          ...(payload.reason === undefined ? {} : { reason: payload.reason }),
          startedAt: DateTime.makeUnsafe(now),
          state: "starting",
        }
        promotions = [promotion, ...promotions]
        timesAsked.set(promotion.id, 0)
        return yield* reply(Promotion, promotion, 201)
      }
      if (area === "versions") {
        if (call.method === "PUT" && id !== undefined) {
          const payload = yield* Schema.decodeEffect(VersionBody)(call.body ?? "").pipe(Effect.orDie)
          const current = versions.find((each) => each.component === id)
          if (current !== undefined && compareVersions(payload.version, current.version) < 0) {
            return yield* reply(
              VersionRefused,
              new VersionRefused({
                reason: `${payload.version} is lower than ${id}'s ${current.version}: a version only goes up`,
              }),
              422,
            )
          }
          const versionLine: ComponentVersion = {
            component: ComponentKey.make(id),
            version: payload.version,
            lastBuild: Math.max(current?.lastBuild ?? 0, (payload.firstBuild ?? 1) - 1),
            setAt: DateTime.makeUnsafe(yield* Clock.currentTimeMillis),
          }
          versions = [...versions.filter((each) => each.component !== id), versionLine]
          return yield* reply(ComponentVersion, versionLine)
        }
        return yield* reply(ComponentVersions, { versions })
      }
      if (call.method === "GET" && area === "delivery" && id === undefined) {
        const now = yield* Clock.currentTimeMillis
        promotions ??= (seeded ?? world.promotionsAt)(now)
        return yield* reply(
          Delivery,
          deliveryOf(componentsWith(links), [...world.releasesAt(now), ...numbered], promotions, versions),
        )
      }
      if (area === "notes-style") {
        if (call.method === "PUT") {
          const payload = yield* Schema.decodeEffect(StyleBody)(call.body ?? "").pipe(Effect.orDie)
          style = payload.style
          return yield* reply(NotesStyle, payload)
        }
        return yield* reply(NotesStyle, { style: style ?? defaultNotesStyle })
      }
      if (call.method === "POST" && area === "promotions" && id !== undefined && more === "release") {
        const now = yield* Clock.currentTimeMillis
        promotions ??= (seeded ?? world.promotionsAt)(now)
        const approved = promotions.find((each) => each.id === id && each.state === "approved")
        if (approved === undefined) {
          return yield* reply(PromotionNotFound, new PromotionNotFound({ promotion: PromotionId.make(id) }), 404)
        }
        // Released: App Store Connect has yet to show it live.
        const released: Promotion = { ...approved, state: "releasing" }
        promotions = promotions.map((each) => (each.id === id ? released : each))
        return yield* reply(Promotion, released)
      }
      const asked = yield* Schema.decodeEffect(Asked)(Object.fromEntries(call.query)).pipe(Effect.orDie)
      if (area === "traces" && id !== undefined) {
        const now = yield* Clock.currentTimeMillis
        return yield* trace(asked.around === undefined ? now : DateTime.toEpochMillis(asked.around), id)
      }
      if (area === "releases" && id !== undefined && more !== undefined) {
        const now = yield* Clock.currentTimeMillis
        promotions ??= (seeded ?? world.promotionsAt)(now)
        const noted = `${id} ${more}`
        if (call.method === "PUT" && call.path[5] === "notes") {
          const payload = yield* Schema.decodeEffect(NotesBody)(call.body ?? "").pipe(Effect.orDie)
          notesOf.set(noted, payload.notes)
          return yield* reply(ReleaseNotes, payload.notes)
        }
        if (call.method === "POST" && call.path[5] === "notes" && call.path[6] === "draft") {
          const payload = yield* Schema.decodeEffect(DraftBody)(call.body ?? "").pipe(Effect.orDie)
          if (!drafts) {
            return yield* reply(
              DraftUnavailable,
              new DraftUnavailable({ reason: "The language model didn't answer: try again in a minute" }),
              503,
            )
          }
          // Drafted for the target's app, in English, from what changed since the release live there.
          return yield* reply(NotesDraft, {
            notes: [{ locale: NoteLocale.make("en-US"), text: draftText }],
            ...(payload.environment === production ? { since: firstAppRelease } : {}),
            commits: 4,
          })
        }
        if (call.method === "POST" && call.path[5] === "promotions") {
          const payload = yield* Schema.decodeEffect(PromoteBody)(call.body ?? "").pipe(Effect.orDie)
          const linkedRepository = links.get(id)?.repository
          const target = links.get(id)?.deployTargets?.find((each) => each.environment === payload.environment)
          if (target === undefined || (target.workflow !== undefined && linkedRepository === undefined)) {
            return yield* reply(
              PromotionRefused,
              new PromotionRefused({ reason: `${id} has no deploy target for ${payload.environment}`, fix: "links" }),
              422,
            )
          }
          if (target.appStore?.distribution === "appStore" && (notesOf.get(noted) ?? []).length === 0) {
            return yield* reply(
              PromotionRefused,
              new PromotionRefused({
                reason: `${more} has no notes: write its What's New in en-US before it goes to App Store review`,
                fix: "notes",
              }),
              422,
            )
          }
          const promotion: Promotion = {
            id: promotionId(promotions.length + 1),
            component: ComponentKey.make(id),
            release: ReleaseVersion.make(more),
            environment: payload.environment,
            ...(target.workflow === undefined || linkedRepository === undefined
              ? {}
              : { repository: linkedRepository, workflow: target.workflow, runner: payload.runner ?? "auto" }),
            ...(target.appStore === undefined ? {} : { appStore: target.appStore }),
            ...(target.appStore?.distribution === "appStore"
              ? { submission: payload.submission ?? { releaseType: "afterApproval", phased: true } }
              : {}),
            startedBy: as.id,
            ...(payload.reason === undefined ? {} : { reason: payload.reason }),
            startedAt: DateTime.makeUnsafe(now),
            state: "starting",
          }
          promotions = [promotion, ...promotions]
          timesAsked.set(promotion.id, 0)
          return yield* reply(Promotion, promotion, 201)
        }
        promotions = promotions.map((promotion) => followed(promotion, now))
        return yield* releaseDetail(
          now,
          world,
          id,
          more,
          asked.environment,
          promotions,
          links,
          notesOf.get(noted) ?? [],
          numbered,
        )
      }
      // One warning or error by its ID, with no period: the lines as they stand now.
      if (area === "logs" && id === "lines" && more !== undefined) {
        const now = yield* Clock.currentTimeMillis
        const found = linesOf(new Period({ from: DateTime.makeUnsafe(now - day), to: DateTime.makeUnsafe(now) })).find(
          (entry) => `${entry.id}` === more,
        )
        return yield* found === undefined
          ? reply(LogLineNotFound, new LogLineNotFound({ line: Number(more) }), 404)
          : reply(LogLine, found)
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
      if (area === "load") {
        return yield* load(question)
      }
      if (area === "kept-traces") {
        return yield* keptTraces(question)
      }
      if (area === "errors") {
        return yield* id === undefined ? errors(question) : error(question, id)
      }
      if (area === "logs") {
        if (id === "messages") {
          return yield* more === undefined ? logMessages(question) : logMessage(question, more)
        }
        return yield* id === "counts" && more === undefined ? logCounts(question) : logs(question)
      }
      if (area === "releases" && id === undefined) {
        return yield* releases(question, world)
      }
      return yield* noSuchCall(call.method, call.path)
    }),
  )
}
