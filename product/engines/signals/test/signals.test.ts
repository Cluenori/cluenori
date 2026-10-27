import type { ResourceSpans, Span } from "@bagatka/otlp-protobuf"
import { decodeTraces, encodeTraces, SpanId, TraceId as OtlpTraceId } from "@bagatka/otlp-protobuf"
import { sketchOf } from "@bagatka/quantile-sketch"
import {
  ComponentKey,
  EnvelopeName,
  EnvironmentKey,
  FeatureKey,
  Period,
  ReleaseVersion,
  TraceId,
} from "@cluenori/foundation"
import { assert, describe, it } from "@effect/vitest"
import { DateTime, Duration, Effect, Result, Schema } from "effect"
import { Base64 } from "effect/encoding"
import { SqlClient } from "effect/sql"
import { TestClock } from "effect/testing"

import type { KeptTrace, OperationCounts, TraceExport } from "../src/index.ts"
import { BatchDigest, OriginTable, readMetrics, readTraces, Signals } from "../src/index.ts"
import { dotnetTraces } from "./fixtures/dotnet-traces.ts"
import { dropAppTables, dropFeatureSignals, dropLogMessages, inProject, WebCrypto } from "./in-object.ts"

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
  durations: sketchOf(Array.from({ length: count }, () => 10)).sketch,
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
  traceId: OtlpTraceId.make(trace.repeat(32)),
  spanId: SpanId.make(id.repeat(16)),
  traceState: "",
  parentSpanId: parent === undefined ? undefined : SpanId.make(parent.repeat(16)),
  flags: 0,
  name,
  kind,
  startTimeUnixNano: BigInt(capturedAt) * 1_000_000n,
  endTimeUnixNano: BigInt(capturedAt + 1_200) * 1_000_000n,
  attributes: new Map(),
  droppedAttributesCount: 0,
  events: [],
  droppedEventsCount: 0,
  links: [],
  droppedLinksCount: 0,
  status: { code: failed ? "error" : "unset", message: "" },
})
const lastDay = new Period({ from: DateTime.makeUnsafe(now - days(1)), to: DateTime.makeUnsafe(now) })

// How many resources it read, or why it refused the body.
const outcomeOf = (bytes: ReadonlyArray<number> | Uint8Array) =>
  readMetrics(Uint8Array.from(bytes)).pipe(
    Effect.provide(WebCrypto),
    Effect.result,
    Effect.map((read) => (Result.isSuccess(read) ? read.success.resources : read.failure.reason)),
  )

describe("readMetrics", () => {
  it.effect("counts an export's resources, and refuses a body whose framing breaks, saying where", () =>
    Effect.gen(function* () {
      // Two resources, field 1, around a field of each other wire type: a varint, 64 and 32 bits.
      const two = [0x0a, 0x00, 0x10, 0x96, 0x01, 0x19, 1, 2, 3, 4, 5, 6, 7, 8, 0x25, 1, 2, 3, 4, 0x0a, 0x01, 0x00]
      const outcomes = yield* Effect.forEach(
        [
          two,
          [0x0a, 0x05, 0x00],
          [0x0b],
          [0x00],
          [0x08, 0x80],
          [0x08, ...Array.from({ length: 10 }, () => 0x80), 0x01],
          [0x0a, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x7f],
        ],
        outcomeOf,
      )

      assert.deepStrictEqual(outcomes, [
        2,
        "The field at byte 0 runs past the body's 3 bytes",
        "The field at byte 0 has wire type 3, which OTLP's messages don't use",
        "The field at byte 0 has number 0, which protobuf has none of",
        "The number at byte 1 isn't a varint of at most 10 bytes within the body",
        "The number at byte 1 isn't a varint of at most 10 bytes within the body",
        "The field at byte 0 runs past the body's 10 bytes",
      ])
    }),
  )

  it.effect("reads the worst case, 4 MiB of the smallest fields, in one pass", () =>
    Effect.gen(function* () {
      const fields = new Uint8Array(4 * 1024 * 1024)
      for (let at = 0; at < fields.length; at += 2) {
        fields[at] = 0x0a
      }

      assert.strictEqual(yield* outcomeOf(fields), 2 * 1024 * 1024)
    }),
  )
})

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
      const body = yield* encodeTraces([
        {
          resource: { attributes: new Map([["service.name", "notes-api"]]), droppedAttributesCount: 0 },
          schemaUrl: "",
          scopeSpans: [
            {
              scope: { name: "Notes.Cleanup", version: "", attributes: new Map(), droppedAttributesCount: 0 },
              schemaUrl: "",
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
  it.effect("removes emails and credentials from the archive's names, versions, schema URLs and trace states", () =>
    Effect.gen(function* () {
      const scope = {
        name: "Notes Bearer abcDEF1234567890",
        version: "ada@example.com",
        attributes: new Map(),
        droppedAttributesCount: 0,
      }
      const linked = span("a", "1", "GET /a", "server", undefined)
      const body = yield* encodeTraces([
        {
          resource: { attributes: new Map(), droppedAttributesCount: 0 },
          schemaUrl: "https://schemas.example/v1?token=s3cr3tvalue",
          scopeSpans: [
            {
              scope,
              schemaUrl: "https://schemas.example/v1?token=s3cr3tvalue",
              spans: [
                {
                  ...linked,
                  traceState: "vendor=ada@example.com",
                  events: [
                    {
                      timeUnixNano: linked.startTimeUnixNano,
                      name: "retried for ada@example.com",
                      attributes: new Map(),
                      droppedAttributesCount: 0,
                    },
                  ],
                  links: [
                    {
                      traceId: linked.traceId,
                      spanId: linked.spanId,
                      traceState: "vendor=ada@example.com",
                      attributes: new Map(),
                      droppedAttributesCount: 0,
                      flags: 0,
                    },
                  ],
                },
              ],
            },
          ],
        },
      ])
      const { export: batch } = yield* TestClock.setTime(now).pipe(
        Effect.andThen(readTraces(body)),
        Effect.provide(WebCrypto),
      )
      const [archived] = yield* decodeTraces(batch.archive)
      const archivedSpan = archived?.scopeSpans[0]?.spans[0]

      assert.strictEqual(archived?.schemaUrl, "https://schemas.example/v1?token=[secret]")
      assert.strictEqual(archived?.scopeSpans[0]?.schemaUrl, "https://schemas.example/v1?token=[secret]")
      assert.strictEqual(archivedSpan?.traceState, "vendor=[email]")
      assert.strictEqual(archivedSpan?.links[0]?.traceState, "vendor=[email]")
      assert.strictEqual(archived?.scopeSpans[0]?.scope.name, "Notes Bearer [token]")
      assert.strictEqual(archived?.scopeSpans[0]?.scope.version, "[email]")
      assert.strictEqual(archivedSpan?.events[0]?.name, "retried for [email]")
    }),
  )

  it.effect("refuses an export whose scrubbed archive it couldn't read back, saying why", () =>
    Effect.gen(function* () {
      // A long credential pays for many empty scopes; once removed, the archive is too short for
      // them, by the one object for each 16 bytes the reader allows.
      const empty = { name: "", version: "", attributes: new Map(), droppedAttributesCount: 0 }
      const body = yield* encodeTraces([
        {
          resource: {
            attributes: new Map([["authorization", `Bearer ${"A".repeat(4000)}`]]),
            droppedAttributesCount: 0,
          },
          schemaUrl: "",
          scopeSpans: [
            { scope: empty, schemaUrl: "", spans: [span("a", "1", "GET /a", "server", undefined)] },
            ...Array.from({ length: 100 }, () => ({ scope: empty, schemaUrl: "", spans: [] })),
          ],
        },
      ])
      const refused = yield* TestClock.setTime(now).pipe(
        Effect.andThen(readTraces(body)),
        Effect.provide(WebCrypto),
        Effect.flip,
      )

      assert.strictEqual(refused._tag, "OtlpInvalid")
      assert.include(refused.message, "Without its credentials and personal data")
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

  it.effect("reads the hourly counts when a question asks for hours, whatever its length", () =>
    inProject(
      "by-the-hour",
      now,
      Effect.gen(function* () {
        const signals = yield* Signals
        yield* signals.recordTraces(api, batchOf("a", [counts("GET /api/notes/{id}", 3)]))
        // The minute after the one counted: by the minute, nothing ran in it; by the hour, its hour did.
        const afterIt = new Period({ from: minuteOf(-60_000), to: DateTime.makeUnsafe(now) })
        const byMinute = yield* signals.operations({ period: afterIt })
        const byHour = yield* signals.operations({ period: afterIt, buckets: "hours" })
        const load = yield* signals.loadOverTime({ period: afterIt, buckets: "hours" }, "1m")

        assert.deepStrictEqual([byMinute.count, byHour.count], [0, 3])
        assert.deepStrictEqual([load.step, load.points.map((point) => point.count)], ["1h", [3]])
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

  it.effect("says when an operation last ran, whatever the period and its environment", () =>
    inProject(
      "last-seen",
      now,
      Effect.gen(function* () {
        const signals = yield* Signals
        const minute = capturedAt - (capturedAt % 60_000)
        const threeDaysAgo = minute - days(3)
        yield* signals.recordTraces(
          api,
          batchOf("7", [
            counts("GET /old", 1, { bucket: DateTime.makeUnsafe(threeDaysAgo) }),
            counts("GET /old", 1, {
              bucket: DateTime.makeUnsafe(threeDaysAgo - 60_000),
              environment: EnvironmentKey.make("staging"),
            }),
            counts("GET /new", 2, { bucket: DateTime.makeUnsafe(minute - 120_000) }),
          ]),
        )
        // An older batch, sent late, doesn't move it back.
        yield* signals.recordTraces(
          api,
          batchOf("8", [counts("GET /new", 1, { bucket: DateTime.makeUnsafe(minute - 600_000) })]),
        )
        const old = yield* signals.operations({ period: lastHour, operation: EnvelopeName.make("GET /old") })
        const staging = yield* signals.operations({
          period: lastHour,
          operation: EnvelopeName.make("GET /new"),
          environment: EnvironmentKey.make("staging"),
        })
        const every = yield* signals.operations({ period: lastHour })
        const never = yield* signals.operations({ period: lastHour, operation: EnvelopeName.make("GET /never") })
        const lastSeenOf = (table: typeof old) =>
          table.lastSeen === undefined ? undefined : DateTime.toEpochMillis(table.lastSeen)

        // The end of its last minute, though the period holds none of it.
        assert.isEmpty(old.rows)
        assert.strictEqual(lastSeenOf(old), threeDaysAgo + 60_000)
        // In any environment: staging never ran GET /new.
        assert.isEmpty(staging.rows)
        assert.strictEqual(lastSeenOf(staging), minute - 60_000)
        assert.strictEqual(lastSeenOf(every), minute - 60_000)
        assert.isUndefined(never.lastSeen)
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
          durations: sketchOf(Array.from({ length: 100 }, (_, index) => 100 + index)).sketch,
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
const resource = (version: string, trace: string): ResourceSpans => ({
  resource: {
    attributes: new Map([
      ["service.name", "notes-api"],
      ["service.version", version],
    ]),
    droppedAttributesCount: 0,
  },
  schemaUrl: "",
  scopeSpans: [
    {
      scope: { name: "Notes", version: "", attributes: new Map(), droppedAttributesCount: 0 },
      schemaUrl: "",
      spans: [span(trace, "1", "GET /a", "server", undefined)],
    },
  ],
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
      const body = yield* encodeTraces([
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

  it.effect("reads the sketches stored before they named their accuracy", () =>
    Effect.gen(function* () {
      // A database as it was before: its sketches without `relativeAccuracy`, the change undone.
      yield* inProject(
        "before-accuracy",
        now,
        Effect.gen(function* () {
          const signals = yield* Signals
          const sql = yield* SqlClient.SqlClient
          yield* signals.recordTraces(api, batchOf("a", [counts("GET /a", 3)]))
          for (const table of ["signals_minute_counts", "signals_hour_counts"]) {
            yield* sql`UPDATE ${sql(table)} SET durations = json_remove(durations, '$.relativeAccuracy')`
          }
          yield* dropFeatureSignals
          yield* sql`ALTER TABLE signals_operations DROP COLUMN last_seen`
          yield* dropLogMessages
          yield* sql`DELETE FROM signals_migrations WHERE migration_id >= 10`
        }).pipe(Effect.orDie),
      )
      // Built again on it, its percentiles read as before, and new counts merge with them; when it
      // last ran is taken from its counts.
      const { read, lastSeen } = yield* inProject(
        "before-accuracy",
        now,
        Effect.gen(function* () {
          const signals = yield* Signals
          const before = yield* signals.operations({ period: lastHour })
          yield* signals.recordTraces(api, batchOf("b", [counts("GET /a", 2)]))
          const table = yield* signals.operations({ period: lastHour })
          return {
            read: table.rows.map((row) => [row.count, row.p50Ms]),
            lastSeen: before.lastSeen === undefined ? undefined : DateTime.toEpochMillis(before.lastSeen),
          }
        }),
      )

      assert.strictEqual(read.length, 1)
      assert.strictEqual(read[0]?.[0], 5)
      assert.closeTo(read[0]?.[1] ?? 0, 10, 10 * 0.02)
      assert.strictEqual(lastSeen, Math.min(capturedAt - (capturedAt % 60_000) + 60_000, now))
    }),
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
          yield* dropFeatureSignals
          yield* sql`DROP INDEX signals_logs_release`
          yield* sql`ALTER TABLE signals_logs DROP COLUMN release`
          yield* dropAppTables
          yield* sql`ALTER TABLE signals_operations DROP COLUMN last_seen`
          yield* dropLogMessages
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

// A span named for `feature`, as the Cluenori helpers name it.
const forFeature = (id: string, name: string, kind: Span["kind"], feature: string, failed = false): Span => ({
  ...span(id, id, name, kind, undefined, failed),
  attributes: new Map([["cluenori.feature", feature]]),
})

describe("Signals by feature", () => {
  it.effect("counts the operations that ran for a feature by day, and only those that named its key", () =>
    Effect.gen(function* () {
      const body = yield* encodeTraces([
        {
          resource: { attributes: new Map([["service.name", "notes-api"]]), droppedAttributesCount: 0 },
          schemaUrl: "",
          scopeSpans: [
            {
              scope: { name: "Notes", version: "", attributes: new Map(), droppedAttributesCount: 0 },
              schemaUrl: "",
              spans: [
                forFeature("a", "GET /export", "server", "editor.export"),
                forFeature("b", "GET /export", "server", "editor.export", true),
                // No feature key, and a client span, which is no operation: neither is counted for it.
                forFeature("c", "GET /export", "server", "Editor Export"),
                forFeature("d", "GET https://api.stripe.com", "client", "editor.export"),
                span("e", "e", "GET /export", "server", undefined),
              ],
            },
          ],
        },
      ])
      const { export: batch } = yield* TestClock.setTime(now).pipe(
        Effect.andThen(readTraces(body)),
        Effect.provide(WebCrypto),
      )
      const feature = FeatureKey.make("editor.export")
      const { every, inProd } = yield* inProject(
        "by-feature",
        now,
        Effect.gen(function* () {
          const signals = yield* Signals
          yield* signals.recordTraces(api, batch)
          return {
            every: yield* signals.featureOperations({ feature }),
            inProd: yield* signals.featureOperations({ feature, environment: EnvironmentKey.make("prod") }),
          }
        }),
      )

      assert.deepStrictEqual(
        every.map((row) => [row.day, row.component, row.operation, row.count, row.errors]),
        [["2026-10-19", api, "GET /export", 2, 1]],
      )
      // The service didn't say its environment, so none of it is prod's.
      assert.deepStrictEqual(inProd, [])
    }),
  )

  it.effect("counts a feature's operation past a component's 500 as (other operations), as their counts do", () =>
    inProject(
      "feature-other-operations",
      now,
      Effect.gen(function* () {
        const signals = yield* Signals
        const feature = FeatureKey.make("editor.export")
        const many = Array.from({ length: 500 }, (_, index) => counts(`GET /n${index}`, 1))
        yield* signals.recordTraces(api, batchOf("a", many))
        yield* signals.recordTraces(api, {
          ...batchOf("b", [counts("GET /export", 2)]),
          features: [{ day: 20745, feature, operation: EnvelopeName.make("GET /export"), count: 2, errors: 0 }],
        })
        assert.deepStrictEqual(
          (yield* signals.featureOperations({ feature })).map((row) => [row.operation, row.count]),
          [["(other operations)", 2]],
        )
      }),
    ),
  )
})

// A span of a request from the client `origin`, as the Cluenori helpers name it from its baggage.
const fromOrigin = (id: string, name: string, kind: Span["kind"], origin: string, failed = false): Span => ({
  ...span(id, id, name, kind, undefined, failed),
  attributes: new Map([["cluenori.origin.component", origin]]),
})

describe("Signals by origin", () => {
  it.effect("splits each operation by the client that asked for it, and counts only spans that named one", () =>
    Effect.gen(function* () {
      const body = yield* encodeTraces([
        {
          resource: { attributes: new Map([["service.name", "notes-api"]]), droppedAttributesCount: 0 },
          schemaUrl: "",
          scopeSpans: [
            {
              scope: { name: "Notes", version: "", attributes: new Map(), droppedAttributesCount: 0 },
              schemaUrl: "",
              spans: [
                fromOrigin("a", "GET /notes", "server", "notes-ios"),
                fromOrigin("b", "GET /notes", "server", "notes-ios", true),
                fromOrigin("c", "GET /notes", "server", "notes-web"),
                fromOrigin("d", "POST /notes", "server", "notes-web"),
                // A client that never reported to the project itself: its word alone isn't counted.
                fromOrigin("9", "GET /notes", "server", "notes-android"),
                // No component key, no origin, and a client span, which is no operation: none is counted.
                fromOrigin("e", "GET /notes", "server", "Notes iOS"),
                span("f", "f", "GET /notes", "server", undefined),
                fromOrigin("1", "GET https://api.stripe.com", "client", "notes-web"),
              ],
            },
          ],
        },
      ])
      const { export: batch } = yield* TestClock.setTime(now).pipe(
        Effect.andThen(readTraces(body)),
        Effect.provide(WebCrypto),
      )
      // The two clients report themselves too, each with its own key.
      const clients = yield* Effect.forEach(["notes-ios", "notes-web"], (client) =>
        encodeTraces([
          {
            resource: { attributes: new Map([["service.name", client]]), droppedAttributesCount: 0 },
            schemaUrl: "",
            scopeSpans: [
              {
                scope: { name: "Notes", version: "", attributes: new Map(), droppedAttributesCount: 0 },
                schemaUrl: "",
                spans: [span("8", "8", "notes.open", "internal", undefined)],
              },
            ],
          },
        ]).pipe(
          Effect.flatMap((each) => TestClock.setTime(now).pipe(Effect.andThen(readTraces(each)))),
          Effect.map((read) => [ComponentKey.make(client), read.export] as const),
          Effect.provide(WebCrypto),
        ),
      )
      const { all, one, later } = yield* inProject(
        "by-origin",
        now,
        Effect.gen(function* () {
          const signals = yield* Signals
          for (const [client, exported] of clients) {
            yield* signals.recordTraces(client, exported)
          }
          yield* signals.recordTraces(api, batch)
          return {
            all: yield* signals.origins({ period: lastHour }),
            one: yield* signals.origins({ period: lastHour, operation: EnvelopeName.make("POST /notes") }),
            later: yield* signals.origins({
              period: new Period({
                from: DateTime.makeUnsafe(now + 3_600_000),
                to: DateTime.makeUnsafe(now + 7_200_000),
              }),
            }),
          }
        }),
      )

      assert.deepStrictEqual(
        all.rows.map((row) => [row.component, row.operation, row.origin, row.count, row.errors, row.averageMs]),
        [
          [api, "GET /notes", "notes-ios", 2, 1, 1200],
          [api, "GET /notes", "notes-web", 1, 0, 1200],
          [api, "POST /notes", "notes-web", 1, 0, 1200],
        ],
      )
      // Counted by the hour: the last hour of the question touches two, from the start of the first.
      assert.deepStrictEqual(
        [all.covered?.from, all.covered?.to].map((at) => (at === undefined ? undefined : DateTime.formatIso(at))),
        ["2026-10-19T19:00:00.000Z", "2026-10-19T21:00:00.000Z"],
      )
      assert.deepStrictEqual(
        one.rows.map((row) => [row.operation, row.origin, row.count]),
        [["POST /notes", "notes-web", 1]],
      )
      // A period after now has nothing counted yet, and covers nothing.
      assert.deepStrictEqual(later, { rows: [] })
      // Each answer crosses to the Worker encoded, as the project object sends it.
      yield* Schema.encodeEffect(OriginTable)(all)
    }),
  )
})
