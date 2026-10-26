import {
  calendarDayOf,
  ComponentKey,
  EnvelopeName,
  EnvironmentKey,
  Period,
  ProjectKey,
  ReleaseVersion,
  TraceId,
  Uuidv7,
} from "@cluenori/foundation"
import { Incident, IncidentId, MonitorId, MonitorUrl } from "@cluenori/incidents"
import { Project, ProjectName } from "@cluenori/projects"
import type { ErrorGroup, LoadSeries } from "@cluenori/signals"
import { ErrorGroupId, SpanId } from "@cluenori/signals"
import { assert, describe, it } from "@effect/vitest"
import { DateTime } from "effect"

import { ago, axisTime, change, compact, dayOf, duration, share } from "@/lib/format"
import { productLinesOf, projectLinesOf, projectsNowOf } from "@/product-lines"
import type { TodayList } from "@/project-data"
import {
  appEnvironmentsOf,
  changeOf,
  columnTimesOf,
  dayLoadOf,
  environmentsOf,
  exceptionsOf,
  isShownIn,
  logColumnsOf,
  loadColumnsOf,
  needsYouOf,
  operationSpanOf,
  peopleOf,
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
const incident = (id: string, environment: EnvironmentKey | undefined, acknowledgedAt?: DateTime.Utc) =>
  new Incident({
    ...(acknowledgedAt === undefined ? {} : { acknowledgedAt }),
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

// Today's item for a promotion of notes-ios's 2.5.0+318 to production, in `state`, started 26 hours
// ago, and ended 2 hours ago when its state is an end.
const promotion = (state: PromotionItemState): TodayList["items"][number] => ({
  _tag: "promotion",
  project,
  component: ios,
  environment: production,
  release: ReleaseVersion.make("2.5.0+318"),
  promotion: Uuidv7.make("019a1000-0000-7000-8000-000000000023"),
  state,
  startedAt: at(now - 26 * hour),
  ...(state === "approved" || state === "waiting" ? {} : { endedAt: at(now - 2 * hour) }),
})
type PromotionItemState = "approved" | "waiting" | "failed" | "rejected" | "lost"

describe("needsYouOf", () => {
  const items = needsYouOf({ ...answered, items: [...answered.items, promotion("approved")] })

  it("keeps Today's order", () => {
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
    const [failing, ongoing, fresh, slower, silent] = items
    assert.strictEqual(failing?.title, "POST /api/export")
    assert.strictEqual(
      failing?.detail,
      `${share(10, 50)} of 50 failed in the last 15 minutes, usually ${share(0.001, 1)}`,
    )
    assert.deepStrictEqual(failing?.to, {
      page: "incident",
      project,
      incident: IncidentId.make("0199f7a2-6d2f-7e4b-8c3a-5f9b2d7e1a64"),
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
  })

  it("opens a monitor's incident on its own page, which leads to the monitor", () => {
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
    )
    assert.deepStrictEqual(
      down.map((item) => [item.kind, item.detail, item.to]),
      [
        [
          "Down",
          "3 checks failed in a row, the last: HTTP 503",
          { page: "incident", project, incident: IncidentId.make("0199f7a2-6d2f-7e4b-8c3a-5f9b2d7e1a70") },
        ],
      ],
    )
  })
})

describe("a release that needs a member", () => {
  const states: ReadonlyArray<PromotionItemState> = ["approved", "waiting", "failed", "rejected", "lost"]
  const rows = needsYouOf(today(states.map(promotion)))

  it("says what happened and what to do, for each state, in plain words", () => {
    assert.deepStrictEqual(
      rows.map((row) => [row.title, row.detail]),
      [
        ["2.5.0+318 passed App Store review", "notes-ios to production: release it when you're ready"],
        [
          "2.5.0+318 waits for approval on GitHub",
          "notes-ios to production: approve the environment on GitHub to go on",
        ],
        [
          "Promoting 2.5.0+318 to production failed",
          "notes-ios: its workflow or its build failed, and nothing has reached production since",
        ],
        [
          "2.5.0+318 was rejected in App Store review",
          "notes-ios: change what Apple asked for, then send a new build to production",
        ],
        [
          "Promoting 2.5.0+318 to production couldn't be followed",
          "notes-ios: no run or build turned up in time; GitHub or App Store Connect has what happened",
        ],
      ],
    )
  })

  it("is purple while it waits for a member, red once it ended without getting there, and opens the release", () => {
    assert.deepStrictEqual(
      rows.map((row) => row.tone),
      ["release", "release", "failure", "failure", "failure"],
    )
    // One that ended is said from when it ended; one that waits, from when it started.
    assert.strictEqual(rows[0]?.when, ago(now - 26 * hour, now))
    assert.strictEqual(rows[2]?.when, ago(now - 2 * hour, now))
    for (const row of rows) {
      assert.deepStrictEqual(row.to, {
        page: "release",
        project,
        component: ios,
        release: ReleaseVersion.make("2.5.0+318"),
        environment: production,
      })
    }
  })
})

// Each line of a project's, as its product, its tone and its words.
const linesOf = (answer: TodayList, of: ProjectKey = project) =>
  productLinesOf(answer, of).map((line) => [line.product, line.tone, line.words])

// Its apps' daily people on the latest whole UTC day, and a week before when given.
const peopleNow = (latest: number, weekBefore?: number) => ({
  latest: usageDay(1, latest),
  ...(weekBefore === undefined ? {} : { weekBefore: usageDay(8, weekBefore) }),
})

// Today with no items and this pulse of Notes's.
const pulsed = (pulse: NonNullable<TodayList["pulses"]>[number]): TodayList => ({ ...today([]), pulses: [pulse] })

describe("productLinesOf", () => {
  it("says each product's news about a project, in Today's order, each leading to its one thing or its page", () => {
    const lines = productLinesOf({ ...answered, items: [...answered.items, promotion("approved")] }, project)
    assert.deepStrictEqual(
      lines.map((line) => [line.product, line.tone, line.words, line.items.length]),
      [
        ["uptime", "failure", "Failing: POST /api/export", 1],
        ["errors", "failure", "1 happening now · 1 new", 2],
        ["performance", "warning", "GET /api/feed slower", 1],
        ["releases", "release", "2.5.0+318 passed App Store review", 1],
      ],
    )
    // One thing behind a line: its page. Several: the product's page of the project.
    assert.deepStrictEqual(lines[0]?.to, lines[0]?.items[0]?.to)
    assert.deepStrictEqual(lines[1]?.to, { page: "errors", project })
    assert.deepStrictEqual(lines[2]?.to, lines[2]?.items[0]?.to)
  })

  it("puts the product with Today's most urgent thing first, whatever the products' order", () => {
    const acknowledged = incident("0199f7a2-6d2f-7e4b-8c3a-5f9b2d7e1a64", production, at(now - minute))
    const errorNow = answered.items[1]
    const slower = answered.items[3]
    assert.isDefined(errorNow)
    assert.isDefined(slower)
    // An error both new and happening now counts once, as happening now.
    const newAndNow = { ...errorNow, isNew: true }
    assert.deepStrictEqual(linesOf(today([newAndNow, { _tag: "incident", project, incident: acknowledged }])), [
      ["errors", "failure", "1 happening now"],
      ["uptime", "warning", "Failing: POST /api/export, acknowledged"],
    ])
    // Today puts a slower operation before a promotion that failed, red as the promotion is.
    assert.deepStrictEqual(
      linesOf(today([slower, promotion("failed")])).map(([product, tone]) => [product, tone]),
      [
        ["performance", "warning"],
        ["releases", "failure"],
        ["uptime", "steady"],
        ["errors", "steady"],
      ],
    )
  })

  it("says what has no news too, and that a project went silent, never that it is steady", () => {
    assert.deepStrictEqual(linesOf(answered, landing), [
      ["performance", "warning", `Nothing reported in the last day, last ${ago(now - 3 * 24 * hour, now)}`],
      ["uptime", "steady", "No open incidents"],
      ["errors", "steady", "Nothing new"],
    ])
  })

  it("says the load and the people a pulse counts, and a fall in people of a tenth or more", () => {
    const load = [{ start: at(now - hour), count: 1200, errors: 3 }]
    const analytics = (latest: number, weekBefore?: number) =>
      productLinesOf(pulsed({ project, load: [], people: peopleNow(latest, weekBefore) }), project)
        .filter((line) => line.product === "analytics")
        .map((line) => [line.tone, line.words])
    // In whole percent from the counts, half away from zero, as the phone says it: 181 against 200
    // is down 10%, though 181 / 200 − 1 is a hair over −0.095.
    assert.deepStrictEqual(analytics(46, 50), [["steady", `Steady · 46 daily people, ${change(-0.08)} vs last week`]])
    assert.deepStrictEqual(analytics(45, 50), [["warning", `Down · 45 daily people, ${change(-0.1)} vs last week`]])
    assert.deepStrictEqual(analytics(181, 200), [["warning", `Down · 181 daily people, ${change(-0.1)} vs last week`]])
    assert.deepStrictEqual(analytics(182, 200), [
      ["steady", `Steady · 182 daily people, ${change(-0.09)} vs last week`],
    ])
    // A rise is said, and asks nothing of the founder.
    assert.deepStrictEqual(analytics(112, 100), [["steady", `Up · 112 daily people, ${change(0.12)} vs last week`]])
    assert.deepStrictEqual(analytics(1), [["steady", "1 daily person"]])
    assert.deepStrictEqual(
      linesOf(pulsed({ project, load })).find(([product]) => product === "performance"),
      ["performance", "steady", `Steady · ${compact(1200)} operations in 24 h, ${share(3, 1200)} failed`],
    )
    // Without people or load, Analytics and Performance have nothing to say.
    assert.deepStrictEqual(
      linesOf(pulsed({ project, load: [] })).map(([product]) => product),
      ["uptime", "errors"],
    )
  })

  it("says what runs in production for Releases, never what runs in staging", () => {
    const releasesOf = (environments: ReadonlyArray<{ environment: EnvironmentKey; release: string }>) =>
      productLinesOf(today([]), project, {
        delivery: {
          components: [
            {
              component: api,
              environments: environments.map(({ environment, release }) => ({
                environment,
                current: {
                  summary: {
                    component: api,
                    environment,
                    release: ReleaseVersion.make(release),
                    verdict: "tooEarly" as const,
                    slower: 0,
                    failingMore: 0,
                    newErrors: 0,
                  },
                  since: at(now - hour),
                },
              })),
            },
          ],
        },
        production: [production],
      }).find((line) => line.product === "releases")?.words
    assert.strictEqual(releasesOf([{ environment: staging, release: "1.0.0+1" }]), "Nothing in production yet")
    assert.strictEqual(
      releasesOf([
        { environment: production, release: "0.9.0+1" },
        { environment: staging, release: "1.0.0+1" },
      ]),
      "notes-api 0.9.0+1 in production",
    )
  })

  it("lists projects with news from Today's items first, then news from the pulse alone, then the rest", () => {
    const pulses = [
      { project, load: [], people: peopleNow(46, 50) },
      { project: landing, load: [], people: peopleNow(20, 40) },
    ]
    const listed = (items: TodayList["items"]) =>
      projectsNowOf({ ...today(items), pulses }, [
        { key: project, name: "Notes" },
        { key: landing, name: "Landing" },
      ]).map((lines) => lines.project.key)
    // Landing's people halved: it comes first, though Notes is first in the workspace.
    assert.deepStrictEqual(listed([]), [landing, project])
    // An item of Notes's comes before a fall in Landing's people.
    const slower = answered.items[3]
    assert.isDefined(slower)
    assert.deepStrictEqual(listed([slower]), [project, landing])
  })

  it("has no line for a project that didn't answer: unknown on its page, never steady", () => {
    const silent = today([], [project])
    assert.deepStrictEqual(productLinesOf(silent, project), [])
    assert.deepStrictEqual(
      projectLinesOf(silent, project, undefined).map((line) => [line.product, line.tone]),
      [
        ["uptime", "unknown"],
        ["errors", "unknown"],
        ["performance", "unknown"],
        ["releases", "unknown"],
        ["analytics", "unknown"],
        ["logs", "quiet"],
      ],
    )
  })
})

describe("dayLoadOf", () => {
  const thisHour = Math.floor(now / hour) * hour
  const pulse = {
    project,
    load: [
      { start: at(thisHour - 23 * hour), count: 30, errors: 0 },
      { start: at(thisHour - hour), count: 50, errors: 2 },
      { start: at(thisHour), count: 20, errors: 1 },
    ],
  }

  it("draws the hour Today looked in and the 23 before, an hour not listed unknown, never none", () => {
    const load = dayLoadOf(pulse, at(now))
    assert.strictEqual(load.ran.from, thisHour - 23 * hour)
    assert.strictEqual(load.ran.values.length, 24)
    assert.deepStrictEqual(
      [load.ran.values[0], load.ran.values[1], load.ran.values[22], load.ran.values[23]],
      [30, undefined, 50, 20],
    )
    assert.strictEqual(load.failed.values[22], 2)
    assert.deepStrictEqual([load.total, load.failures], [100, 3])
  })
})

// A UTC day `daysAgo` before `now`, with as many people, and monthly people when given.
const usageDay = (daysAgo: number, people: number, monthPeople?: number) => ({
  day: calendarDayOf(at(now - daysAgo * 24 * hour)),
  people,
  installations: people,
  ...(monthPeople === undefined ? {} : { monthPeople }),
  sessions: people,
  foregroundMs: 0,
})

describe("peopleOf", () => {
  it("compares the latest whole UTC day with the same day a week before", () => {
    const people = peopleOf({ latest: usageDay(1, 53, 530), weekBefore: usageDay(8, 50, 500) })
    assert.deepStrictEqual(people.daily, { value: 53, weekBefore: 50 })
    assert.deepStrictEqual(people.monthly, { value: 530, weekBefore: 500 })
    assert.closeTo(changeOf(people.daily) ?? 0, 0.06, 1e-9)
  })

  it("leaves a day not counted unknown, and a week before without people uncompared", () => {
    const people = peopleOf({ latest: usageDay(1, 40) })
    assert.deepStrictEqual(people.daily, { value: 40 })
    assert.deepStrictEqual(people.monthly, {})
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
