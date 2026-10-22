import type { Span } from "@bagatka/otlp"
import { encodeTraces } from "@bagatka/otlp"
import { SketchValue, sketchOf } from "@bagatka/quantile-sketch"
import { ComponentKey, EnvelopeName, EnvironmentKey, Period, ReleaseVersion, TraceId } from "@cluenori/foundation"
import { assert, describe, it } from "@effect/vitest"
import { DateTime, Duration, Effect } from "effect"
import { Base64 } from "effect/encoding"
import { SqlClient } from "effect/sql"
import { TestClock } from "effect/testing"

import type { KeptTrace, OperationCounts, TraceExport } from "../src/index.ts"
import { BatchDigest, readTraces, Signals } from "../src/index.ts"
import { dotnetTraces } from "./fixtures/dotnet-traces.ts"
import { inProject, WebCrypto } from "./in-object.ts"

// The fixture's operations started at 2026-10-19T22:49:43Z; the tests ask a minute later.
const capturedAt = 1792442983314
const now = capturedAt + 60_000
const api = ComponentKey.make("notes-api")
const days = (count: number) => Duration.toMillis(Duration.days(count))
const lastHour = new Period({ from: DateTime.makeUnsafe(now - 3_600_000), to: DateTime.makeUnsafe(now) })

// The start of the minute `ago` milliseconds before the fixture's.
const minuteOf = (ago: number) => DateTime.makeUnsafe(capturedAt - (capturedAt % 60_000) - ago)

const fixture = Effect.fromResult(Base64.decode(dotnetTraces)).pipe(Effect.orDie)

const readFixtureAt = (time: number) =>
  Effect.gen(function* () {
    yield* TestClock.setTime(time)
    const body = yield* fixture
    return yield* readTraces(body)
  }).pipe(Effect.provide(WebCrypto))

const counts = (operation: string, count: number, overrides: Partial<OperationCounts> = {}): OperationCounts => ({
  bucket: DateTime.makeUnsafe(capturedAt - (capturedAt % 60_000)),
  operation: EnvelopeName.make(operation),
  environment: EnvironmentKey.make("prod"),
  count,
  errors: 0,
  totalMs: count * 10,
  durations: sketchOf(Array.from({ length: count }, () => SketchValue.make(10))),
  ...overrides,
})

const batchOf = (
  digit: string,
  entries: ReadonlyArray<OperationCounts>,
  kept: ReadonlyArray<KeptTrace> = [],
): TraceExport => ({
  digest: BatchDigest.make(digit.repeat(64)),
  archive: new Uint8Array(0),
  from: DateTime.makeUnsafe(capturedAt),
  to: DateTime.makeUnsafe(capturedAt),
  spans: entries.length,
  counts: entries,
  kept,
  traces: [],
})

// A trace an export brings to keep: of GET /a, `ago` milliseconds before the fixture's, its trace
// ID made of its duration.
const keptOf = (durationMs: number, ago: number, failed = false): KeptTrace => ({
  trace: TraceId.make(durationMs.toString(16).padStart(32, "c")),
  operation: EnvelopeName.make("GET /a"),
  environment: EnvironmentKey.make("prod"),
  start: DateTime.makeUnsafe(capturedAt - ago),
  durationMs,
  failed,
  status: failed ? 500 : 200,
})
// A span of 1.2 s from when the fixture's started, its IDs made of repeated hex digits.
const span = (
  trace: string,
  id: string,
  name: string,
  kind: Span["kind"],
  parent: string | undefined,
  failed = false,
): Span => ({
  traceId: trace.repeat(32),
  spanId: id.repeat(16),
  parentSpanId: parent === undefined ? undefined : parent.repeat(16),
  name,
  kind,
  startTimeUnixNano: BigInt(capturedAt) * 1_000_000n,
  endTimeUnixNano: BigInt(capturedAt + 1_200) * 1_000_000n,
  attributes: new Map(),
  events: [],
  status: { code: failed ? "error" : "unset", message: "" },
})
const lastDay = new Period({ from: DateTime.makeUnsafe(now - days(1)), to: DateTime.makeUnsafe(now) })

describe("readTraces", () => {
  it.effect("counts a .NET export's server spans by operation, and skips its client spans", () =>
    Effect.gen(function* () {
      const { export: batch, rejected } = yield* readFixtureAt(now)
      const byOperation = Object.fromEntries(
        batch.counts.map((entry) => [entry.operation, [entry.count, entry.errors]]),
      )

      assert.isUndefined(rejected)
      assert.deepStrictEqual(byOperation, {
        "GET /api/notes/{id}": [5, 0],
        "GET /api/render/{format}": [3, 0],
        "POST /api/export": [3, 0],
        "GET /api/fail": [2, 2],
        "GET /api/missing": [2, 0],
        GET: [1, 0],
      })
      assert.isTrue(batch.counts.every((entry) => entry.environment === "production"))
      assert.match(batch.digest, /^[0-9a-f]{64}$/)
    }),
  )

  it.effect("picks the traces to keep, each with its ID, duration, status, and whether it failed", () =>
    Effect.gen(function* () {
      const { export: batch } = yield* readFixtureAt(now)
      const slowest = batch.kept.toSorted((left, right) => right.durationMs - left.durationMs)[0]
      const failed = batch.kept.filter((trace) => trace.failed)

      // No operation ran more than five times that hour, so each may be kept.
      assert.lengthOf(batch.kept, 16)
      assert.strictEqual(slowest?.trace, "782b83a9114f7ebce1fce192e59a0f7f")
      assert.strictEqual(slowest?.operation, "POST /api/export")
      assert.closeTo(slowest?.durationMs ?? 0, 56.817, 0.001)
      assert.strictEqual(slowest?.status, 200)
      assert.deepStrictEqual(
        failed.map((trace) => [trace.operation, trace.status]),
        [
          [EnvelopeName.make("GET /api/fail"), 500],
          [EnvelopeName.make("GET /api/fail"), 500],
        ],
      )
    }),
  )

  it.effect("counts a job, an internal span that starts its trace, and not the spans under it", () =>
    Effect.gen(function* () {
      // A cleanup job run twice, once failing, each with a step under it; a database call no job
      // made; and an internal span whose parent is in another service.
      const body = encodeTraces([
        {
          resource: new Map([["service.name", "notes-api"]]),
          scopeSpans: [
            {
              scope: { name: "Notes.Cleanup", version: "" },
              spans: [
                span("a", "1", "cleanup.run", "internal", undefined),
                span("a", "2", "cleanup.batch", "internal", "1"),
                span("b", "3", "cleanup.run", "unspecified", undefined, true),
                span("c", "4", "SELECT jobs", "client", undefined),
                span("d", "5", "render.page", "internal", "9"),
              ],
            },
          ],
        },
      ])
      const { export: batch } = yield* TestClock.setTime(now).pipe(
        Effect.andThen(readTraces(body)),
        Effect.provide(WebCrypto),
      )

      assert.deepStrictEqual(
        batch.counts.map((entry) => [entry.operation, entry.count, entry.errors]),
        [[EnvelopeName.make("cleanup.run"), 2, 1]],
      )
      assert.deepStrictEqual(
        batch.kept.map((trace) => [trace.trace, trace.failed, trace.status]),
        [
          [TraceId.make("a".repeat(32)), false, undefined],
          [TraceId.make("b".repeat(32)), true, undefined],
        ],
      )
    }),
  )

  it.effect("refuses spans older than the 14 days operations are counted, saying why", () =>
    Effect.gen(function* () {
      const { export: batch, rejected } = yield* readFixtureAt(now + Duration.toMillis(Duration.days(15)))

      assert.isEmpty(batch.counts)
      assert.deepStrictEqual(rejected, {
        count: 16,
        problem: "A span is older than the 14 days operations are counted",
      })
    }),
  )
})

describe("Signals", () => {
  it.effect("answers the operation table from a recorded export, with percentiles", () =>
    Effect.gen(function* () {
      const { export: batch } = yield* readFixtureAt(now)
      const table = yield* inProject(
        "operation-table",
        now,
        Effect.gen(function* () {
          const signals = yield* Signals
          yield* signals.recordTraces(api, batch)
          return yield* signals.operations({ period: lastHour })
        }),
      )
      const notes = table.rows.find((row) => row.operation === "GET /api/notes/{id}")

      assert.strictEqual(table.count, 16)
      assert.strictEqual(table.errors, 2)
      assert.strictEqual(table.rows[0]?.operation, "GET /api/notes/{id}")
      assert.strictEqual(notes?.component, "notes-api")
      assert.strictEqual(notes?.environment, "production")
      assert.deepStrictEqual([notes?.count, notes?.errors], [5, 0])
      // Durations 0.067, 0.082, 0.090, 0.801 and 32.111 ms: p50 is 0.090 and p99 the slowest, within 2%.
      assert.closeTo(notes?.p50Ms ?? 0, 0.09, 0.09 * 0.02)
      assert.closeTo(notes?.p99Ms ?? 0, 32.111, 32.111 * 0.02)
      assert.closeTo(notes?.averageMs ?? 0, 33.151 / 5, 0.001)
    }),
  )

  it.effect("counts an exporter's retry once", () =>
    inProject(
      "retry",
      now,
      Effect.gen(function* () {
        const signals = yield* Signals
        const batch = batchOf("a", [counts("GET /api/notes/{id}", 3)])
        const first = yield* signals.recordTraces(api, batch)
        const retry = yield* signals.recordTraces(api, batch)
        const table = yield* signals.operations({ period: lastHour })

        assert.deepStrictEqual([first, retry], ["recorded", "duplicate"])
        assert.strictEqual(table.count, 3)
      }),
    ),
  )

  it.effect("adds batches of the same operation and bucket together", () =>
    inProject(
      "adds-up",
      now,
      Effect.gen(function* () {
        const signals = yield* Signals
        yield* signals.recordTraces(api, batchOf("a", [counts("GET /api/notes/{id}", 3)]))
        yield* signals.recordTraces(api, batchOf("b", [counts("GET /api/notes/{id}", 2, { errors: 1 })]))
        const table = yield* signals.operations({ period: lastHour })

        assert.deepInclude(table.rows[0], { count: 5, errors: 1, averageMs: 10 })
        assert.strictEqual(table.rows.length, 1)
      }),
    ),
  )

  it.effect("counts a component's operations past 500 as (other operations)", () =>
    inProject(
      "too-many-operations",
      now,
      Effect.gen(function* () {
        const signals = yield* Signals
        const many = Array.from({ length: 503 }, (_, index) => counts(`GET /api/items/${index}`, 1))
        yield* signals.recordTraces(api, batchOf("c", many))
        const table = yield* signals.operations({ period: lastHour })
        const other = table.rows.find((row) => row.operation === "(other operations)")

        assert.strictEqual(table.rows.length, 501)
        assert.strictEqual(other?.count, 3)
        assert.strictEqual(table.count, 503)
      }),
    ),
  )

  it.effect("filters by environment and component", () =>
    inProject(
      "filters",
      now,
      Effect.gen(function* () {
        const signals = yield* Signals
        yield* signals.recordTraces(
          api,
          batchOf("d", [counts("GET /a", 1), counts("GET /a", 2, { environment: EnvironmentKey.make("staging") })]),
        )
        yield* signals.recordTraces(ComponentKey.make("notes-jobs"), batchOf("e", [counts("GET /a", 4)]))
        const staging = yield* signals.operations({ period: lastHour, environment: EnvironmentKey.make("staging") })
        const jobs = yield* signals.operations({ period: lastHour, component: ComponentKey.make("notes-jobs") })

        assert.deepStrictEqual([staging.count, jobs.count], [2, 4])
      }),
    ),
  )

  it.effect("says which part of a period it covers: no further back than its counts are kept, no later than now", () =>
    inProject(
      "covered",
      now,
      Effect.gen(function* () {
        const signals = yield* Signals
        const periodOf = (back: number) =>
          new Period({ from: DateTime.makeUnsafe(now - days(back)), to: DateTime.makeUnsafe(now + 3_600_000) })
        const month = yield* signals.operations({ period: periodOf(30) })
        const twoYears = yield* signals.operations({ period: periodOf(730) })
        const fromOf = (table: typeof month) => DateTime.toEpochMillis(table.covered?.from ?? DateTime.makeUnsafe(0))
        const toOf = (table: typeof month) => DateTime.toEpochMillis(table.covered?.to ?? DateTime.makeUnsafe(0))

        // Hourly counts answer both, so the month is covered whole and two years back to 15 months.
        assert.strictEqual(fromOf(month), now - days(30) - ((now - days(30)) % 3_600_000))
        assert.isAtLeast(fromOf(twoYears), now - days(455))
        assert.isAtMost(fromOf(twoYears), now - days(454))
        assert.isAtMost(toOf(month), now + 3_600_000)
        assert.isUndefined(month.dataUntil)
        assert.isEmpty(month.rows)
      }),
    ),
  )

  it.effect("keeps hourly counts for 15 months and answers longer questions from them", () =>
    inProject(
      "hourly-history",
      now,
      Effect.gen(function* () {
        const signals = yield* Signals
        const twentyDaysAgo = now - Duration.toMillis(Duration.days(20))
        const old = counts("GET /api/notes/{id}", 4, {
          bucket: DateTime.makeUnsafe(twentyDaysAgo - (twentyDaysAgo % 60_000)),
        })
        yield* signals.recordTraces(api, batchOf("1", [old, counts("GET /api/notes/{id}", 1)]))
        const month = new Period({
          from: DateTime.makeUnsafe(now - Duration.toMillis(Duration.days(30))),
          to: DateTime.makeUnsafe(now),
        })
        const lastMonth = yield* signals.operations({ period: month })
        const recent = yield* signals.operations({ period: lastHour })

        // The minute counts of 20 days ago are gone; the hourly ones remain.
        assert.strictEqual(lastMonth.count, 5)
        assert.strictEqual(recent.count, 1)
        assert.closeTo(lastMonth.rows[0]?.p50Ms ?? 0, 10, 10 * 0.02)
      }),
    ),
  )

  it.effect("counts a question of two days or less by the minute", () =>
    inProject(
      "by-minute",
      now,
      Effect.gen(function* () {
        const signals = yield* Signals
        const minute = capturedAt - (capturedAt % 60_000)
        yield* signals.recordTraces(
          api,
          batchOf("2", [
            counts("GET /a", 1, { bucket: DateTime.makeUnsafe(minute - 120_000) }),
            counts("GET /a", 2, { bucket: DateTime.makeUnsafe(minute - 60_000) }),
            counts("GET /a", 3, { bucket: DateTime.makeUnsafe(minute) }),
          ]),
        )
        const series = yield* signals.loadOverTime({ period: lastHour }, "1m")
        const table = yield* signals.operations({ period: lastHour })

        assert.strictEqual(series.step, "1m")
        assert.deepStrictEqual(
          series.points.map((point) => point.count),
          [1, 2, 3],
        )
        assert.strictEqual(
          DateTime.toEpochMillis(table.dataUntil ?? DateTime.makeUnsafe(0)),
          Math.min(minute + 60_000, now),
        )
      }),
    ),
  )

  it.effect("widens a step finer than the hourly counts of a long question to an hour", () =>
    inProject(
      "wide-step",
      now,
      Effect.gen(function* () {
        const signals = yield* Signals
        yield* signals.recordTraces(api, batchOf("3", [counts("GET /a", 2)]))
        const week = new Period({
          from: DateTime.makeUnsafe(now - Duration.toMillis(Duration.days(7))),
          to: DateTime.makeUnsafe(now),
        })
        const series = yield* signals.loadOverTime({ period: week }, "1m")

        assert.strictEqual(series.step, "1h")
        assert.strictEqual(series.points[0]?.count, 2)
      }),
    ),
  )

  it.effect("shows the load over time, one point per step with any", () =>
    inProject(
      "series",
      now,
      Effect.gen(function* () {
        const signals = yield* Signals
        const earlier = DateTime.makeUnsafe(capturedAt - (capturedAt % 300_000) - 600_000)
        yield* signals.recordTraces(api, batchOf("f", [counts("GET /a", 2), counts("GET /a", 3, { bucket: earlier })]))
        const fiveMinutes = yield* signals.loadOverTime({ period: lastHour }, "5m")
        const hours = yield* signals.loadOverTime({ period: lastHour }, "1h")

        assert.deepStrictEqual(
          fiveMinutes.points.map((point) => point.count),
          [3, 2],
        )
        assert.strictEqual(
          hours.points.reduce((total, point) => total + point.count, 0),
          5,
        )
      }),
    ),
  )

  it.effect("tells the minutes each sparse operation ran in, and leaves the busy ones out", () =>
    inProject(
      "minutes-ran",
      now,
      Effect.gen(function* () {
        const signals = yield* Signals
        // An hourly job, three times; and an endpoint in four minutes, busier than asked for.
        const job = [0, 3_600_000, 7_200_000].map((ago) => counts("cleanup.run", 1, { bucket: minuteOf(ago) }))
        const busy = [0, 60_000, 120_000, 180_000].map((ago) => counts("GET /a", 2, { bucket: minuteOf(ago) }))
        yield* signals.recordTraces(api, batchOf("f", [...job, ...busy]))
        const threeHours = new Period({ from: DateTime.makeUnsafe(now - 3 * 3_600_000), to: DateTime.makeUnsafe(now) })

        const ran = yield* signals.minutesRan({ period: threeHours }, 3)

        assert.deepStrictEqual(
          ran.map((entry) => [entry.operation, entry.environment, entry.minutes.map(DateTime.toEpochMillis)]),
          [
            [
              EnvelopeName.make("cleanup.run"),
              EnvironmentKey.make("prod"),
              [7_200_000, 3_600_000, 0].map((ago) => DateTime.toEpochMillis(minuteOf(ago))),
            ],
          ],
        )
      }),
    ),
  )

  it.effect("shows one operation's load over time, with its percentiles in each step", () =>
    inProject(
      "series-of-operation",
      now,
      Effect.gen(function* () {
        const signals = yield* Signals
        // GET /slow a hundred times, taking 100 to 199 ms; four quick ones elsewhere.
        const slow = counts("GET /slow", 100, {
          totalMs: 14_950,
          durations: sketchOf(Array.from({ length: 100 }, (_, index) => SketchValue.make(100 + index))),
        })
        yield* signals.recordTraces(api, batchOf("e", [counts("GET /a", 4), slow]))
        const operation = EnvelopeName.make("GET /slow")
        const series = yield* signals.loadOverTime({ period: lastHour, operation }, "5m")
        const table = yield* signals.operations({ period: lastHour, operation })
        const [point] = series.points

        assert.strictEqual(series.points.length, 1)
        assert.strictEqual(point?.count, 100)
        // Nearest rank, each within 2%: the 50th of a hundred is 149, the 95th 194, the 99th 198.
        assert.closeTo(point?.p50Ms ?? 0, 149, 149 * 0.02)
        assert.closeTo(point?.p95Ms ?? 0, 194, 194 * 0.02)
        assert.closeTo(point?.p99Ms ?? 0, 198, 198 * 0.02)
        assert.deepStrictEqual(
          table.rows.map((row) => row.operation),
          ["GET /slow"],
        )
        assert.strictEqual(table.count, 100)
      }),
    ),
  )

  it.effect("answers the slowest traces and the failed ones, each opening with its ID", () =>
    Effect.gen(function* () {
      const { export: batch } = yield* readFixtureAt(now)
      const { all, ofOperation } = yield* inProject(
        "kept-traces",
        now,
        Effect.gen(function* () {
          const signals = yield* Signals
          yield* signals.recordTraces(api, batch)
          return {
            all: yield* signals.keptTraces({ period: lastHour }),
            ofOperation: yield* signals.keptTraces({
              period: lastHour,
              operation: EnvelopeName.make("GET /api/notes/{id}"),
            }),
          }
        }),
      )

      assert.deepStrictEqual(
        all.slowest.slice(0, 3).map((trace) => [trace.operation, trace.trace.slice(0, 8)]),
        [
          [EnvelopeName.make("POST /api/export"), "782b83a9"],
          [EnvelopeName.make("POST /api/export"), "4d09b0a9"],
          [EnvelopeName.make("GET /api/notes/{id}"), "3d4a2030"],
        ],
      )
      assert.strictEqual(all.slowest[0]?.component, "notes-api")
      assert.strictEqual(all.slowest[0]?.environment, "production")
      assert.deepStrictEqual(
        all.failed.map((trace) => [trace.operation, trace.status, trace.failed]),
        [
          [EnvelopeName.make("GET /api/fail"), 500, true],
          [EnvelopeName.make("GET /api/fail"), 500, true],
        ],
      )
      assert.isTrue(
        DateTime.toEpochMillis(all.failed[0]?.start ?? DateTime.makeUnsafe(0)) >=
          DateTime.toEpochMillis(all.failed[1]?.start ?? DateTime.makeUnsafe(0)),
      )
      assert.deepStrictEqual(
        ofOperation.slowest.map((trace) => trace.trace.slice(0, 8)),
        ["3d4a2030", "2f510b73", "b509b1d4", "b0c967e9", "bad0eef1"],
      )
      assert.isEmpty(ofOperation.failed)
    }),
  )

  it.effect("keeps of each operation and hour the five slowest, and the five slowest failed, across exports", () =>
    inProject(
      "kept-five",
      now,
      Effect.gen(function* () {
        const signals = yield* Signals
        const minute = 60_000
        yield* signals.recordTraces(
          api,
          batchOf("1", [], [keptOf(10, minute), keptOf(20, minute), keptOf(30, minute), keptOf(40, minute, true)]),
        )
        yield* signals.recordTraces(
          api,
          batchOf(
            "2",
            [],
            [
              keptOf(5, 2 * minute),
              keptOf(50, 2 * minute),
              keptOf(60, 2 * minute),
              keptOf(70, 2 * minute),
              keptOf(80, 3 * minute, true),
              keptOf(15, 4 * minute, true),
              keptOf(25, 5 * minute, true),
              keptOf(35, 6 * minute, true),
              keptOf(45, 7 * minute, true),
            ],
          ),
        )
        // Another hour's traces are kept apart from these.
        yield* signals.recordTraces(api, batchOf("3", [], [keptOf(1, 2 * 3_600_000)]))
        const kept = yield* signals.keptTraces({ period: lastDay })

        assert.deepStrictEqual(
          kept.slowest.map((trace) => trace.durationMs),
          [80, 70, 60, 50, 45, 1],
        )
        // The newest first: the five slowest failed of that hour, 15 not among them.
        assert.deepStrictEqual(
          kept.failed.map((trace) => trace.durationMs),
          [40, 80, 25, 35, 45],
        )
      }),
    ),
  )

  it.effect("says which part of a period its kept traces cover: no further back than 14 days", () =>
    inProject(
      "kept-covered",
      now,
      Effect.gen(function* () {
        const signals = yield* Signals
        const month = new Period({ from: DateTime.makeUnsafe(now - days(30)), to: DateTime.makeUnsafe(now) })
        const kept = yield* signals.keptTraces({ period: month })
        const before = new Period({
          from: DateTime.makeUnsafe(now - days(20)),
          to: DateTime.makeUnsafe(now - days(15)),
        })
        const older = yield* signals.keptTraces({ period: before })

        assert.isAtLeast(DateTime.toEpochMillis(kept.covered?.from ?? DateTime.makeUnsafe(0)), now - days(14))
        assert.isUndefined(older.covered)
        assert.deepStrictEqual([older.slowest, older.failed], [[], []])
      }),
    ),
  )
})

// A service of `version` with one server span of trace `trace`.
const resource = (version: string, trace: string) => ({
  resource: new Map<string, string>([
    ["service.name", "notes-api"],
    ["service.version", version],
  ]),
  scopeSpans: [{ scope: { name: "Notes", version: "" }, spans: [span(trace, "1", "GET /a", "server", undefined)] }],
})

// The end of the minute `ago` milliseconds before the fixture's.
const endOf = (ago: number) => DateTime.toEpochMillis(minuteOf(ago)) + 60_000

describe("Signals by release", () => {
  const older = ReleaseVersion.make("2026.10.20-a1b2c3d")
  const newer = ReleaseVersion.make("2026.10.21-e91f09c")

  it.effect("counts each release a resource reports in service.version apart, and keeps it on traces", () =>
    Effect.gen(function* () {
      // The same operation in the same minute from two releases, as during a rollout, and from a
      // service whose version is no release version.
      const body = encodeTraces([
        resource(older, "a"),
        resource(newer, "b"),
        resource(newer, "c"),
        resource("not a version", "d"),
      ])
      const { export: batch } = yield* TestClock.setTime(now).pipe(
        Effect.andThen(readTraces(body)),
        Effect.provide(WebCrypto),
      )

      assert.deepStrictEqual(
        batch.counts.map((entry) => [entry.release, entry.count]),
        [
          [older, 1],
          [newer, 2],
          [undefined, 1],
        ],
      )
      assert.deepStrictEqual(
        batch.kept.map((trace) => trace.release),
        [older, newer, newer, undefined],
      )
    }),
  )

  it.effect("answers one release's operations, and all releases' together", () =>
    inProject(
      "by-release",
      now,
      Effect.gen(function* () {
        const signals = yield* Signals
        yield* signals.recordTraces(
          api,
          batchOf("a", [
            counts("GET /a", 3, { release: older }),
            counts("GET /a", 2, { release: newer, errors: 1 }),
            counts("GET /a", 4),
          ]),
        )
        const all = yield* signals.operations({ period: lastHour })
        const newest = yield* signals.operations({ period: lastHour, release: newer })
        const hourly = yield* signals.operations({
          period: new Period({ from: DateTime.makeUnsafe(now - days(7)), to: DateTime.makeUnsafe(now) }),
          release: older,
        })

        assert.deepStrictEqual([all.count, all.rows.length], [9, 1])
        assert.deepStrictEqual([newest.count, newest.errors], [2, 1])
        assert.strictEqual(hourly.count, 3)
      }),
    ),
  )

  it.effect("lists each release with its first and last minute, the latest first seen first", () =>
    inProject(
      "releases",
      now,
      Effect.gen(function* () {
        const signals = yield* Signals
        yield* signals.recordTraces(
          api,
          batchOf("a", [
            counts("GET /a", 1, { release: older, bucket: minuteOf(600_000) }),
            counts("GET /a", 1, { release: older, bucket: minuteOf(300_000) }),
          ]),
        )
        // A later export widens a release's span; counts without a release make none.
        yield* signals.recordTraces(
          api,
          batchOf("b", [
            counts("GET /a", 1, { release: newer, bucket: minuteOf(180_000) }),
            counts("GET /b", 1, { release: newer, bucket: minuteOf(0) }),
            counts("GET /b", 1, { release: older, bucket: minuteOf(240_000) }),
            counts("GET /c", 1),
          ]),
        )
        const table = yield* signals.releases({ period: lastHour })
        const before = yield* signals.releases({
          period: new Period({ from: DateTime.makeUnsafe(now - days(2)), to: DateTime.makeUnsafe(now - days(1)) }),
        })

        assert.deepStrictEqual(
          table.rows.map((row) => [
            row.release,
            row.environment,
            DateTime.toEpochMillis(row.firstSeen),
            DateTime.toEpochMillis(row.lastSeen),
          ]),
          [
            [newer, EnvironmentKey.make("prod"), endOf(180_000) - 60_000, endOf(0)],
            [older, EnvironmentKey.make("prod"), endOf(600_000) - 60_000, endOf(240_000)],
          ],
        )
        assert.isEmpty(before.rows)
      }),
    ),
  )

  it.effect("counts a minute two releases ran in once among the minutes an operation ran in", () =>
    inProject(
      "minutes-by-release",
      now,
      Effect.gen(function* () {
        const signals = yield* Signals
        yield* signals.recordTraces(
          api,
          batchOf("a", [counts("cleanup.run", 1, { release: older }), counts("cleanup.run", 1, { release: newer })]),
        )
        const ran = yield* signals.minutesRan({ period: lastHour }, 1)

        assert.deepStrictEqual(
          ran.map((entry) => entry.minutes.map(DateTime.toEpochMillis)),
          [[DateTime.toEpochMillis(minuteOf(0))]],
        )
      }),
    ),
  )

  it.effect("answers one release's kept traces", () =>
    inProject(
      "kept-by-release",
      now,
      Effect.gen(function* () {
        const signals = yield* Signals
        yield* signals.recordTraces(
          api,
          batchOf(
            "a",
            [counts("GET /a", 2)],
            [
              { ...keptOf(30, 0), release: older },
              { ...keptOf(50, 0), release: newer },
            ],
          ),
        )
        const kept = yield* signals.keptTraces({ period: lastHour, release: newer })

        assert.deepStrictEqual(
          kept.slowest.map((trace) => [trace.durationMs, trace.release]),
          [[50, newer]],
        )
      }),
    ),
  )

  it.effect("keeps the counts from before releases were counted, as release unknown", () =>
    Effect.gen(function* () {
      // A database as it was before releases were counted: its counts made, then the change undone.
      yield* inProject(
        "before-releases",
        now,
        Effect.gen(function* () {
          const signals = yield* Signals
          const sql = yield* SqlClient.SqlClient
          yield* signals.recordTraces(api, batchOf("a", [counts("GET /a", 3)]))
          for (const table of ["signals_minute_counts", "signals_hour_counts"]) {
            yield* sql`CREATE TABLE ${sql(`${table}_before`)} AS SELECT bucket, operation, environment, count, errors,
              total_ms, durations FROM ${sql(table)}`
            yield* sql`DROP TABLE ${sql(table)}`
            yield* sql`CREATE TABLE ${sql(table)} (
              bucket INTEGER NOT NULL,
              operation INTEGER NOT NULL,
              environment TEXT NOT NULL,
              count INTEGER NOT NULL,
              errors INTEGER NOT NULL,
              total_ms REAL NOT NULL,
              durations TEXT NOT NULL,
              PRIMARY KEY (bucket, operation, environment)
            ) WITHOUT ROWID`
            yield* sql`INSERT INTO ${sql(table)} SELECT * FROM ${sql(`${table}_before`)}`
            yield* sql`DROP TABLE ${sql(`${table}_before`)}`
          }
          yield* sql`ALTER TABLE signals_kept_traces DROP COLUMN release`
          yield* sql`ALTER TABLE signals_error_groups DROP COLUMN first_release`
          yield* sql`DROP TABLE signals_releases`
          yield* sql`DROP INDEX signals_logs_release`
          yield* sql`ALTER TABLE signals_logs DROP COLUMN release`
          yield* sql`DELETE FROM signals_migrations WHERE migration_id >= 7`
        }).pipe(Effect.orDie),
      )
      // Built again on it, the engine counts by release, and the counts from before still count.
      const counted = yield* inProject(
        "before-releases",
        now,
        Effect.gen(function* () {
          const signals = yield* Signals
          yield* signals.recordTraces(api, batchOf("b", [counts("GET /a", 2, { release: newer })]))
          const all = yield* signals.operations({ period: lastHour })
          const newest = yield* signals.operations({ period: lastHour, release: newer })
          return { all: all.count, newest: newest.count }
        }),
      )

      assert.deepStrictEqual(counted, { all: 5, newest: 2 })
    }),
  )
})
