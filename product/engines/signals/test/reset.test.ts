import type { Span } from "@bagatka/otlp-protobuf"
import { encodeTraces, SpanId, TraceId as OtlpTraceId } from "@bagatka/otlp-protobuf"
import {
  ComponentKey,
  EnvelopeName,
  EnvironmentKey,
  InstallationId,
  Period,
  ReleaseVersion,
  SessionId,
} from "@cluenori/foundation"
import { SdkKey } from "@cluenori/projects"
import { assert, describe, it } from "@effect/vitest"
import { DateTime, Effect } from "effect"
import { Base64 } from "effect/encoding"
import { SqlClient } from "effect/sql"
import { TestClock } from "effect/testing"

import type { AppBatch, AppSignal } from "../src/index.ts"
import { AppBatchStore, AppSignalId, AppSignals, AppUserId, readLogs, readTraces, Signals } from "../src/index.ts"
import { dotnetLogs } from "./fixtures/dotnet-logs.ts"
import { dotnetTraces } from "./fixtures/dotnet-traces.ts"
import { inApps, WebCrypto } from "./in-object.ts"

// The fixtures' records happened from 2026-10-19T22:49:43.314Z; the tests run a minute later.
const capturedAt = 1792442983314
const now = capturedAt + 60_000
const hour = 3_600_000
const api = ComponentKey.make("notes-api")
const ios = ComponentKey.make("notes-ios")
const sender = { component: ios, key: SdkKey.make("cluenori-sdk.notes.notes-ios.R2d2C3poBb8Wq0Lk5Xz7Aa") }

// The tables a reset keeps: the duplicate windows, and the purges it marks.
const kept = new Set(["signals_app_seen", "signals_batches", "signals_purges"])

// A UUIDv7 made at `millis`, the `n`th.
const uuidAt = (millis: number, n: number) => {
  const time = millis.toString(16).padStart(12, "0")
  return `${time.slice(0, 8)}-${time.slice(8)}-7000-8000-${n.toString(16).padStart(12, "0")}`
}

const bytesOf = (base64: string) => Effect.fromResult(Base64.decode(base64)).pipe(Effect.orDie)
const readAt = <A, E, R>(time: number, read: Effect.Effect<A, E, R>) =>
  TestClock.setTime(time).pipe(Effect.andThen(read), Effect.provide(WebCrypto))

// A server span of `name`, for `feature` and from the client `origin`.
const spanOf = (id: string, name: string, attributes: ReadonlyArray<readonly [string, string]>): Span => ({
  traceId: OtlpTraceId.make(id.repeat(32)),
  spanId: SpanId.make(id.repeat(16)),
  traceState: "",
  parentSpanId: undefined,
  flags: 0,
  name,
  kind: "server",
  startTimeUnixNano: BigInt(capturedAt) * 1_000_000n,
  endTimeUnixNano: BigInt(capturedAt + 120) * 1_000_000n,
  attributes: new Map(attributes),
  droppedAttributesCount: 0,
  events: [],
  droppedEventsCount: 0,
  links: [],
  droppedLinksCount: 0,
  status: { code: "unset", message: "" },
})

const tracedExport = encodeTraces([
  {
    resource: { attributes: new Map([["service.name", "notes-api"]]), droppedAttributesCount: 0 },
    schemaUrl: "",
    scopeSpans: [
      {
        scope: { name: "Notes", version: "", attributes: new Map(), droppedAttributesCount: 0 },
        schemaUrl: "",
        spans: [
          spanOf("a", "GET /export", [
            ["cluenori.feature", "editor.export"],
            ["cluenori.origin.component", "notes-ios"],
          ]),
        ],
      },
    ],
  },
])

// An app's batch: a session with a screen, its readiness and visit, a launch, memory, a hang, a
// timing, an event, an error and MetricKit's report, so every table of apps' signals gets a row.
const appBatch = (at: number, n: number): AppBatch => {
  const session = SessionId.make(uuidAt(at, n * 100))
  const visit = AppSignalId.make(uuidAt(at, n * 100 + 99))
  const card = EnvelopeName.make("card")
  let i = 0
  const next = () => {
    i += 1
    return { id: AppSignalId.make(uuidAt(at, n * 100 + i)), at: DateTime.makeUnsafe(at + i), session }
  }
  const user = { user: AppUserId.make("u-1") }
  const signals: ReadonlyArray<AppSignal> = [
    { ...next(), _tag: "session.started", ...user },
    { ...next(), _tag: "screen", screen: card, ...user },
    { ...next(), _tag: "screen.ready", screen: card, visit, content: "fresh", ms: 300 },
    { ...next(), _tag: "screen.left", screen: card, visit, visibleMs: 30_000, cpuMs: 1_500 },
    { ...next(), _tag: "app.launched", start: "cold", prewarmed: false, firstFrameMs: 900 },
    { ...next(), _tag: "app.memory", reason: "interval", footprintBytes: 100_000_000, peakBytes: 150_000_000 },
    { ...next(), _tag: "app.hang", screen: card, ms: 400 },
    { ...next(), _tag: "timing", name: EnvelopeName.make("export.render"), ms: 120 },
    { ...next(), _tag: "event", name: EnvelopeName.make("card.flipped"), ...user },
    { ...next(), _tag: "error", type: "TypeError", message: "card is undefined", handled: true },
    {
      ...next(),
      _tag: "metrickit",
      report: "diagnostics",
      payload: { crashDiagnostics: [{ diagnosticMetaData: { appVersion: "0.3.0", appBuildVersion: "20" } }] },
    },
    { ...next(), _tag: "session.ended", foregroundMs: 60_000, ...user },
  ]
  return {
    installation: InstallationId.make(uuidAt(at - 400 * 86_400_000, 1)),
    environment: EnvironmentKey.make("production"),
    release: ReleaseVersion.make("0.3.0+20"),
    device: { model: "iPhone17,2", platform: "iOS", osVersion: "27.2", locale: "uk-UA", timeZone: "Europe/Kyiv" },
    sdk: { name: "cluenori-swift", version: "0.1.0" },
    sentAt: DateTime.makeUnsafe(at + 1_000),
    signals,
  }
}

// Every table of the engine in the project's database, but its migrations', with how many rows it holds.
const rowsByTable = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const tables = yield* sql<{ readonly name: string }>`SELECT name FROM sqlite_master
    WHERE type = 'table' AND name GLOB 'signals_*' AND name <> 'signals_migrations' ORDER BY name`
  const counted = yield* Effect.forEach(tables, ({ name }) =>
    sql<{ readonly count: number }>`SELECT count(*) AS count FROM ${sql(name)}`.pipe(
      Effect.map(([row]) => [name, row?.count ?? 0] as const),
    ),
  )
  return new Map(counted)
}).pipe(Effect.orDie)

describe("Signals' reset", () => {
  it.effect("empties every table of the engine but the duplicate windows, and counts what comes after once", () =>
    Effect.gen(function* () {
      const traces = yield* readAt(now, bytesOf(dotnetTraces).pipe(Effect.flatMap(readTraces)))
      const logs = yield* readAt(now, bytesOf(dotnetLogs).pipe(Effect.flatMap(readLogs)))
      const featured = yield* readAt(now, tracedExport.pipe(Effect.flatMap(readTraces)))
      const outcome = yield* inApps(
        "reset-tables",
        now,
        Effect.gen(function* () {
          const signals = yield* Signals
          const apps = yield* AppSignals
          // The app first, so the services' spans from it count by origin.
          yield* apps.record(sender, appBatch(now - hour, 1))
          yield* signals.recordTraces(api, traces.export)
          yield* signals.recordLogs(api, logs.export)
          yield* signals.recordTraces(api, featured.export)
          const rowsBefore = yield* rowsByTable

          yield* signals.reset(DateTime.makeUnsafe(now))
          yield* apps.reset(DateTime.makeUnsafe(now))
          const rowsAfter = yield* rowsByTable

          // What was sent before, sent again, is a duplicate; what is new counts once.
          yield* TestClock.adjust(60_000)
          const sentAgain = {
            traces: yield* signals.recordTraces(api, traces.export),
            app: yield* apps.record(sender, appBatch(now - hour, 1)),
          }
          const fresh = yield* apps.record(sender, appBatch(now + 30_000, 2))
          const period = new Period({ from: DateTime.makeUnsafe(now - 2 * hour), to: DateTime.makeUnsafe(now + hour) })
          const usage = yield* apps.usage({ period })
          const operations = yield* signals.operations({ period })
          return {
            before: rowsBefore,
            after: rowsAfter,
            again: sentAgain,
            counted: { fresh, sessions: usage.sessions, operations: operations.count },
          }
        }),
      )

      const { before, after, again, counted } = outcome
      // Every table the test could fill had rows before; those it can't fill are listed.
      const empty = [...before].filter(([, count]) => count === 0).map(([name]) => name)
      assert.deepStrictEqual(empty, ["signals_purges"])
      for (const [table, count] of after) {
        if (kept.has(table)) {
          assert.isAbove(count, 0, table)
        } else {
          assert.strictEqual(count, 0, table)
        }
      }
      assert.strictEqual(after.get("signals_batches"), before.get("signals_batches"))
      assert.strictEqual(after.get("signals_app_seen"), before.get("signals_app_seen"))
      assert.deepStrictEqual(again, { traces: "duplicate", app: { accepted: 0, duplicates: 12 } })
      assert.deepStrictEqual(counted, { fresh: { accepted: 12, duplicates: 0 }, sessions: 1, operations: 0 })
    }),
  )

  it.effect("deletes, a few pages a run, the apps' batches stored before the reset, and keeps those after", () =>
    Effect.gen(function* () {
      const files = new Map<string, string>()
      const purged = yield* inApps(
        "reset-purge",
        now,
        Effect.gen(function* () {
          const apps = yield* AppSignals
          const store = yield* AppBatchStore
          const sql = yield* SqlClient.SqlClient
          // 6,000 files before the reset, another project's beside them, and some after, between them by key.
          for (let n = 0; n < 6_000; n++) {
            yield* store.put(`main/reset-purge/old-${String(n).padStart(5, "0")}.json`, "{}")
          }
          yield* store.put("main/reset-purge-other/old.json", "{}")
          yield* TestClock.adjust(1_000)
          yield* apps.reset(DateTime.makeUnsafe(now + 1_000))
          for (const n of [0, 2_999, 5_999]) {
            yield* store.put(`main/reset-purge/old-${String(n).padStart(5, "0")}-new.json`, "{}")
          }
          yield* store.put("main/reset-purge/zz-new.json", "{}")
          yield* apps.purgeBatches
          const afterFirst = files.size
          yield* apps.purgeBatches
          const afterSecond = files.size
          yield* apps.purgeBatches
          const left = yield* sql<{ readonly store: string }>`SELECT store FROM signals_purges`
          return { first: afterFirst, second: afterSecond, marks: left }
        }),
        { files },
      )

      const { first, second, marks } = purged
      // The first run listed 5 pages of 1,000, two new files among them, and deleted the 4,998 old;
      // the second, the rest; the third found nothing marked.
      assert.strictEqual(first, 6_000 + 1 + 4 - 4_998)
      assert.strictEqual(second, 1 + 4)
      assert.deepStrictEqual([...files.keys()].toSorted(), [
        "main/reset-purge-other/old.json",
        "main/reset-purge/old-00000-new.json",
        "main/reset-purge/old-02999-new.json",
        "main/reset-purge/old-05999-new.json",
        "main/reset-purge/zz-new.json",
      ])
      assert.deepStrictEqual(marks, [])
    }),
  )
})
