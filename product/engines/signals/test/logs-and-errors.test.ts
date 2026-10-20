import type { LogRecord, ResourceLogs } from "@bagatka/otlp"
import { decodeLogs, encodeLogs } from "@bagatka/otlp"
import { ComponentKey, Period, TraceId } from "@cluenori/foundation"
import { assert, describe, it } from "@effect/vitest"
import { DateTime, Duration, Effect, Layer } from "effect"
import { Base64 } from "effect/encoding"
import { TestClock } from "effect/testing"

import type { LogEntry, LogExport } from "../src/index.ts"
import {
  ArchiveStore,
  ArchiveUnavailable,
  BatchDigest,
  ErrorGroupNotFound,
  ErrorGroupId,
  readLogs,
  readTraces,
  Signals,
} from "../src/index.ts"
import { dotnetLogs } from "./fixtures/dotnet-logs.ts"
import { dotnetTraces } from "./fixtures/dotnet-traces.ts"
import { inProject, WebCrypto } from "./in-object.ts"

// The fixtures' records happened from 2026-10-19T22:49:43.314Z; the tests ask a minute later.
const capturedAt = 1792442983314
const now = capturedAt + 60_000
const api = ComponentKey.make("notes-api")
const lastHour = new Period({ from: DateTime.makeUnsafe(now - 3_600_000), to: DateTime.makeUnsafe(now) })
const exportTrace = TraceId.make("782b83a9114f7ebce1fce192e59a0f7f")

const bytesOf = (base64: string) => Effect.fromResult(Base64.decode(base64)).pipe(Effect.orDie)

const readAt = <A, E, R>(time: number, read: Effect.Effect<A, E, R>) =>
  TestClock.setTime(time).pipe(Effect.andThen(read), Effect.provide(WebCrypto))

const fixtureLogs = bytesOf(dotnetLogs).pipe(Effect.flatMap(readLogs))
const fixtureTraces = bytesOf(dotnetTraces).pipe(Effect.flatMap(readTraces))

const oneRecordExport = (record: Partial<LogRecord>): ReadonlyArray<ResourceLogs> => [
  {
    resource: new Map([["service.name", "notes-api"]]),
    scopeLogs: [
      {
        scope: { name: "Notes.Invites", version: "" },
        logRecords: [
          {
            timeUnixNano: BigInt(capturedAt) * 1_000_000n,
            observedTimeUnixNano: 0n,
            severityNumber: 13,
            severityText: "Warning",
            body: "",
            attributes: new Map(),
            traceId: undefined,
            spanId: undefined,
            eventName: "",
            ...record,
          },
        ],
      },
    ],
  },
]

const warning = (index: number): LogEntry => ({
  time: DateTime.makeUnsafe(capturedAt + index),
  level: "warn",
  category: "Notes.Sync",
  message: `Sync ${index} was slow`,
  attributes: {},
})

const logExportOf = (digit: string, entries: ReadonlyArray<LogEntry>): LogExport => ({
  digest: BatchDigest.make(digit.repeat(64)),
  archive: new Uint8Array(0),
  from: DateTime.makeUnsafe(capturedAt),
  to: DateTime.makeUnsafe(capturedAt),
  records: entries.length,
  entries,
  errors: [],
})

describe("readLogs", () => {
  it.effect("keeps a .NET export's warnings and errors, and groups its errors", () =>
    Effect.gen(function* () {
      const { export: read, rejected } = yield* readAt(now, fixtureLogs)
      const timeouts = read.entries.filter((entry) => entry.exception?.type === "TimeoutException")

      assert.isUndefined(rejected)
      assert.strictEqual(read.records, 27)
      assert.deepStrictEqual(
        read.entries.map((entry) => entry.level),
        ["warn", "error", "warn", "error", "warn", "error", "error", "error"],
      )
      assert.deepStrictEqual(read.errors.map((group) => group.title).toSorted(), [
        "InvalidOperationException: Note store is unavailable",
        "TimeoutException: Notification service did not answer",
      ])
      assert.strictEqual(new Set(timeouts.map((entry) => entry.error)).size, 1)
      assert.strictEqual(timeouts[0]?.trace, "782b83a9114f7ebce1fce192e59a0f7f")
      assert.strictEqual(timeouts[0]?.template, "Export {ExportId} could not notify {Recipients} recipients")
    }),
  )

  it.effect("removes emails and credentials before anything is kept, in the archive too", () =>
    Effect.gen(function* () {
      const exported = oneRecordExport({
        body: "Invite to anna@example.com failed: Bearer abcDEF1234567890",
        attributes: new Map([
          ["password", "hunter2hunter2"],
          ["url.full", "https://notes.example/join?token=s3cr3t&team=7"],
        ]),
      })
      const { export: read } = yield* readAt(now, readLogs(encodeLogs(exported)))
      const [entry] = read.entries
      const archived = yield* decodeLogs(read.archive)
      const archivedRecord = archived[0]?.scopeLogs[0]?.logRecords[0]

      assert.strictEqual(entry?.message, "Invite to [email] failed: Bearer [token]")
      assert.deepStrictEqual(entry?.attributes, {
        password: "[secret]",
        "url.full": "https://notes.example/join?token=[secret]&team=7",
      })
      assert.strictEqual(archivedRecord?.body, "Invite to [email] failed: Bearer [token]")
      assert.strictEqual(archivedRecord?.attributes.get("password"), "[secret]")
    }),
  )

  it.effect("archives warnings older than the 90 days they are kept, without indexing them", () =>
    Effect.gen(function* () {
      const { export: read, rejected } = yield* readAt(now + Duration.toMillis(Duration.days(100)), fixtureLogs)

      assert.isEmpty(read.entries)
      assert.strictEqual(read.records, 27)
      assert.deepStrictEqual(rejected, {
        count: 8,
        problem: "A warning or error is older than the 90 days they are kept",
      })
    }),
  )
})

describe("Signals' warnings and errors", () => {
  it.effect("lists errors by how often they happened, saying what and where", () =>
    Effect.gen(function* () {
      const { export: read } = yield* readAt(now, fixtureLogs)
      const table = yield* inProject(
        "lists-errors",
        now,
        Effect.gen(function* () {
          const signals = yield* Signals
          yield* signals.recordLogs(api, read)
          return yield* signals.errors({ period: lastHour })
        }),
      )
      const [timeouts, unhandled] = table.groups

      assert.strictEqual(table.occurrences, 5)
      assert.strictEqual(timeouts?.title, "TimeoutException: Notification service did not answer")
      assert.strictEqual(timeouts?.occurrences, 3)
      assert.strictEqual(timeouts?.kind, "exception")
      assert.strictEqual(timeouts?.lastComponent, "notes-api")
      assert.strictEqual(timeouts?.lastEnvironment, "production")
      assert.strictEqual(unhandled?.occurrences, 2)
      assert.isAbove(unhandled?.culprit.length ?? 0, 0)
    }),
  )

  it.effect("shows an error's latest occurrences with their stacks and traces", () =>
    Effect.gen(function* () {
      const { export: read } = yield* readAt(now, fixtureLogs)
      const timeoutId = read.errors.find((group) => group.title.startsWith("TimeoutException"))?.id
      const { detail, missing } = yield* inProject(
        "error-detail",
        now,
        Effect.gen(function* () {
          const signals = yield* Signals
          yield* signals.recordLogs(api, read)
          const found = yield* signals.error(timeoutId ?? ErrorGroupId.make("0".repeat(16)), { period: lastHour })
          const notThere = yield* signals
            .error(ErrorGroupId.make("f".repeat(16)), { period: lastHour })
            .pipe(Effect.flip)
          return { detail: found, missing: notThere }
        }),
      )

      assert.strictEqual(detail.group.occurrences, 3)
      assert.strictEqual(detail.latest.length, 3)
      assert.include(detail.latest[0]?.exception?.stack ?? "", "TimeoutException")
      assert.isDefined(detail.latest[0]?.trace)
      assert.deepStrictEqual(missing, new ErrorGroupNotFound({ error: ErrorGroupId.make("f".repeat(16)) }))
    }),
  )

  it.effect("searches warnings and errors by level, text, and trace", () =>
    Effect.gen(function* () {
      const { export: read } = yield* readAt(now, fixtureLogs)
      const found = yield* inProject(
        "searches-logs",
        now,
        Effect.gen(function* () {
          const signals = yield* Signals
          yield* signals.recordLogs(api, read)
          const all = yield* signals.logs({ period: lastHour })
          const errorsOnly = yield* signals.logs({ period: lastHour, minimumLevel: "error" })
          const slowly = yield* signals.logs({ period: lastHour, search: "SLOWLY" })
          const ofTrace = yield* signals.logs({ period: lastHour, trace: exportTrace })
          return [all, errorsOnly, slowly, ofTrace].map((page) => page.lines.length)
        }),
      )

      assert.deepStrictEqual(found, [8, 5, 3, 2])
    }),
  )

  it.effect("pages through many warnings, newest first", () =>
    inProject(
      "pages",
      now,
      Effect.gen(function* () {
        const signals = yield* Signals
        yield* signals.recordLogs(
          api,
          logExportOf(
            "a",
            Array.from({ length: 150 }, (_, index) => warning(index)),
          ),
        )
        const first = yield* signals.logs({ period: lastHour })
        const second = yield* signals.logs({
          period: lastHour,
          ...(first.next === undefined ? {} : { before: first.next }),
        })

        assert.strictEqual(first.lines.length, 100)
        assert.strictEqual(first.lines[0]?.message, "Sync 149 was slow")
        assert.isDefined(first.next)
        assert.strictEqual(second.lines.length, 50)
        assert.isUndefined(second.next)
      }),
    ),
  )

  it.effect("counts a retried log export once", () =>
    Effect.gen(function* () {
      const { export: read } = yield* readAt(now, fixtureLogs)
      const { outcomes, table } = yield* inProject(
        "log-retry",
        now,
        Effect.gen(function* () {
          const signals = yield* Signals
          const first = yield* signals.recordLogs(api, read)
          const retry = yield* signals.recordLogs(api, read)
          const errors = yield* signals.errors({ period: lastHour })
          return { outcomes: [first, retry], table: errors }
        }),
      )

      assert.deepStrictEqual(outcomes, ["recorded", "duplicate"])
      assert.strictEqual(table.occurrences, 5)
    }),
  )

  it.effect("stores nothing when the archive can't keep an export", () =>
    Effect.gen(function* () {
      const { export: read } = yield* readAt(now, fixtureLogs)
      const unavailable = Layer.succeed(
        ArchiveStore,
        ArchiveStore.of({
          put: () => Effect.fail(new ArchiveUnavailable({ message: "R2 is down" })),
          get: () => Effect.fail(new ArchiveUnavailable({ message: "R2 is down" })),
        }),
      )
      const { failure, table } = yield* inProject(
        "archive-down",
        now,
        Effect.gen(function* () {
          const signals = yield* Signals
          const failed = yield* signals.recordLogs(api, read).pipe(Effect.flip)
          const errors = yield* signals.errors({ period: lastHour })
          return { failure: failed, table: errors }
        }),
        unavailable,
      )

      assert.strictEqual(failure._tag, "ArchiveUnavailable")
      assert.strictEqual(table.occurrences, 0)
    }),
  )
})

describe("Signals' traces", () => {
  it.effect("shows one request from the archive: its spans as a tree and its logs at every level", () =>
    Effect.gen(function* () {
      const { export: logs } = yield* readAt(now, fixtureLogs)
      const { export: traces } = yield* readAt(now, fixtureTraces)
      const view = yield* inProject(
        "trace-view",
        now,
        Effect.gen(function* () {
          const signals = yield* Signals
          yield* signals.recordTraces(api, traces)
          yield* signals.recordLogs(api, logs)
          return yield* signals.trace(exportTrace, DateTime.makeUnsafe(1792442983443))
        }),
      )

      assert.deepStrictEqual(
        view.spans.map((span) => [span.depth, span.kind, span.name]),
        [
          [0, "server", "POST /api/export"],
          [1, "client", "GET"],
          [2, "server", "GET /api/render/{format}"],
        ],
      )
      assert.includeMembers(
        view.logs.map((log) => log.message),
        [
          "Export exp-3760 started with 3 notes",
          "Export exp-3760 rendered slowly in 31.5 ms",
          "Export exp-3760 could not notify 2 recipients",
        ],
      )
      assert.strictEqual(view.logs[0]?.level, "info")
      assert.deepStrictEqual(view.files, { read: 2, unread: 0 })
    }),
  )

  it.effect("finds nothing far from when the request happened", () =>
    Effect.gen(function* () {
      const { export: traces } = yield* readAt(now, fixtureTraces)
      const view = yield* inProject(
        "trace-elsewhere",
        now,
        Effect.gen(function* () {
          const signals = yield* Signals
          yield* signals.recordTraces(api, traces)
          return yield* signals.trace(exportTrace, DateTime.makeUnsafe(capturedAt - 3_600_000))
        }),
      )

      assert.isEmpty(view.spans)
      assert.deepStrictEqual(view.files, { read: 0, unread: 0 })
    }),
  )
})

const stackOf = (lambda: string, line: number) =>
  [
    "System.TimeoutException: Notification service did not answer",
    `   at Program.<>c.<<<Main>$>b__0_${lambda}>d.MoveNext() in /src/notes-api/Program.cs:line ${line}`,
    "   at Microsoft.AspNetCore.Http.RequestDelegateFactory.ExecuteTaskResult[T](Task`1 task, HttpContext httpContext)",
  ].join("\n")

const failed = (syncId: string) =>
  encodeLogs(
    oneRecordExport({
      severityNumber: 17,
      body: `Sync ${syncId} failed`,
      attributes: new Map([["{OriginalFormat}", "Sync {SyncId} failed"]]),
    }),
  )

const failureOf = (lambda: string, line: number, exportId: string) =>
  encodeLogs(
    oneRecordExport({
      severityNumber: 17,
      severityText: "Error",
      body: `Export ${exportId} could not notify recipients`,
      attributes: new Map([
        ["exception.type", "TimeoutException"],
        ["exception.message", "Notification service did not answer"],
        ["exception.stacktrace", stackOf(lambda, line)],
      ]),
    }),
  )

describe("error groups", () => {
  it.effect("group the same code's errors after a rebuild, naming where they happen as written", () =>
    Effect.gen(function* () {
      const before = yield* readAt(now, readLogs(failureOf("5", 108, "exp-1")))
      const after = yield* readAt(now, readLogs(failureOf("6", 112, "exp-9")))
      const [group] = before.export.errors

      assert.strictEqual(group?.id, after.export.errors[0]?.id)
      assert.strictEqual(group?.culprit, "Program.<>c.<<<Main>$>b__0_5>d.MoveNext()")
      assert.strictEqual(group?.title, "TimeoutException: Notification service did not answer")
    }),
  )

  it.effect("group errors without an exception by their logger and template", () =>
    Effect.gen(function* () {
      const first = yield* readAt(now, readLogs(failed("42")))
      const second = yield* readAt(now, readLogs(failed("43")))

      assert.deepInclude(first.export.errors[0], {
        kind: "log",
        title: "Sync {SyncId} failed",
        culprit: "Notes.Invites",
      })
      assert.strictEqual(first.export.errors[0]?.id, second.export.errors[0]?.id)
    }),
  )
})
