import { BunCrypto } from "@effect/platform-bun"
import { assert, describe, it } from "@effect/vitest"
import { ConfigProvider, Console, DateTime, Effect, FileSystem, Layer, Path, Stdio, Terminal } from "effect"
import { Command } from "effect/cli"
import { FetchHttpClient } from "effect/http"
import { ChildProcessSpawner } from "effect/process"

import { error, errors, logMessages, logs, trace } from "../src/errors-commands.ts"

const root = Command.make("cluenori").pipe(Command.withSubcommands([errors, error, logs, logMessages, trace]))
const deployment = { jurisdiction: "eu", url: "https://cluenori.example", token: "made-up-test-token" }
const covered = { from: "2026-10-19T08:00:00.000Z", to: "2026-10-19T09:00:00.000Z" }
const traceId = "123456789abcdef0123456789abcdef0"
const errorId = "123456789abcdef0"
const group = {
  id: errorId,
  kind: "exception",
  title: "Export failed",
  culprit: "exportNotes",
  occurrences: 3,
  firstSeen: covered.from,
  lastSeen: covered.to,
  lastComponent: "notes-api",
  lastEnvironment: "production",
  lastRelease: "1.4.0",
}
const line = {
  id: 27,
  messageId: 4,
  time: covered.to,
  level: "error",
  component: "notes-api",
  category: "Notes.Exports",
  message: "Export 42 failed",
  exception: { type: "ExportError", message: "Storage unavailable", stack: "at exportNotes (exports.ts:42)" },
  trace: traceId,
  attributes: { format: "plain", attempt: 2, retry: true, context: { region: "eu" }, missing: null },
}
const plainLine = {
  id: 26,
  messageId: 5,
  time: covered.from,
  level: "warn",
  component: "jobs",
  category: "Jobs.Queue",
  message: "Queue busy",
  attributes: {},
}
const message = {
  id: 4,
  level: "error",
  title: "Export {id} failed",
  category: "Notes.Exports",
  lines: 7,
  firstSeen: covered.from,
  lastSeen: covered.to,
  lastComponent: "notes-api",
}
const span = {
  span: "123456789abcdef0",
  depth: 0,
  name: "POST /exports",
  kind: "server",
  component: "notes-api",
  start: covered.from,
  durationMs: 1500,
  failed: false,
  attributes: {},
  events: [],
}
const view = { trace: traceId, searched: covered, spans: [], logs: [], files: { read: 1, unread: 0 } }

// Run the real parser, typed API client and presentation; only the external seams are supplied.
const run = Effect.fnUntraced(function* (args: ReadonlyArray<string>, answer: (request: Request) => Response) {
  const requests: Array<Request> = []
  const output: Array<string> = []
  const stderr: Array<string> = []
  const current = yield* Console.Console
  const result = yield* Command.runWith(root, { version: "test" })(args).pipe(
    Effect.result,
    Effect.provideService(
      Console.Console,
      Object.assign(Object.create(current), {
        log: (...values: ReadonlyArray<unknown>) => output.push(values.join(" ")),
        error: (...values: ReadonlyArray<unknown>) => stderr.push(values.join(" ")),
      }),
    ),
    Effect.provideService(FetchHttpClient.Fetch, (input, init) => {
      const request = new Request(input, init)
      requests.push(request)
      return Promise.resolve(answer(request))
    }),
    Effect.provide(
      Layer.mergeAll(
        BunCrypto.layer,
        ConfigProvider.layer(ConfigProvider.fromEnvRecord({ HOME: "/test-home", XDG_CONFIG_HOME: "/test-config" })),
        FileSystem.layerNoop({
          exists: (path) => Effect.succeed(path === "/test-config/cluenori/deployment.json"),
          readFileString: () => Effect.succeed(JSON.stringify(deployment)),
        }),
        Path.layer,
        Stdio.layerTest({}),
        Layer.succeed(
          Terminal.Terminal,
          Terminal.make({
            columns: Effect.succeed(120),
            rows: Effect.succeed(40),
            readInput: Effect.die("Read-only commands must not prompt"),
            readLine: Effect.die("Read-only commands must not prompt"),
            display: () => Effect.void,
          }),
        ),
        Layer.succeed(
          ChildProcessSpawner.ChildProcessSpawner,
          ChildProcessSpawner.make(() => Effect.die("Read-only commands must not start programs")),
        ),
      ),
    ),
  )
  return { result, requests, output: output.join("\n"), errors: stderr.join("\n") }
})

describe("error, log and trace commands", () => {
  it.effect("asks for the selected errors and distinguishes counts, groups and an empty period", () =>
    Effect.gen(function* () {
      const answer = yield* run(
        ["errors", "folio", "--last", "6h", "--environment", "production", "--component", "notes-api"],
        () =>
          Response.json({
            covered,
            groups: [group, { ...group, id: "223456789abcdef0", title: "Queue failed", occurrences: 1 }],
            occurrences: 4,
          }),
      )
      assert.strictEqual(answer.result._tag, "Success")
      assert.strictEqual(answer.requests.length, 1)
      const request = answer.requests[0]
      assert(request !== undefined)
      const url = new URL(request.url)
      assert.strictEqual(url.origin, deployment.url)
      assert.strictEqual(url.pathname, "/api/projects/folio/errors")
      assert.strictEqual(request.headers.get("authorization"), "Bearer made-up-test-token")
      assert.strictEqual(url.searchParams.get("environment"), "production")
      assert.strictEqual(url.searchParams.get("component"), "notes-api")
      assert.strictEqual(
        DateTime.toEpochMillis(DateTime.makeUnsafe(url.searchParams.get("to") ?? "")) -
          DateTime.toEpochMillis(DateTime.makeUnsafe(url.searchParams.get("from") ?? "")),
        21_600_000,
      )
      assert.include(answer.output, "folio on https://cluenori.example, 2026-10-19 08:00 UTC to 2026-10-19 09:00 UTC")
      assert.match(answer.output, /Export failed\s+3\s+2026-10-19 09:00 UTC\s+123456789abcdef0/)
      assert.match(answer.output, /Queue failed\s+1\s+2026-10-19 09:00 UTC\s+223456789abcdef0/)
      assert.include(answer.output, "4 errors in 2 groups.")
      assert.include(answer.output, "./cluenori error folio <ID>")
      const once = yield* run(["errors", "folio"], () =>
        Response.json({ groups: [{ ...group, occurrences: 1 }], occurrences: 1 }),
      )
      assert.strictEqual(once.result._tag, "Success")
      assert.include(once.output, "1 error in 1 group.")
      const empty = yield* run(["errors", "folio"], () => Response.json({ groups: [], occurrences: 0 }))
      assert.strictEqual(empty.result._tag, "Success")
      assert.include(empty.output, "no part of the period is kept (warnings and errors are kept 90 days)")
      assert.include(empty.output, "No errors from folio in this period.")
      assert.notInclude(empty.output, "0 errors")
    }),
  )

  it.effect("opens an error's stack, attributes and latest trace with its timestamp", () =>
    Effect.gen(function* () {
      const answer = yield* run(["error", "folio", errorId], () =>
        Response.json({ group, latest: [line, plainLine, { ...plainLine, time: "2026-10-19T07:59:00Z" }] }),
      )
      assert.strictEqual(answer.result._tag, "Success")
      assert.strictEqual(new URL(answer.requests[0]?.url ?? "").pathname, `/api/projects/folio/errors/${errorId}`)
      assert.include(answer.output, "Export failed\n  at exportNotes")
      assert.include(
        answer.output,
        "3 times in this period; first seen 2026-10-19 08:00 UTC, last 2026-10-19 09:00 UTC in notes-api production 1.4.0",
      )
      assert.include(
        answer.output,
        "Latest:\n2026-10-19 09:00:00 UTC  ERROR  notes-api  Notes.Exports\n  Export 42 failed\n  ExportError: Storage unavailable\n  trace " +
          traceId,
      )
      assert.include(answer.output, "at exportNotes (exports.ts:42)")
      assert.include(
        answer.output,
        '  format: plain\n  attempt: 2\n  retry: true\n  context: {"region":"eu"}\n  missing: null',
      )
      assert.include(answer.output, `./cluenori trace folio ${traceId} --at 2026-10-19T09:00:00.000Z`)
      assert.include(answer.output, "Earlier: 2026-10-19 08:00:00 UTC, 2026-10-19 07:59:00 UTC")
      const { lastEnvironment: _, lastRelease: _release, ...withoutLocation } = group
      const minimal = yield* run(["error", "folio", errorId], () =>
        Response.json({ group: { ...withoutLocation, occurrences: 1 }, latest: [plainLine] }),
      )
      assert.strictEqual(minimal.result._tag, "Success")
      assert.include(minimal.output, "Once in this period;")
      assert.include(minimal.output, "in notes-api\n")
      assert.include(minimal.output, "WARN   jobs  Jobs.Queue\n  Queue busy")
      assert.notInclude(minimal.output, "undefined")
      assert.notInclude(minimal.output, "Earlier:")
      assert.notInclude(minimal.output, "Its trace")
      const noOccurrences = yield* run(["error", "folio", errorId], () =>
        Response.json({ group: { ...group, occurrences: 0 }, latest: [] }),
      )
      assert.strictEqual(noOccurrences.result._tag, "Success")
      assert.include(noOccurrences.output, "0 times in this period")
      assert.notInclude(noOccurrences.output, "Latest:")
    }),
  )

  it.effect("sends log filters and prints older-page navigation only when supplied", () =>
    Effect.gen(function* () {
      const answer = yield* run(
        [
          "logs",
          "folio",
          "--level",
          "fatal",
          "--search",
          "Export 42",
          "--category",
          "Notes.Exports",
          "--trace",
          traceId,
          "--error",
          errorId,
          "--message",
          "4",
          "--before",
          "28",
        ],
        () => Response.json({ covered, lines: [line, plainLine], next: 26 }),
      )
      assert.strictEqual(answer.result._tag, "Success")
      const url = new URL(answer.requests[0]?.url ?? "")
      assert.strictEqual(url.pathname, "/api/projects/folio/logs")
      for (const [key, value] of Object.entries({
        level: "fatal",
        search: "Export 42",
        category: "Notes.Exports",
        trace: traceId,
        error: errorId,
        message: "4",
        before: "28",
      })) {
        assert.strictEqual(url.searchParams.get(key), value)
      }
      assert.include(answer.output, "folio on https://cluenori.example, 2026-10-19 08:00 UTC to 2026-10-19 09:00 UTC")
      assert.include(
        answer.output,
        "ERROR  notes-api  Notes.Exports\n  Export 42 failed\n  ExportError: Storage unavailable\n  trace " + traceId,
      )
      assert.include(answer.output, "WARN   jobs  Jobs.Queue\n  Queue busy")
      assert.include(answer.output, "Older ones: add --before 26")
      const defaults = yield* run(["logs", "folio"], () => Response.json({ lines: [plainLine] }))
      assert.strictEqual(defaults.result._tag, "Success")
      const query = new URL(defaults.requests[0]?.url ?? "").searchParams
      assert.strictEqual(query.get("level"), "warn")
      for (const key of ["search", "category", "trace", "error", "message", "before"]) assert.isFalse(query.has(key))
      assert.notInclude(defaults.output, "Older ones")
      const empty = yield* run(["logs", "folio"], () => Response.json({ lines: [] }))
      assert.strictEqual(empty.result._tag, "Success")
      assert.include(empty.output, "No warnings or errors match.")
    }),
  )

  it.effect("counts unshown log messages without confusing them with shown lines", () =>
    Effect.gen(function* () {
      const answer = yield* run(["log-messages", "folio", "--level", "error", "--search", "Export"], () =>
        Response.json({
          covered,
          messages: [message, { ...message, id: 5, lines: 6 }, { ...message, id: 6, lines: 3 }],
          lines: 19,
          unshown: 2,
        }),
      )
      assert.strictEqual(answer.result._tag, "Success")
      const url = new URL(answer.requests[0]?.url ?? "")
      assert.strictEqual(url.pathname, "/api/projects/folio/logs/messages")
      assert.strictEqual(url.searchParams.get("level"), "error")
      assert.strictEqual(url.searchParams.get("search"), "Export")
      assert.include(answer.output, "folio on https://cluenori.example, 2026-10-19 08:00 UTC to 2026-10-19 09:00 UTC")
      assert.match(answer.output, /ERROR\s+Export \{id\} failed\s+Notes.Exports\s+7\s+2026-10-19 09:00 UTC\s+4/)
      assert.include(answer.output, "19 lines in 5 messages, the 3 with the most shown.")
      assert.include(answer.output, "./cluenori logs folio --message <ID>")
      const once = yield* run(["log-messages", "folio"], () =>
        Response.json({ messages: [{ ...message, lines: 1 }], lines: 1, unshown: 0 }),
      )
      assert.strictEqual(once.result._tag, "Success")
      const query = new URL(once.requests[0]?.url ?? "").searchParams
      assert.strictEqual(query.get("level"), "warn")
      assert.isFalse(query.has("search"))
      assert.include(once.output, "1 line in 1 message.")
      assert.notInclude(once.output, "most shown")
      const empty = yield* run(["log-messages", "folio"], () => Response.json({ messages: [], lines: 0, unshown: 0 }))
      assert.strictEqual(empty.result._tag, "Success")
      assert.include(empty.output, "No warnings or errors match.")
      assert.notInclude(empty.output, "0 lines")
    }),
  )

  it.effect("accepts each supported explicit log level and refuses levels outside the indexed logs", () =>
    Effect.gen(function* () {
      for (const command of ["logs", "log-messages"]) {
        for (const level of ["warn", "error", "fatal"]) {
          const answer = yield* run([command, "folio", "--level", level], () =>
            Response.json(command === "logs" ? { lines: [] } : { messages: [], lines: 0, unshown: 0 }),
          )
          assert.strictEqual(answer.result._tag, "Success")
          assert.strictEqual(answer.requests.length, 1)
          assert.strictEqual(new URL(answer.requests[0]?.url ?? "").searchParams.get("level"), level)
        }
        const refused = yield* run([command, "folio", "--level", "info"], () => Response.json({}))
        assert.strictEqual(refused.result._tag, "Failure")
        assert.isEmpty(refused.requests)
      }
    }),
  )

  it.effect("opens a trace near the supplied time, with nested spans, logs and unread-file counts", () =>
    Effect.gen(function* () {
      const { level: _, ...unknownLevel } = plainLine
      const answer = yield* run(["trace", "folio", traceId, "--at", "2026-10-19T09:00:00+01:00"], () =>
        Response.json({
          ...view,
          spans: [
            span,
            {
              ...span,
              span: "223456789abcdef0",
              depth: 2,
              name: "Write export",
              durationMs: 12,
              failed: true,
              kind: "client",
              component: "jobs",
            },
          ],
          logs: [line, unknownLevel],
          files: { read: 2, unread: 3 },
        }),
      )
      assert.strictEqual(answer.result._tag, "Success")
      const url = new URL(answer.requests[0]?.url ?? "")
      assert.strictEqual(url.pathname, `/api/projects/folio/traces/${traceId}`)
      assert.strictEqual(url.searchParams.get("around"), covered.from)
      assert.include(
        answer.output,
        `Trace ${traceId}, from 2026-10-19 08:00:00 UTC to 2026-10-19 09:00:00 UTC, read from 2 archive files`,
      )
      assert.match(answer.output, /POST \/exports\s+1.5s\s+server\s+notes-api/)
      assert.match(answer.output, /\n {4}Write export\s+12ms\s+failed\s+client\s+jobs/)
      assert.include(
        answer.output,
        "Logs:\n09:00:00.000  ERROR  Notes.Exports  Export 42 failed\n    ExportError: Storage unavailable",
      )
      assert.include(answer.output, "08:00:00.000  ?      Jobs.Queue  Queue busy")
      assert.include(answer.output, "3 more of its archive files weren't read")
      assert.include(answer.output, "--at")
    }),
  )

  it.effect("keeps spans-only and logs-only traces distinct from an absent trace", () =>
    Effect.gen(function* () {
      for (const [contents, expected] of [
        [{ spans: [span], logs: [] }, "POST /exports"],
        [{ spans: [], logs: [plainLine] }, "Logs:"],
      ] as const) {
        const answer = yield* run(["trace", "folio", traceId], () =>
          Response.json({ ...view, ...contents, files: { read: 1, unread: 1 } }),
        )
        assert.strictEqual(answer.result._tag, "Success")
        assert.isFalse(new URL(answer.requests[0]?.url ?? "").searchParams.has("around"))
        assert.include(answer.output, "read from 1 archive file\n")
        assert.include(answer.output, expected)
        assert.include(answer.output, "1 more of its archive file wasn't read")
        assert.notInclude(answer.output, "Nothing of this trace")
        if (contents.logs.length === 0) assert.notInclude(answer.output, "Logs:")
      }
      const empty = yield* run(["trace", "folio", traceId], () => Response.json(view))
      assert.strictEqual(empty.result._tag, "Success")
      assert.include(empty.output, "Nothing of this trace is in the archive.")
      const complete = yield* run(["trace", "folio", traceId], () => Response.json({ ...view, spans: [span] }))
      assert.strictEqual(complete.result._tag, "Success")
      assert.notInclude(complete.output, "wasn't read")
      assert.notInclude(complete.output, "weren't read")
    }),
  )

  it.effect("refuses invalid identifiers before HTTP, and explains missing projects, errors and archives", () =>
    Effect.gen(function* () {
      for (const args of [
        ["error", "folio", "bad-id"],
        ["logs", "folio", "--trace", "bad-id"],
        ["logs", "folio", "--error", "bad-id"],
        ["logs", "folio", "--message", "0"],
        ["logs", "folio", "--message", "1.5"],
        ["trace", "Not a key", traceId],
        ["trace", "folio", "bad-id"],
        ["trace", "folio", traceId, "--at", "yesterday"],
      ]) {
        const answer = yield* run(args, () => Response.json({}))
        assert.strictEqual(answer.result._tag, "Failure")
        assert.isEmpty(answer.requests)
        assert.include(answer.errors, "isn't")
      }
      for (const args of [
        ["errors", "folio"],
        ["error", "folio", errorId],
        ["logs", "folio"],
        ["log-messages", "folio"],
        ["trace", "folio", traceId],
      ]) {
        const answer = yield* run(args, () =>
          Response.json({ _tag: "ProjectNotFound", project: "folio" }, { status: 404 }),
        )
        assert.strictEqual(answer.result._tag, "Failure")
        assert.strictEqual(answer.requests.length, 1)
        assert.include(answer.errors, "https://cluenori.example has no project folio.")
        assert.strictEqual(answer.output, "")
      }
      const missing = yield* run(["error", "folio", errorId], () =>
        Response.json({ _tag: "ErrorGroupNotFound", error: errorId }, { status: 404 }),
      )
      assert.strictEqual(missing.result._tag, "Failure")
      assert.include(missing.errors, `folio has no error ${errorId} in this period.`)
      assert.include(missing.errors, "--last 7d")
      const unavailable = yield* run(["trace", "folio", traceId], () =>
        Response.json({ _tag: "ArchiveUnavailable", message: "Try later" }, { status: 503 }),
      )
      assert.strictEqual(unavailable.result._tag, "Failure")
      assert.include(unavailable.errors, "The archive can't be read right now: Try later")
    }),
  )
})
