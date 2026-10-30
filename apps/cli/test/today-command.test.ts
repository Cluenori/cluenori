import { BunCrypto } from "@effect/platform-bun"
import { assert, describe, it } from "@effect/vitest"
import { ConfigProvider, Console, Effect, FileSystem, Layer, Path, Stdio, Terminal } from "effect"
import { Command } from "effect/cli"
import { FetchHttpClient } from "effect/http"
import { ChildProcessSpawner } from "effect/process"

import { today } from "../src/today-command.ts"

const root = Command.make("cluenori").pipe(Command.withSubcommands([today]))
const at = "2026-10-19T09:00:00.000Z"
const startedAt = "2026-10-19T08:00:00.000Z"
const id = "01960000-0000-7000-8000-000000000001"
const deployment = { jurisdiction: "eu", url: "https://cluenori.example", token: "made-up-test-token" }
const empty = { at, items: [], projects: [], unanswered: [] }
const project = { key: "folio", name: "Folio Notes", createdAt: startedAt }
const error = {
  id: "123456789abcdef0",
  kind: "exception",
  title: "Export failed",
  culprit: "exportNotes",
  occurrences: 7,
  firstSeen: startedAt,
  lastSeen: at,
  lastComponent: "notes-api",
}
const incident = {
  id,
  component: "notes-api",
  subject: "GET /notes",
  title: "Notes failing",
  evidence: { _tag: "failing", operation: "GET /notes", failed: 7, count: 20, usualRate: 0.01 },
  openedAt: startedAt,
}
const promotion = {
  _tag: "promotion",
  project: "folio",
  component: "notes-api",
  environment: "production",
  release: "1.4.0",
  promotion: id,
  startedAt,
}
const usage = { day: "2026-10-18", people: 1, installations: 2, sessions: 3, foregroundMs: 4_000 }

// The real command parser and typed API client; only settings, HTTP and the terminal are fake.
const run = Effect.fnUntraced(function* (answer: (request: Request) => Response) {
  const requests: Array<Request> = []
  const output: Array<string> = []
  const stderr: Array<string> = []
  const current = yield* Console.Console
  const result = yield* Command.runWith(root, { version: "test" })(["today"]).pipe(
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
            readInput: Effect.die("Today must not prompt"),
            readLine: Effect.die("Today must not prompt"),
            display: () => Effect.void,
          }),
        ),
        Layer.succeed(
          ChildProcessSpawner.ChildProcessSpawner,
          ChildProcessSpawner.make(() => Effect.die("Today must not start programs")),
        ),
      ),
    ),
  )
  return { result, requests, output: output.join("\n"), errors: stderr.join("\n") }
})

describe("today command", () => {
  it.effect("asks the deployment once and distinguishes nothing to do from projects that did not answer", () =>
    Effect.gen(function* () {
      for (const pulses of [undefined, []]) {
        const answer = yield* run(() => Response.json({ ...empty, ...(pulses === undefined ? {} : { pulses }) }))
        assert.strictEqual(answer.result._tag, "Success")
        assert.strictEqual(answer.requests.length, 1)
        const request = answer.requests[0]
        assert(request !== undefined)
        assert.strictEqual(request.url, "https://cluenori.example/api/today")
        assert.strictEqual(request.headers.get("authorization"), "Bearer made-up-test-token")
        assert.strictEqual(
          answer.output,
          "Nothing needs you on https://cluenori.example, looked at 2026-10-19 09:00 UTC.",
        )
      }
      const missing = yield* run(() => Response.json({ ...empty, unanswered: ["folio", "tasks"] }))
      assert.strictEqual(missing.result._tag, "Success")
      assert.include(missing.output, "These projects didn't answer, so what they would show is missing: folio, tasks.")
      assert.notInclude(missing.output, "How each project is going")
    }),
  )

  it.effect("shows each attention item's evidence, preserving API order and resolving project names", () =>
    Effect.gen(function* () {
      const cases = [
        [{ _tag: "incident", project: "folio", incident }, "Incident", "Notes failing, since 2026-10-19 08:00 UTC"],
        [
          { _tag: "incident", project: "folio", incident: { ...incident, acknowledgedAt: at } },
          "Incident, acknowledged",
          "Notes failing",
        ],
        [
          { _tag: "error", project: "folio", error, isNew: true, ongoing: true },
          "New error, now",
          "Export failed, 7 in the last day",
        ],
        [{ _tag: "error", project: "folio", error, isNew: false, ongoing: true }, "Error, now", "Export failed"],
        [{ _tag: "error", project: "folio", error, isNew: true, ongoing: false }, "New error", "Export failed"],
        [
          {
            _tag: "slower",
            project: "folio",
            component: "notes-api",
            operation: "GET /notes",
            p95Ms: 1500,
            usualP95Ms: 12,
          },
          "Slower",
          "GET /notes: p95 1.5s over the last day, usually 12ms",
        ],
        [
          {
            _tag: "quiet",
            project: "folio",
            component: "notes-api",
            operation: "cleanup.run",
            usualGapMs: 1800000,
            lastRanAt: startedAt,
          },
          "Quiet, a guess",
          "cleanup.run: usually runs about every 30 minutes, none since 2026-10-19 08:00 UTC; maybe fine",
        ],
        [
          {
            _tag: "keyExpiring",
            project: "folio",
            key: { id, component: "notes-api", name: "Deploy", createdAt: startedAt, expiresAt: at },
          },
          "Key expires",
          'notes-api\'s ingest key "Deploy" expires at 2026-10-19 09:00 UTC; add a key and deploy it before then',
        ],
        [
          { _tag: "silent", project: "folio", lastDataAt: startedAt },
          "No data",
          "nothing in the last day; last at 2026-10-19 08:00 UTC",
        ],
        [{ _tag: "silent", project: "tasks" }, "No data", "nothing in the last 8 days"],
      ] as const
      const answer = yield* run(() =>
        Response.json({ ...empty, projects: [project], items: cases.map(([item]) => item) }),
      )
      assert.strictEqual(answer.result._tag, "Success")
      assert.include(answer.output, "10 things need you on https://cluenori.example, looked at 2026-10-19 09:00 UTC:")
      const rows = answer.output.split("\n").slice(2)
      assert.strictEqual(rows.length, cases.length)
      for (const [index, [item, kind, evidence]] of cases.entries()) {
        const row = rows[index]
        assert(row !== undefined)
        assert.isTrue(row.startsWith(`${kind}  `), row)
        assert.include(row, item.project === "folio" ? "Folio Notes" : "tasks")
        assert.include(row, evidence)
      }
      const one = yield* run(() => Response.json({ ...empty, items: [cases[9][0]] }))
      assert.strictEqual(one.result._tag, "Success")
      assert.include(one.output, "1 thing needs you")
      assert.notInclude(one.output, "things need")
    }),
  )

  it.effect("distinguishes waiting and failed promotions and prefers their end time when known", () =>
    Effect.gen(function* () {
      const cases = [
        ["approved", "Release waits", "approved in App Store review, to release in production"],
        ["waiting", "Release waits", "waiting on GitHub for someone to approve production"],
        ["failed", "Release failed", "failed to reach production at"],
        ["rejected", "Release failed", "rejected in App Store review for production at"],
        ["lost", "Release failed", "lost on its way to production at"],
      ] as const
      for (const [state, label, explanation] of cases) {
        for (const endedAt of [undefined, at]) {
          const answer = yield* run(() =>
            Response.json({
              ...empty,
              items: [{ ...promotion, state, ...(endedAt === undefined ? {} : { endedAt }) }],
            }),
          )
          assert.strictEqual(answer.result._tag, "Success")
          assert.include(answer.output, `${label}  folio  1.4.0 of notes-api, ${explanation}`)
          if (label === "Release failed") {
            assert.include(answer.output, endedAt === undefined ? "2026-10-19 08:00 UTC" : "2026-10-19 09:00 UTC")
          }
          if (state === "lost") assert.include(answer.output, "GitHub or App Store Connect has the rest")
        }
      }
    }),
  )

  it.effect("sums production load without inventing missing usage or a previous week's count", () =>
    Effect.gen(function* () {
      const answer = yield* run(() =>
        Response.json({
          ...empty,
          projects: [project],
          pulses: [
            {
              project: "folio",
              load: [
                { start: startedAt, count: 13, errors: 2 },
                { start: at, count: 8, errors: 3 },
              ],
              people: { latest: usage, weekBefore: { ...usage, day: "2026-10-11", people: 9 } },
            },
            { project: "tasks", load: [] },
            { project: "photos", load: [], people: { latest: { ...usage, people: 2345 } } },
          ],
        }),
      )
      assert.strictEqual(answer.result._tag, "Success")
      assert.include(answer.output, "How each project is going, in production:")
      assert.include(
        answer.output,
        "Folio Notes  21 operations in the last 24 hours, 5 failed; 1 person on 2026-10-18, 9 a week before",
      )
      assert.match(answer.output, /tasks\s+nothing reported in the last 24 hours\n/)
      assert.match(answer.output, /photos\s+nothing reported in the last 24 hours; 2,345 people on 2026-10-18$/)
      assert.notInclude(answer.output, "0 a week before")
      assert.notInclude(answer.output, "0 operations")
    }),
  )

  it.effect("reports rejected tokens and malformed answers instead of claiming nothing needs attention", () =>
    Effect.gen(function* () {
      for (const [response, explanation] of [
        [
          Response.json({ _tag: "Unauthorized", message: "Token expired" }, { status: 401 }),
          "refused the API token: Token expired",
        ],
        [Response.json({ ...empty, items: "not a list" }), "answered in a way this CLI doesn't expect"],
      ] as const) {
        const answer = yield* run(() => response)
        assert.strictEqual(answer.result._tag, "Failure")
        assert.strictEqual(answer.requests.length, 1)
        assert.strictEqual(answer.output, "")
        assert.include(answer.errors, explanation)
        assert.notInclude(answer.errors, deployment.token)
      }
    }),
  )
})
