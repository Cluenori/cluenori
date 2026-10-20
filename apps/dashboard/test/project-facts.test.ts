import { ComponentKey, EnvelopeName, Period, ProjectKey } from "@cluenori/foundation"
import type { EndpointRow, ErrorGroup, RequestSeries } from "@cluenori/signals"
import { ErrorGroupId } from "@cluenori/signals"
import { assert, describe, it } from "@effect/vitest"
import { DateTime } from "effect"

import { axisTime, dayOf } from "@/lib/format"
import {
  attentionOf,
  columnTimesOf,
  failureSpikeOf,
  framesOf,
  logColumnsOf,
  requestColumnsOf,
  slowerOf,
  statusOf,
} from "@/project-facts"

const minute = 60_000
const hour = 60 * minute
const now = Date.UTC(2026, 9, 20, 9, 40)
const at = (epochMillis: number) => DateTime.makeUnsafe(epochMillis)
const project = ProjectKey.make("notes")
const api = ComponentKey.make("notes-api")

describe("slowerOf", () => {
  it("says an endpoint got slower when its p95 is 1.5 times its usual and 100 ms more", () => {
    assert.deepStrictEqual(slowerOf({ lastDayP95Ms: 420, usualP95Ms: 180 }), { p95Ms: 420, usualP95Ms: 180 })
  })

  it("leaves a fast endpoint alone when it doubles by a few milliseconds", () => {
    assert.isUndefined(slowerOf({ lastDayP95Ms: 4, usualP95Ms: 2 }))
  })

  it("leaves an endpoint alone under 1.5 times its usual", () => {
    assert.isUndefined(slowerOf({ lastDayP95Ms: 1_400, usualP95Ms: 1_000 }))
  })

  it("has no verdict for an endpoint new this week", () => {
    assert.isUndefined(slowerOf({ lastDayP95Ms: 900 }))
  })
})

// Ten minutes of requests, 100 a minute, with these failed; `undefined` for a minute nothing reported.
const series = (failed: ReadonlyArray<number | undefined>): RequestSeries => ({
  covered: new Period({ from: at(now), to: at(now + failed.length * minute) }),
  step: "1m",
  points: failed.flatMap((errors, index) =>
    errors === undefined
      ? []
      : [{ start: at(now + index * minute), requests: 100, errors, p50Ms: 20, p80Ms: 40, p95Ms: 90, p99Ms: 200 }],
  ),
})

describe("requestColumnsOf", () => {
  it("gives a step nothing reported an unknown column, never zero", () => {
    assert.deepStrictEqual(requestColumnsOf(series([1, undefined, 0]), (point) => point.errors).values, [
      1,
      undefined,
      0,
    ])
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

describe("failureSpikeOf", () => {
  it("finds the window where the error rate jumped, widened to its neighbors", () => {
    assert.deepStrictEqual(failureSpikeOf(series([0, 1, 0, 0, 20, 30, 0, 0, 1, 0])), {
      from: now + 4 * minute,
      to: now + 6 * minute,
      failed: 50,
      requests: 200,
    })
  })

  it("finds nothing when failures stay level", () => {
    assert.isUndefined(failureSpikeOf(series([1, 1, 1, 1, 1, 1, 1, 1, 1, 1])))
  })

  it("finds nothing when the worst window is under a 2% error rate", () => {
    assert.isUndefined(failureSpikeOf(series([0, 0, 0, 0, 1, 0, 0, 0, 0, 0])))
  })

  it("ends a window in the step under way with the period, not after it", () => {
    const ending = { ...series([0, 0, 0, 0, 0, 0, 0, 0, 0, 40]) }
    const covered = new Period({ from: at(now), to: at(now + 9 * minute + 20_000) })
    assert.strictEqual(failureSpikeOf({ ...ending, covered })?.to, now + 9 * minute + 20_000)
  })

  it("never widens a window across a step nothing reported", () => {
    assert.deepStrictEqual(failureSpikeOf(series([0, 0, 0, 30, undefined, 20, 0, 0, 0, 0])), {
      from: now + 3 * minute,
      to: now + 4 * minute,
      failed: 30,
      requests: 100,
    })
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

describe("statusOf", () => {
  it("calls a group new for its first day and ongoing for 15 minutes after it was last seen", () => {
    assert.deepStrictEqual(statusOf(group({ firstSeen: at(now - 23 * hour), lastSeen: at(now - 14 * minute) }), now), {
      isNew: true,
      ongoing: true,
    })
    assert.deepStrictEqual(statusOf(group({ firstSeen: at(now - 25 * hour), lastSeen: at(now - 16 * minute) }), now), {
      isNew: false,
      ongoing: false,
    })
  })
})

describe("framesOf", () => {
  it("reads a .NET stack, the app's own frames being those with a source location", () => {
    const stack = [
      "Npgsql.NpgsqlException (0x80004005): Failed to connect",
      "   at Npgsql.Internal.NpgsqlConnector.Connect(NpgsqlTimeout timeout)",
      "   at Notes.Api.Exports.ExportStore.SaveAsync(Export export) in /src/Exports/ExportStore.cs:line 48",
    ].join("\n")
    assert.deepStrictEqual(framesOf({ type: "Npgsql.NpgsqlException", message: "Failed to connect", stack }), [
      { method: "Npgsql.Internal.NpgsqlConnector.Connect(NpgsqlTimeout timeout)", ours: false },
      {
        method: "Notes.Api.Exports.ExportStore.SaveAsync(Export export)",
        place: "/src/Exports/ExportStore.cs:line 48",
        ours: true,
      },
    ])
  })

  it("has no frames for an exception sent without a stack", () => {
    assert.isUndefined(framesOf({ type: "TimeoutException", message: "Took too long" }))
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

const endpoint = (name: string, p95Ms: number): EndpointRow => ({
  component: api,
  endpoint: EnvelopeName.make(name),
  requests: 1_000,
  errors: 0,
  averageMs: p95Ms / 2,
  p50Ms: p95Ms / 3,
  p80Ms: p95Ms / 2,
  p95Ms,
  p99Ms: p95Ms * 2,
})

const table = (rows: ReadonlyArray<EndpointRow>) => ({ rows, requests: 1_000, errors: 0 })

describe("attentionOf", () => {
  const items = attentionOf({
    project,
    errors: {
      covered: new Period({ from: at(now - 24 * hour), to: at(now) }),
      groups: [
        group({ id: ErrorGroupId.make("1111111111111111"), firstSeen: at(now - 2 * hour), lastSeen: at(now - hour) }),
        group({ id: ErrorGroupId.make("2222222222222222"), lastSeen: at(now - 2 * minute) }),
      ],
      occurrences: 84,
    },
    requests: series([0, 1, 0, 0, 20, 30, 0, 0, 1, 0]),
    compared: {
      lastDay: table([endpoint("GET /api/feed", 620), endpoint("POST /api/export", 4_200)]),
      usual: table([endpoint("GET /api/feed", 300), endpoint("POST /api/export", 4_000)]),
    },
  })

  it("puts what is failing, now and in a jump, before what is new or slower", () => {
    assert.deepStrictEqual(
      items.map((item) => item.key),
      ["ongoing 2222222222222222", "spike", "new 1111111111111111", `slower notes-api\u0000\u0000GET /api/feed`],
    )
  })

  it("leaves an endpoint that is slow by nature, but as usual, alone", () => {
    assert.isFalse(items.some((item) => item.key.includes("POST /api/export")))
  })

  it("names an error that is new and happening now once", () => {
    const both = attentionOf({
      project,
      errors: {
        covered: new Period({ from: at(now - 24 * hour), to: at(now) }),
        groups: [group({ firstSeen: at(now - 2 * hour), lastSeen: at(now - minute) })],
        occurrences: 42,
      },
      requests: series([0, 0, 0]),
      compared: { lastDay: table([]), usual: table([]) },
    })
    assert.deepStrictEqual(
      both.map((item) => item.title),
      ["NpgsqlException is new, and happening right now"],
    )
  })
})
