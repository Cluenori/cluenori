import { ComponentKey, EnvelopeName, EnvironmentKey, Period, ProjectKey, TraceId } from "@cluenori/foundation"
import { Incident, IncidentId } from "@cluenori/incidents"
import type { OperationRow, ErrorGroup, LoadSeries } from "@cluenori/signals"
import { ErrorGroupId, SpanId } from "@cluenori/signals"
import { assert, describe, it } from "@effect/vitest"
import { DateTime } from "effect"

import { axisTime, dayOf } from "@/lib/format"
import {
  attentionOf,
  columnTimesOf,
  environmentsOf,
  exceptionsOf,
  isShownIn,
  logColumnsOf,
  loadColumnsOf,
  operationSpanOf,
} from "@/project-facts"

const minute = 60_000
const hour = 60 * minute
const now = Date.UTC(2026, 9, 20, 9, 40)
const at = (epochMillis: number) => DateTime.makeUnsafe(epochMillis)
const project = ProjectKey.make("notes")
const api = ComponentKey.make("notes-api")
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

const operation = (name: string, p95Ms: number): OperationRow => ({
  component: api,
  operation: EnvelopeName.make(name),
  count: 1_000,
  errors: 0,
  averageMs: p95Ms / 2,
  p50Ms: p95Ms / 3,
  p80Ms: p95Ms / 2,
  p95Ms,
  p99Ms: p95Ms * 2,
})

const table = (rows: ReadonlyArray<OperationRow>) => ({ rows, count: 1_000, errors: 0 })

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

describe("attentionOf", () => {
  const items = attentionOf({
    project,
    environments: everyEnvironment,
    errors: {
      covered: new Period({ from: at(now - 24 * hour), to: at(now) }),
      groups: [
        group({ id: ErrorGroupId.make("1111111111111111"), firstSeen: at(now - 2 * hour), lastSeen: at(now - hour) }),
        group({ id: ErrorGroupId.make("2222222222222222"), lastSeen: at(now - 2 * minute) }),
      ],
      occurrences: 84,
    },
    incidents: {
      open: [
        new Incident({
          id: IncidentId.make("0199f7a2-6d2f-7e4b-8c3a-5f9b2d7e1a64"),
          component: api,
          subject: "POST /api/export",
          title: "POST /api/export: 20% failed, usually 0.1%",
          evidence: {
            _tag: "failing",
            operation: EnvelopeName.make("POST /api/export"),
            failed: 10,
            count: 50,
            usualRate: 0.001,
          },
          openedAt: at(now - 12 * minute),
        }),
      ],
      resolved: [],
      checkedAt: at(now),
    },
    compared: {
      lastDay: table([operation("GET /api/feed", 620), operation("POST /api/export", 4_200)]),
      usual: table([operation("GET /api/feed", 300), operation("POST /api/export", 4_000)]),
    },
  })

  it("puts open incidents and what is failing now before what is new or slower", () => {
    assert.deepStrictEqual(
      items.map((item) => item.key),
      [
        "incident 0199f7a2-6d2f-7e4b-8c3a-5f9b2d7e1a64",
        "ongoing 2222222222222222",
        "new 1111111111111111",
        `slower notes-api\u0000\u0000GET /api/feed`,
      ],
    )
    assert.deepStrictEqual(items[0]?.action?.to, {
      page: "operation",
      project,
      component: api,
      operation: EnvelopeName.make("POST /api/export"),
    })
  })

  it("leaves an operation that is slow by nature, but as usual, alone", () => {
    assert.isFalse(items.some((item) => item.key.includes("POST /api/export")))
  })

  it("keeps the incidents of the environment shown, and those of none in production", () => {
    const open = [
      incident("0199f7a2-6d2f-7e4b-8c3a-5f9b2d7e1a61", production),
      incident("0199f7a2-6d2f-7e4b-8c3a-5f9b2d7e1a62", staging),
      incident("0199f7a2-6d2f-7e4b-8c3a-5f9b2d7e1a63", undefined),
    ]
    const titlesIn = (shown: EnvironmentKey) =>
      attentionOf({
        project,
        environments: { shown, offered: [production, staging], production: [production] },
        errors: { groups: [], occurrences: 0 },
        incidents: { open, resolved: [] },
        compared: { lastDay: table([]), usual: table([]) },
      }).map((item) => item.title)
    assert.deepStrictEqual(titlesIn(production), ["Failing in production", "Failing in no environment"])
    assert.deepStrictEqual(titlesIn(staging), ["Failing in staging"])
  })

  it("names an error that is new and happening now once", () => {
    const both = attentionOf({
      project,
      environments: everyEnvironment,
      errors: {
        covered: new Period({ from: at(now - 24 * hour), to: at(now) }),
        groups: [group({ firstSeen: at(now - 2 * hour), lastSeen: at(now - minute) })],
        occurrences: 42,
      },
      incidents: { open: [], resolved: [] },
      compared: { lastDay: table([]), usual: table([]) },
    })
    assert.deepStrictEqual(
      both.map((item) => item.title),
      ["NpgsqlException is new, and happening right now"],
    )
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
