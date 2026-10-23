import {
  calendarDayOf,
  ComponentKey,
  EnvelopeName,
  EnvironmentKey,
  Period,
  ProjectKey,
  ReleaseVersion,
  TraceId,
} from "@cluenori/foundation"
import { Incident, IncidentId, MonitorId, MonitorUrl } from "@cluenori/incidents"
import { Project, ProjectName } from "@cluenori/projects"
import type { Delivery, Promotion, PromotionState } from "@cluenori/releases"
import { PromotionId } from "@cluenori/releases"
import type { AppUsage, ErrorGroup, LoadSeries } from "@cluenori/signals"
import { ErrorGroupId, SpanId } from "@cluenori/signals"
import { assert, describe, it } from "@effect/vitest"
import { DateTime } from "effect"

import { axisTime, dayOf, duration, share } from "@/lib/format"
import type { TodayList } from "@/project-data"
import {
  appEnvironmentsOf,
  changeOf,
  columnTimesOf,
  environmentsOf,
  exceptionsOf,
  isShownIn,
  logColumnsOf,
  loadColumnsOf,
  needsYouOf,
  operationSpanOf,
  peopleOf,
  projectStateOf,
  waitingReleasesOf,
} from "@/project-facts"

const minute = 60_000
const hour = 60 * minute
const now = Date.UTC(2026, 9, 20, 9, 40)
const at = (epochMillis: number) => DateTime.makeUnsafe(epochMillis)
const project = ProjectKey.make("notes")
const api = ComponentKey.make("notes-api")
const ios = ComponentKey.make("notes-ios")
const production = EnvironmentKey.make("production")
const staging = EnvironmentKey.make("staging")
const euProduction = EnvironmentKey.make("prod-eu")

// Ten minutes of load, 100 a minute, with these failed; `undefined` for a minute nothing reported.
const series = (failed: ReadonlyArray<number | undefined>): LoadSeries => ({
  covered: new Period({ from: at(now), to: at(now + failed.length * minute) }),
  step: "1m",
  points: failed.flatMap((errors, index) =>
    errors === undefined
      ? []
      : [{ start: at(now + index * minute), count: 100, errors, p50Ms: 20, p80Ms: 40, p95Ms: 90, p99Ms: 200 }],
  ),
})

describe("loadColumnsOf", () => {
  it("gives a step nothing reported an unknown column, never zero", () => {
    assert.deepStrictEqual(loadColumnsOf(series([1, undefined, 0]), (point) => point.errors).values, [1, undefined, 0])
  })
})

describe("logColumnsOf", () => {
  it("adds up the series asked for, a step without a point being none recorded", () => {
    const counts = {
      covered: new Period({ from: at(now), to: at(now + 3 * minute) }),
      step: "1m" as const,
      series: [
        { key: "error", total: 2, points: [{ start: at(now), count: 2 }] },
        { key: "fatal", total: 1, points: [{ start: at(now + 2 * minute), count: 1 }] },
        { key: "warn", total: 5, points: [{ start: at(now), count: 5 }] },
      ],
    }
    assert.deepStrictEqual(logColumnsOf(counts, ["error", "fatal"]).values, [2, 0, 1])
  })
})

const group = (fields: Partial<ErrorGroup>): ErrorGroup => ({
  id: ErrorGroupId.make("4f1c9a2e7b3d5068"),
  kind: "exception",
  title: "NpgsqlException: Failed to connect",
  culprit: "Notes.Api.Exports.ExportStore.SaveAsync",
  occurrences: 42,
  firstSeen: at(now - 3 * 24 * hour),
  lastSeen: at(now - hour),
  lastComponent: api,
  ...fields,
})

describe("exceptionsOf", () => {
  // A .NET exception with one inside it, as `Exception.ToString()` writes it.
  const nested = {
    type: "System.InvalidOperationException",
    message: "The export couldn't be saved",
    stack: [
      "System.InvalidOperationException: The export couldn't be saved",
      ' ---> Npgsql.PostgresException (0x80004005): 23505: duplicate key value violates unique constraint "ix_exports_id"',
      "",
      "DETAIL: Detail redacted as it may contain sensitive data.",
      "   at Npgsql.Internal.NpgsqlConnector.ReadMessageLong(Boolean async)",
      "   at Npgsql.NpgsqlDataReader.NextResult(Boolean async, Boolean isConsuming)",
      "   --- End of inner exception stack trace ---",
      "   at Notes.Api.Exports.ExportStore.SaveAsync(Export export) in /src/Exports/ExportStore.cs:line 52",
      "--- End of stack trace from previous location ---",
      "   at Notes.Api.Exports.ExportEndpoint.HandleAsync(ExportRequest request) in /src/Exports/ExportEndpoint.cs:line 31",
    ].join("\n"),
  }

  it("reads an exception and the one inside it, each with its own frames", () => {
    assert.deepStrictEqual(exceptionsOf(nested), [
      {
        type: "System.InvalidOperationException",
        message: "The export couldn't be saved",
        frames: [
          {
            method: "Notes.Api.Exports.ExportStore.SaveAsync(Export export)",
            place: "/src/Exports/ExportStore.cs:line 52",
            ours: true,
          },
          {
            method: "Notes.Api.Exports.ExportEndpoint.HandleAsync(ExportRequest request)",
            place: "/src/Exports/ExportEndpoint.cs:line 31",
            ours: true,
          },
        ],
      },
      {
        type: "Npgsql.PostgresException",
        message:
          '23505: duplicate key value violates unique constraint "ix_exports_id"\nDETAIL: Detail redacted as it may contain sensitive data.',
        frames: [
          { method: "Npgsql.Internal.NpgsqlConnector.ReadMessageLong(Boolean async)", ours: false },
          { method: "Npgsql.NpgsqlDataReader.NextResult(Boolean async, Boolean isConsuming)", ours: false },
        ],
      },
    ])
  })

  it("has one exception without frames when it came without a stack", () => {
    assert.deepStrictEqual(exceptionsOf({ type: "TimeoutException", message: "Took too long" }), [
      { type: "TimeoutException", message: "Took too long", frames: [] },
    ])
  })
})

describe("operationSpanOf", () => {
  const span = (id: string, parent: string | undefined, kind: "server" | "client") => ({
    span: SpanId.make(id),
    ...(parent === undefined ? {} : { parent: SpanId.make(parent) }),
    depth: parent === undefined ? 0 : 1,
    name: kind === "server" ? "POST /api/export" : "INSERT exports",
    kind,
    component: api,
    start: at(now),
    durationMs: 12,
    failed: false,
    attributes: {},
    events: [],
  })
  const view = {
    trace: TraceId.make("f2b7d04e9a1c3865e7d0b4a9c2f15e63"),
    searched: new Period({ from: at(now - minute), to: at(now + minute) }),
    spans: [span("a1a1a1a1a1a1a1a1", undefined, "server"), span("b2b2b2b2b2b2b2b2", "a1a1a1a1a1a1a1a1", "client")],
    logs: [],
    files: { read: 1, unread: 0 },
  }

  it("finds the operation a record was written in, from the step it was written in", () => {
    assert.strictEqual(operationSpanOf(view, SpanId.make("b2b2b2b2b2b2b2b2"))?.name, "POST /api/export")
  })

  it("takes the trace's first step for a record without one, and nothing from an empty trace", () => {
    assert.strictEqual(operationSpanOf(view, undefined)?.span, "a1a1a1a1a1a1a1a1")
    assert.isUndefined(operationSpanOf({ ...view, spans: [] }, undefined))
  })
})

describe("columnTimesOf", () => {
  it("names columns by time over a day, and by day over longer periods", () => {
    const day = columnTimesOf({ from: now, step: 20 * minute, values: Array.from({ length: 72 }, () => 0) })
    const week = columnTimesOf({ from: now, step: hour, values: Array.from({ length: 168 }, () => 0) })
    assert.strictEqual(day.whenOf(3), axisTime(now + 60 * minute))
    assert.strictEqual(week.whenOf(0), dayOf(now))
  })
})

// An incident of an operation failing, in `environment`, or in none.
const incident = (id: string, environment: EnvironmentKey | undefined) =>
  new Incident({
    id: IncidentId.make(id),
    component: api,
    ...(environment === undefined ? {} : { environment }),
    subject: "POST /api/export",
    title: `Failing in ${environment ?? "no environment"}`,
    evidence: {
      _tag: "failing",
      operation: EnvelopeName.make("POST /api/export"),
      failed: 10,
      count: 50,
      usualRate: 0.001,
    },
    openedAt: at(now - 5 * minute),
  })

// A page of a deployment that names no environments.
const everyEnvironment = { offered: [], production: [] }

// What Today answered at `now`: Notes's open incident, an error happening now, a new one, a slower
// operation, and Landing, silent.
const landing = ProjectKey.make("landing")
const today = (items: TodayList["items"], unanswered: ReadonlyArray<ProjectKey> = []): TodayList => ({
  items,
  projects: [
    new Project({ key: project, name: ProjectName.make("Notes"), createdAt: at(0) }),
    new Project({ key: landing, name: ProjectName.make("Landing"), createdAt: at(0) }),
  ],
  unanswered,
  at: at(now),
})
const answered = today([
  { _tag: "incident", project, incident: incident("0199f7a2-6d2f-7e4b-8c3a-5f9b2d7e1a64", production) },
  {
    _tag: "error",
    project,
    error: group({
      id: ErrorGroupId.make("2222222222222222"),
      lastSeen: at(now - 2 * minute),
      lastEnvironment: production,
    }),
    isNew: false,
    ongoing: true,
  },
  {
    _tag: "error",
    project,
    error: group({ id: ErrorGroupId.make("1111111111111111"), firstSeen: at(now - 2 * hour) }),
    isNew: true,
    ongoing: false,
  },
  {
    _tag: "slower",
    project,
    component: api,
    environment: production,
    operation: EnvelopeName.make("GET /api/feed"),
    p95Ms: 620,
    usualP95Ms: 300,
  },
  { _tag: "silent", project: landing, lastDataAt: at(now - 3 * 24 * hour) },
])

// A promotion of notes-ios's 2.5.0+318 to production, in `state`.
const promotion = (id: string, state: PromotionState): Promotion => ({
  id: PromotionId.make(id),
  component: ios,
  release: ReleaseVersion.make("2.5.0+318"),
  environment: production,
  startedAt: at(now - 26 * hour),
  state,
})
const delivery = (...promotions: ReadonlyArray<Promotion>): Delivery => ({
  components: [
    {
      component: ios,
      environments: promotions.map((each) => ({ environment: production, promotion: each })),
    },
  ],
})

describe("needsYouOf", () => {
  const waiting = waitingReleasesOf(
    project,
    delivery(promotion("019a1000-0000-7000-8000-000000000023", "approved")),
    at(now),
  )
  const items = needsYouOf(answered, waiting)

  it("keeps Today's order, then the releases waiting for a member", () => {
    assert.deepStrictEqual(
      items.map((item) => [item.kind, item.project]),
      [
        ["Failing", project],
        ["Happening now", project],
        ["New error", project],
        ["Slower", project],
        ["Silent", landing],
        ["Release", project],
      ],
    )
  })

  it("says each in words, with when, and opens the page that shows it", () => {
    const [failing, ongoing, fresh, slower, silent, release] = items
    assert.strictEqual(failing?.title, "POST /api/export")
    assert.strictEqual(
      failing?.detail,
      `${share(10, 50)} of 50 failed in the last 15 minutes, usually ${share(0.001, 1)}`,
    )
    assert.deepStrictEqual(failing?.to, {
      page: "operation",
      project,
      component: api,
      environment: production,
      operation: EnvelopeName.make("POST /api/export"),
    })
    assert.deepStrictEqual(ongoing?.to, {
      page: "error",
      project,
      environment: production,
      error: ErrorGroupId.make("2222222222222222"),
    })
    assert.strictEqual(ongoing?.tone, "failure")
    assert.strictEqual(fresh?.tone, "warning")
    assert.strictEqual(slower?.detail, `p95 ${duration(620)} over the last day, usually ${duration(300)}; notes-api`)
    assert.isUndefined(slower?.when)
    assert.deepStrictEqual(silent?.to, { page: "tech", project: landing })
    assert.strictEqual(release?.title, "2.5.0+318 passed App Store review")
    assert.deepStrictEqual(release?.to, {
      page: "release",
      project,
      component: ios,
      release: ReleaseVersion.make("2.5.0+318"),
      environment: production,
    })
  })

  it("opens a monitor's incident on the project's incidents, where its checks are", () => {
    const down = needsYouOf(
      today([
        {
          _tag: "incident",
          project,
          incident: new Incident({
            id: IncidentId.make("0199f7a2-6d2f-7e4b-8c3a-5f9b2d7e1a70"),
            component: api,
            subject: "https://notes.example/health",
            title: "https://notes.example/health: down",
            evidence: {
              _tag: "down",
              monitor: MonitorId.make("0199f7a2-6d2f-7e4b-8c3a-5f9b2d7e1a71"),
              url: MonitorUrl.make("https://notes.example/health"),
              failures: 3,
              problem: "HTTP 503",
            },
            openedAt: at(now - 4 * minute),
          }),
        },
      ]),
      [],
    )
    assert.deepStrictEqual(
      down.map((item) => [item.kind, item.detail, item.to]),
      [["Down", "3 checks failed in a row, the last: HTTP 503", { page: "incidents", project }]],
    )
  })
})

describe("waitingReleasesOf", () => {
  it("keeps a release approved in review, and one waiting on GitHub, and nothing else", () => {
    const states: ReadonlyArray<PromotionState> = ["running", "approved", "waiting", "inReview", "succeeded"]
    const found = waitingReleasesOf(
      project,
      delivery(...states.map((state, index) => promotion(`019a1000-0000-7000-8000-00000000003${index}`, state))),
      at(now),
    )
    assert.deepStrictEqual(
      found.map((item) => item.title),
      ["2.5.0+318 passed App Store review", "2.5.0+318 waits for approval on GitHub"],
    )
  })
})

describe("projectStateOf", () => {
  const items = needsYouOf(answered, [])

  it("colors a project as what needs the founder most there, and counts it all", () => {
    const notes = items.filter((item) => item.project === project)
    assert.deepStrictEqual(projectStateOf(notes, true), {
      tone: "failure",
      line: "1 incident · 2 errors · 1 slower operation",
    })
    assert.deepStrictEqual(projectStateOf([], true), { tone: "fine", line: "Nothing needs you" })
  })

  it("says a project that didn't answer is unknown, never fine", () => {
    assert.strictEqual(projectStateOf([], false).tone, "unknown")
  })
})

// The usage of the 15 days up to today, `now`'s, each day with as many people as `peopleOn` says.
const usage = (peopleOn: (daysAgo: number) => number | undefined): AppUsage => {
  const todayNumber = Math.floor(now / (24 * hour))
  const days = Array.from({ length: 15 }, (_, index) => 14 - index).flatMap((daysAgo) => {
    const people = peopleOn(daysAgo)
    return people === undefined
      ? []
      : [
          {
            day: calendarDayOf(at((todayNumber - daysAgo) * 24 * hour)),
            people,
            installations: people,
            monthPeople: people * 10,
            sessions: people,
            foregroundMs: 0,
          },
        ]
  })
  return { days, people: 0, installations: 0, sessions: 0, releases: [] }
}

describe("peopleOf", () => {
  it("compares the latest whole UTC day with the same day a week before", () => {
    const people = peopleOf(
      usage((daysAgo) => (daysAgo === 1 ? 53 : 50)),
      at(now),
    )
    assert.deepStrictEqual(people.daily, { value: 53, weekBefore: 50 })
    assert.deepStrictEqual(people.monthly, { value: 530, weekBefore: 500 })
    assert.closeTo(changeOf(people.daily) ?? 0, 0.06, 1e-9)
  })

  it("leaves a day the apps didn't send on unknown, and a week before without people uncompared", () => {
    const people = peopleOf(
      usage((daysAgo) => (daysAgo >= 8 ? undefined : 40)),
      at(now),
    )
    assert.deepStrictEqual(people.daily, { value: 40 })
    assert.isUndefined(changeOf(people.daily))
    assert.isUndefined(changeOf({ value: 4, weekBefore: 0 }))
  })
})

describe("appEnvironmentsOf", () => {
  const beta = EnvironmentKey.make("beta")
  const prod = EnvironmentKey.make("prod")

  it("shows the environment chosen when the apps sent from it, else their production one", () => {
    assert.strictEqual(appEnvironmentsOf([beta, production], [production], beta).shown, beta)
    assert.strictEqual(appEnvironmentsOf([beta, production], [production], prod).shown, production)
    assert.deepStrictEqual(appEnvironmentsOf([beta, production, beta], [production], undefined).offered, [
      production,
      beta,
    ])
    assert.deepStrictEqual(appEnvironmentsOf([], [production], prod), { offered: [], production: [production] })
  })
})

describe("environmentsOf", () => {
  const settings = { productionEnvironments: [EnvironmentKey.make("prod"), euProduction, production] }

  it("shows production first: the first production environment seen lately, offering every one seen", () => {
    const shown = environmentsOf({ settings, environments: [euProduction, production, staging] }, undefined)
    assert.deepStrictEqual(shown, {
      shown: euProduction,
      offered: [euProduction, production, staging],
      production: settings.productionEnvironments,
    })
  })

  it("shows the one chosen, offering it too when it wasn't seen lately", () => {
    const qa = EnvironmentKey.make("qa")
    assert.strictEqual(environmentsOf({ settings, environments: [production, staging] }, staging).shown, staging)
    assert.deepStrictEqual(environmentsOf({ settings, environments: [production] }, qa).offered, [production, qa])
  })

  it("shows the first seen when no production environment was, and none when none was", () => {
    assert.strictEqual(environmentsOf({ settings, environments: [staging] }, undefined).shown, staging)
    assert.deepStrictEqual(environmentsOf({ settings, environments: [] }, undefined), {
      offered: [],
      production: settings.productionEnvironments,
    })
  })

  it("offers the environments deploy targets go to after those seen, and shows production among them", () => {
    const dev = EnvironmentKey.make("dev")
    const prod = EnvironmentKey.make("prod")
    const components = [
      { deployTargets: [{ environment: dev }, { environment: prod }] },
      {},
      { deployTargets: [{ environment: staging }] },
    ]
    assert.deepStrictEqual(environmentsOf({ settings, environments: [staging], components }, undefined), {
      shown: prod,
      offered: [staging, dev, prod],
      production: settings.productionEnvironments,
    })
    // Production seen lately is shown before production only a deploy target goes to.
    assert.strictEqual(
      environmentsOf({ settings, environments: [staging, production], components }, undefined).shown,
      production,
    )
  })

  it("offers nothing, and shows only one named, on a deployment that says neither settings nor environments", () => {
    assert.deepStrictEqual(environmentsOf({}, undefined), { offered: [], production: [] })
    assert.deepStrictEqual(environmentsOf({}, staging), { shown: staging, offered: [staging], production: [] })
  })
})

// A page showing `shown`, of a project whose production is production.
const shownIn = (shown: EnvironmentKey) => ({ shown, offered: [production, staging], production: [production] })

describe("isShownIn", () => {
  it("keeps what is of the environment shown, and what names none in production", () => {
    assert.isTrue(isShownIn(shownIn(production), production))
    assert.isTrue(isShownIn(shownIn(production), undefined))
    assert.isFalse(isShownIn(shownIn(production), staging))
    assert.isFalse(isShownIn(shownIn(staging), undefined))
    assert.isTrue(isShownIn(everyEnvironment, staging))
  })
})
