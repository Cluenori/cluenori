import type { Span } from "@bagatka/otlp"
import { encodeTraces } from "@bagatka/otlp"
import { SketchValue, sketchOf } from "@bagatka/quantile-sketch"
import { ComponentKey, EnvelopeName, EnvironmentKey, Period, TraceId } from "@cluenori/foundation"
import { assert, describe, it } from "@effect/vitest"
import { DateTime, Duration, Effect } from "effect"
import { Base64 } from "effect/encoding"
import { TestClock } from "effect/testing"

import type { KeptRun, RunCounts, TraceExport } from "../src/index.ts"
import { BatchDigest, readTraces, Signals } from "../src/index.ts"
import { dotnetTraces } from "./fixtures/dotnet-traces.ts"
import { inProject, WebCrypto } from "./in-object.ts"

// The fixture's runs started at 2026-10-19T22:49:43Z; the tests ask a minute later.
const capturedAt = 1792442983314
const now = capturedAt + 60_000
const api = ComponentKey.make("notes-api")
const days = (count: number) => Duration.toMillis(Duration.days(count))
const lastHour = new Period({ from: DateTime.makeUnsafe(now - 3_600_000), to: DateTime.makeUnsafe(now) })

const fixture = Effect.fromResult(Base64.decode(dotnetTraces)).pipe(Effect.orDie)

const readFixtureAt = (time: number) =>
  Effect.gen(function* () {
    yield* TestClock.setTime(time)
    const body = yield* fixture
    return yield* readTraces(body)
  }).pipe(Effect.provide(WebCrypto))

const counts = (operation: string, runs: number, overrides: Partial<RunCounts> = {}): RunCounts => ({
  bucket: DateTime.makeUnsafe(capturedAt - (capturedAt % 60_000)),
  operation: EnvelopeName.make(operation),
  environment: EnvironmentKey.make("prod"),
  runs,
  errors: 0,
  totalMs: runs * 10,
  durations: sketchOf(Array.from({ length: runs }, () => SketchValue.make(10))),
  ...overrides,
})

const batchOf = (digit: string, entries: ReadonlyArray<RunCounts>, kept: ReadonlyArray<KeptRun> = []): TraceExport => ({
  digest: BatchDigest.make(digit.repeat(64)),
  archive: new Uint8Array(0),
  from: DateTime.makeUnsafe(capturedAt),
  to: DateTime.makeUnsafe(capturedAt),
  spans: entries.length,
  counts: entries,
  kept,
  traces: [],
})

// A run an export brings to keep: of GET /a, `ago` milliseconds before the fixture's, its trace
// ID made of its duration.
const keptOf = (durationMs: number, ago: number, failed = false): KeptRun => ({
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
      const byOperation = Object.fromEntries(batch.counts.map((entry) => [entry.operation, [entry.runs, entry.errors]]))

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

  it.effect("picks the runs to keep, each with its trace, duration, status, and whether it failed", () =>
    Effect.gen(function* () {
      const { export: batch } = yield* readFixtureAt(now)
      const slowest = batch.kept.toSorted((left, right) => right.durationMs - left.durationMs)[0]
      const failed = batch.kept.filter((run) => run.failed)

      // No operation had more than five runs that hour, so each may be kept.
      assert.lengthOf(batch.kept, 16)
      assert.strictEqual(slowest?.trace, "782b83a9114f7ebce1fce192e59a0f7f")
      assert.strictEqual(slowest?.operation, "POST /api/export")
      assert.closeTo(slowest?.durationMs ?? 0, 56.817, 0.001)
      assert.strictEqual(slowest?.status, 200)
      assert.deepStrictEqual(
        failed.map((run) => [run.operation, run.status]),
        [
          [EnvelopeName.make("GET /api/fail"), 500],
          [EnvelopeName.make("GET /api/fail"), 500],
        ],
      )
    }),
  )

  it.effect("counts a job, an internal span that starts its trace, and not the spans under it", () =>
    Effect.gen(function* () {
      // A cleanup job's two runs, one failed, each with a step under it; a database call no run
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
        batch.counts.map((entry) => [entry.operation, entry.runs, entry.errors]),
        [[EnvelopeName.make("cleanup.run"), 2, 1]],
      )
      assert.deepStrictEqual(
        batch.kept.map((run) => [run.trace, run.failed, run.status]),
        [
          [TraceId.make("a".repeat(32)), false, undefined],
          [TraceId.make("b".repeat(32)), true, undefined],
        ],
      )
    }),
  )

  it.effect("refuses runs older than the 14 days they are kept, saying why", () =>
    Effect.gen(function* () {
      const { export: batch, rejected } = yield* readFixtureAt(now + Duration.toMillis(Duration.days(15)))

      assert.isEmpty(batch.counts)
      assert.deepStrictEqual(rejected, {
        count: 16,
        problem: "A run is older than the 14 days runs are kept",
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

      assert.strictEqual(table.runs, 16)
      assert.strictEqual(table.errors, 2)
      assert.strictEqual(table.rows[0]?.operation, "GET /api/notes/{id}")
      assert.strictEqual(notes?.component, "notes-api")
      assert.strictEqual(notes?.environment, "production")
      assert.deepStrictEqual([notes?.runs, notes?.errors], [5, 0])
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
        assert.strictEqual(table.runs, 3)
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

        assert.deepInclude(table.rows[0], { runs: 5, errors: 1, averageMs: 10 })
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
        assert.strictEqual(other?.runs, 3)
        assert.strictEqual(table.runs, 503)
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

        assert.deepStrictEqual([staging.runs, jobs.runs], [2, 4])
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
        assert.strictEqual(lastMonth.runs, 5)
        assert.strictEqual(recent.runs, 1)
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
        const series = yield* signals.runsOverTime({ period: lastHour }, "1m")
        const table = yield* signals.operations({ period: lastHour })

        assert.strictEqual(series.step, "1m")
        assert.deepStrictEqual(
          series.points.map((point) => point.runs),
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
        const series = yield* signals.runsOverTime({ period: week }, "1m")

        assert.strictEqual(series.step, "1h")
        assert.strictEqual(series.points[0]?.runs, 2)
      }),
    ),
  )

  it.effect("shows runs over time, one point per step with runs", () =>
    inProject(
      "series",
      now,
      Effect.gen(function* () {
        const signals = yield* Signals
        const earlier = DateTime.makeUnsafe(capturedAt - (capturedAt % 300_000) - 600_000)
        yield* signals.recordTraces(api, batchOf("f", [counts("GET /a", 2), counts("GET /a", 3, { bucket: earlier })]))
        const fiveMinutes = yield* signals.runsOverTime({ period: lastHour }, "5m")
        const hours = yield* signals.runsOverTime({ period: lastHour }, "1h")

        assert.deepStrictEqual(
          fiveMinutes.points.map((point) => point.runs),
          [3, 2],
        )
        assert.strictEqual(
          hours.points.reduce((total, point) => total + point.runs, 0),
          5,
        )
      }),
    ),
  )

  it.effect("shows one operation's runs over time, with their percentiles in each step", () =>
    inProject(
      "series-of-operation",
      now,
      Effect.gen(function* () {
        const signals = yield* Signals
        // A hundred runs of GET /slow, taking 100 to 199 ms; four quick ones elsewhere.
        const slow = counts("GET /slow", 100, {
          totalMs: 14_950,
          durations: sketchOf(Array.from({ length: 100 }, (_, index) => SketchValue.make(100 + index))),
        })
        yield* signals.recordTraces(api, batchOf("e", [counts("GET /a", 4), slow]))
        const operation = EnvelopeName.make("GET /slow")
        const series = yield* signals.runsOverTime({ period: lastHour, operation }, "5m")
        const table = yield* signals.operations({ period: lastHour, operation })
        const [point] = series.points

        assert.strictEqual(series.points.length, 1)
        assert.strictEqual(point?.runs, 100)
        // Nearest rank, each within 2%: the 50th of a hundred is 149, the 95th 194, the 99th 198.
        assert.closeTo(point?.p50Ms ?? 0, 149, 149 * 0.02)
        assert.closeTo(point?.p95Ms ?? 0, 194, 194 * 0.02)
        assert.closeTo(point?.p99Ms ?? 0, 198, 198 * 0.02)
        assert.deepStrictEqual(
          table.rows.map((row) => row.operation),
          ["GET /slow"],
        )
        assert.strictEqual(table.runs, 100)
      }),
    ),
  )

  it.effect("answers the slowest runs and the failed ones, each opening with its trace", () =>
    Effect.gen(function* () {
      const { export: batch } = yield* readFixtureAt(now)
      const { all, ofOperation } = yield* inProject(
        "kept-runs",
        now,
        Effect.gen(function* () {
          const signals = yield* Signals
          yield* signals.recordTraces(api, batch)
          return {
            all: yield* signals.keptRuns({ period: lastHour }),
            ofOperation: yield* signals.keptRuns({
              period: lastHour,
              operation: EnvelopeName.make("GET /api/notes/{id}"),
            }),
          }
        }),
      )

      assert.deepStrictEqual(
        all.slowest.slice(0, 3).map((run) => [run.operation, run.trace.slice(0, 8)]),
        [
          [EnvelopeName.make("POST /api/export"), "782b83a9"],
          [EnvelopeName.make("POST /api/export"), "4d09b0a9"],
          [EnvelopeName.make("GET /api/notes/{id}"), "3d4a2030"],
        ],
      )
      assert.strictEqual(all.slowest[0]?.component, "notes-api")
      assert.strictEqual(all.slowest[0]?.environment, "production")
      assert.deepStrictEqual(
        all.failed.map((run) => [run.operation, run.status, run.failed]),
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
        ofOperation.slowest.map((run) => run.trace.slice(0, 8)),
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
        // Another hour's runs are kept apart from these.
        yield* signals.recordTraces(api, batchOf("3", [], [keptOf(1, 2 * 3_600_000)]))
        const kept = yield* signals.keptRuns({ period: lastDay })

        assert.deepStrictEqual(
          kept.slowest.map((run) => run.durationMs),
          [80, 70, 60, 50, 45, 1],
        )
        // The newest first: the five slowest failed of that hour, 15 not among them.
        assert.deepStrictEqual(
          kept.failed.map((run) => run.durationMs),
          [40, 80, 25, 35, 45],
        )
      }),
    ),
  )

  it.effect("says which part of a period its kept runs cover: no further back than 14 days", () =>
    inProject(
      "kept-covered",
      now,
      Effect.gen(function* () {
        const signals = yield* Signals
        const month = new Period({ from: DateTime.makeUnsafe(now - days(30)), to: DateTime.makeUnsafe(now) })
        const kept = yield* signals.keptRuns({ period: month })
        const before = new Period({
          from: DateTime.makeUnsafe(now - days(20)),
          to: DateTime.makeUnsafe(now - days(15)),
        })
        const older = yield* signals.keptRuns({ period: before })

        assert.isAtLeast(DateTime.toEpochMillis(kept.covered?.from ?? DateTime.makeUnsafe(0)), now - days(14))
        assert.isUndefined(older.covered)
        assert.deepStrictEqual([older.slowest, older.failed], [[], []])
      }),
    ),
  )
})
