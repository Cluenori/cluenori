import { BunCrypto } from "@effect/platform-bun"
import { assert, describe, it } from "@effect/vitest"
import { ConfigProvider, Console, Effect, FileSystem, Layer, Path, Stdio, Terminal } from "effect"
import { Command } from "effect/cli"
import { FetchHttpClient } from "effect/http"
import { ChildProcessSpawner } from "effect/process"

import { feature, person } from "../src/analytics-commands.ts"

const root = Command.make("cluenori").pipe(Command.withSubcommands([feature, person]))
const at = "2026-10-19T09:00:00.000Z"
const id = "01960000-0000-7000-8000-000000000001"
const empty = {
  feature: "notes.share",
  asOf: at,
  use: { days: [], people: 0, latestPeople: [], releases: [] },
  logs: { days: [], errors: [] },
  operations: [],
}

// Exercise the real parser, typed HTTP client, response schemas and terminal output. Only the
// external seams (saved settings, HTTP and terminal) are fake, as in the other command tests.
const run = Effect.fnUntraced(function* (args: ReadonlyArray<string>, answer: () => Response) {
  const requests: Array<Request> = []
  const output: Array<string> = []
  const errors: Array<string> = []
  const current = yield* Console.Console
  const result = yield* Command.runWith(root, { version: "test" })(args).pipe(
    Effect.result,
    Effect.provideService(
      Console.Console,
      Object.assign(Object.create(current), {
        log: (...values: ReadonlyArray<unknown>) => output.push(values.join(" ")),
        error: (...values: ReadonlyArray<unknown>) => errors.push(values.join(" ")),
      }),
    ),
    Effect.provideService(FetchHttpClient.Fetch, (input, init) => {
      requests.push(new Request(input, init))
      return Promise.resolve(answer())
    }),
    Effect.provide(
      Layer.mergeAll(
        BunCrypto.layer,
        ConfigProvider.layer(ConfigProvider.fromEnvRecord({ HOME: "/test-home", XDG_CONFIG_HOME: "/test-config" })),
        FileSystem.layerNoop({
          exists: (path) => Effect.succeed(path === "/test-config/cluenori/deployment.json"),
          readFileString: () =>
            Effect.succeed(
              JSON.stringify({ jurisdiction: "eu", url: "https://cluenori.example", token: "made-up-test-token" }),
            ),
        }),
        Path.layer,
        Stdio.layerTest({}),
        Layer.succeed(
          Terminal.Terminal,
          Terminal.make({
            columns: Effect.succeed(120),
            rows: Effect.succeed(40),
            readInput: Effect.die("Feature must not prompt"),
            readLine: Effect.die("Feature must not prompt"),
            display: () => Effect.void,
          }),
        ),
        Layer.succeed(
          ChildProcessSpawner.ChildProcessSpawner,
          ChildProcessSpawner.make(() => Effect.die("Feature must not start programs")),
        ),
      ),
    ),
  )
  return { result, requests, output: output.join("\n"), errors: errors.join("\n") }
})

describe("feature command", () => {
  it.effect("asks for the exact feature and optional environment without inventing missing app or service use", () =>
    Effect.gen(function* () {
      for (const environment of [undefined, "production"]) {
        const args = [
          "feature",
          "folio",
          "notes.share",
          ...(environment === undefined ? [] : ["--environment", environment]),
        ]
        const answer = yield* run(args, () => Response.json(empty))
        assert.strictEqual(answer.result._tag, "Success")
        assert.strictEqual(answer.requests.length, 1)
        const request = answer.requests[0]
        assert(request !== undefined)
        const url = new URL(request.url)
        assert.strictEqual(url.origin, "https://cluenori.example")
        assert.strictEqual(url.pathname, "/api/projects/folio/features/notes.share")
        assert.deepStrictEqual([...url.searchParams], environment === undefined ? [] : [["environment", environment]])
        assert.strictEqual(request.headers.get("authorization"), "Bearer made-up-test-token")
        assert.include(answer.output, "Feature notes.share of folio, as of 2026-10-19 09:00 UTC")
        assert.include(answer.output, "Apps: no app marked it")
        assert.include(answer.output, "Services: none named it")
        assert.notInclude(answer.output, "0 people")
        assert.notInclude(answer.output, "Operations that ran")
      }
    }),
  )

  it.effect("shows the latest fourteen app days, the full date range and identified or anonymous people", () =>
    Effect.gen(function* () {
      const days = Array.from({ length: 16 }, (_, index) => ({
        day: `2026-10-${String(index + 1).padStart(2, "0")}`,
        people: 2,
        events: 7,
        screens: 3,
      }))
      const answer = yield* run(["feature", "folio", "notes.share"], () =>
        Response.json({
          ...empty,
          use: {
            days,
            people: 17,
            releases: [],
            latestPeople: [
              { person: id, users: ["reader-one", "reader-two"], days: 4, events: 11, lastDay: "2026-10-16" },
              { person: "01960000-0000-7000-8000-000000000002", users: [], days: 1, events: 5, lastDay: "2026-10-15" },
            ],
          },
        }),
      )
      assert.strictEqual(answer.result._tag, "Success")
      assert.include(answer.output, "Apps: 17 people used it, from 2026-10-01 to 2026-10-16.")
      assert.match(answer.output, /Day\s+People\s+Events\s+Screens\n/)
      const appRows = answer.output.split("\n").filter((line) => line.startsWith("2026-10-"))
      assert.strictEqual(appRows.length, 14)
      assert.match(appRows[0] ?? "", /^2026-10-03\s+2\s+7\s+3$/)
      assert.match(appRows[13] ?? "", /^2026-10-16\s+2\s+7\s+3$/)
      assert.match(
        answer.output,
        /reader-one\s+4 days, 11 events\s+last on 2026-10-16\s+01960000-0000-7000-8000-000000000001/,
      )
      assert.include(answer.output, `${id}\n(no user ID)`)
      assert.match(answer.output, /\(no user ID\)\s+1 days, 5 events\s+last on 2026-10-15/)
      assert.notInclude(answer.output, "reader-two")
      assert.notInclude(answer.output, "Operations that ran")
    }),
  )

  it.effect("totals each component's operation across days and sorts by count, not failures or name", () =>
    Effect.gen(function* () {
      const operation = { day: "2026-10-17", component: "notes-api", operation: "GET /notes", count: 4, errors: 2 }
      const answer = yield* run(["feature", "folio", "notes.share"], () =>
        Response.json({
          ...empty,
          operations: [
            operation,
            { ...operation, component: "jobs", count: 6, errors: 4 },
            { ...operation, day: "2026-10-18", count: 9, errors: 1 },
            { ...operation, operation: "POST /notes", count: 10, errors: 0 },
          ],
        }),
      )
      assert.strictEqual(answer.result._tag, "Success")
      assert.match(answer.output, /Operation\s+Count\s+Failed\n/)
      const rows = answer.output.split("\n").filter((line) => /^(notes-api|jobs)\s/.test(line))
      assert.strictEqual(rows.length, 3)
      assert.match(rows[0] ?? "", /^notes-api\s+GET \/notes\s+13\s+3$/)
      assert.match(rows[1] ?? "", /^notes-api\s+POST \/notes\s+10\s+0$/)
      assert.match(rows[2] ?? "", /^jobs\s+GET \/notes\s+6\s+4$/)
      assert.include(answer.output, "Its warnings and errors each day, 90 days kept:\nNone.")
      assert.notInclude(answer.output, "Services: none")
      assert.notInclude(answer.output, "Its errors, the most frequent first")
    }),
  )

  it.effect("shows service logs even without operations, with distinct warnings, errors and links", () =>
    Effect.gen(function* () {
      const answer = yield* run(["feature", "folio", "notes.share"], () =>
        Response.json({
          ...empty,
          logs: {
            days: [
              { day: "2026-10-17", warnings: 2, errors: 1 },
              { day: "2026-10-18", warnings: 7, errors: 3 },
            ],
            errors: [
              {
                id: "123456789abcdef0",
                kind: "exception",
                title: "Share failed",
                culprit: "shareNotes",
                occurrences: 3,
                firstSeen: at,
                lastSeen: at,
                lastComponent: "notes-api",
              },
              {
                id: "223456789abcdef0",
                kind: "exception",
                title: "Upload failed",
                culprit: "uploadNotes",
                occurrences: 1,
                firstSeen: at,
                lastSeen: at,
                lastComponent: "notes-api",
              },
            ],
          },
        }),
      )
      assert.strictEqual(answer.result._tag, "Success")
      assert.match(answer.output, /Day\s+Warnings\s+Errors\n/)
      assert.match(answer.output, /2026-10-17\s+2\s+1\n2026-10-18\s+7\s+3/)
      assert.match(answer.output, /2026-10-18\s+7\s+3/)
      assert.match(answer.output, /Share failed\s+3\s+123456789abcdef0/)
      assert.match(answer.output, /123456789abcdef0\nUpload failed\s+1\s+223456789abcdef0/)
      assert.include(answer.output, "See one: ./cluenori error folio <ID> --last 90d")
      assert.notInclude(answer.output, "Services: none")
      assert.notInclude(answer.output, "90 days kept:\nNone.")
    }),
  )

  it.effect("rejects invalid arguments before HTTP and distinguishes unknown projects, features and bad answers", () =>
    Effect.gen(function* () {
      for (const args of [
        ["feature", "Not a key", "notes.share"],
        ["feature", "folio", "Not a feature"],
        ["feature", "folio", "notes.share", "--environment", "Production"],
      ]) {
        const answer = yield* run(args, () => Response.json(empty))
        assert.strictEqual(answer.result._tag, "Failure")
        assert.isEmpty(answer.requests)
        assert.include(answer.errors, "isn't")
      }
      for (const [body, status, message] of [
        [{ _tag: "ProjectNotFound", project: "folio" }, 404, "has no project folio"],
        [{ _tag: "FeatureNotFound", feature: "notes.share" }, 404, "Nothing kept in folio names notes.share"],
        [{ _tag: "Unauthorized", message: "Token expired" }, 401, "refused the API token: Token expired"],
        [{ use: "invalid" }, 200, "answered in a way this CLI doesn't expect"],
      ] as const) {
        const answer = yield* run(["feature", "folio", "notes.share"], () => Response.json(body, { status }))
        assert.strictEqual(answer.result._tag, "Failure")
        assert.strictEqual(answer.requests.length, 1)
        assert.include(answer.errors, message)
        assert.strictEqual(answer.output, "")
      }
    }),
  )
})

describe("person command", () => {
  const nobody = {
    person: id,
    users: [],
    firstSeen: "2026-10-17T08:10:00.000Z",
    lastSeen: at,
    installations: [],
    days: [],
    features: [],
    timeline: [],
  }

  it.effect("looks up person IDs and opaque user IDs without confusing UUID-shaped user IDs with person IDs", () =>
    Effect.gen(function* () {
      for (const user of [undefined, id, "reader+one?kind=guest&region=eu"]) {
        const args = user === undefined ? ["person", "folio", id] : ["person", "folio", user, "--user"]
        const answer = yield* run(args, () => Response.json(nobody))
        assert.strictEqual(answer.result._tag, "Success")
        assert.strictEqual(answer.requests.length, 1)
        const request = answer.requests[0]
        assert(request !== undefined)
        const url = new URL(request.url)
        assert.strictEqual(url.origin, "https://cluenori.example")
        assert.strictEqual(url.pathname, `/api/projects/folio/people${user === undefined ? `/${id}` : ""}`)
        assert.deepStrictEqual([...url.searchParams], user === undefined ? [] : [["user", user]])
        assert.strictEqual(request.headers.get("authorization"), "Bearer made-up-test-token")
        assert.include(answer.output, `Person ${id} of folio\n  user IDs: none`)
        assert.include(answer.output, "first seen 2026-10-17 08:10 UTC, last seen 2026-10-19 09:00 UTC")
        assert.include(answer.output, "Features they use, the last used first:\nNone marked.")
        assert.include(answer.output, "Timeline, newest first (0 of 0):")
        assert.notInclude(answer.output, "undefined")
      }
    }),
  )

  it.effect("shows linked users, feature totals, installations and each kind of timeline signal", () =>
    Effect.gen(function* () {
      const signal = { id, at, session: id }
      const signals = [
        { ...signal, _tag: "session.started" },
        { ...signal, _tag: "session.ended", foregroundMs: 12_600 },
        { ...signal, _tag: "app.launched", start: "warm", prewarmed: false, firstFrameMs: 237 },
        { ...signal, _tag: "screen", screen: "share.sheet", feature: "notes.share" },
        { ...signal, _tag: "event", name: "share.completed" },
        { id, at, _tag: "metrickit", report: "diagnostics", crashes: 2, hangs: 5 },
        { id, at, _tag: "metrickit", report: "metrics", crashes: 0, hangs: 0 },
      ]
      const installation = {
        installation: id,
        component: "notes-ios",
        environment: "beta",
        release: "1.4.0+58",
        device: { model: "iPhone17,2", platform: "iOS", osVersion: "27.2", locale: "en-US", timeZone: "UTC" },
        sdk: { name: "cluenori-swift", version: "0.1.0" },
        firstSeen: nobody.firstSeen,
        lastSeen: at,
      }
      const answer = yield* run(["person", "folio", id], () =>
        Response.json({
          ...nobody,
          users: ["reader-one", "reader-two"],
          features: [
            { feature: "notes.share", days: 2, events: 7, screens: 3, lastDay: "2026-10-19" },
            { days: 1, events: 4, screens: 8, lastDay: "2026-10-18" },
          ],
          installations: [
            installation,
            {
              ...installation,
              installation: "01960000-0000-7000-8000-000000000002",
              component: "notes-web",
              environment: "production",
              release: "2.1.0",
              device: { ...installation.device, model: "Chrome 141", platform: "web", osVersion: "Linux" },
              lastSeen: "2026-10-18T10:20:00.000Z",
            },
          ],
          timeline: signals.map((each, index) => ({
            component: "notes-ios",
            environment: "beta",
            release: `1.4.${index}`,
            installation: id,
            signal: each,
          })),
        }),
      )
      assert.strictEqual(answer.result._tag, "Success")
      assert.include(answer.output, "user IDs: reader-one, reader-two")
      assert.match(
        answer.output,
        /notes.share\s+2 days, 7 events, 3 screens\s+last on 2026-10-19\n\(no feature\)\s+1 days, 4 events, 8 screens\s+last on 2026-10-18/,
      )
      assert.match(
        answer.output,
        /notes-ios beta 1.4.0\+58\s+iPhone17,2, iOS 27.2\s+last seen 2026-10-19 09:00 UTC\nnotes-web production 2.1.0\s+Chrome 141, web Linux\s+last seen 2026-10-18 10:20 UTC/,
      )
      const timeline = answer.output.split("\n").filter((line) => line.startsWith("2026-10-19 09:00:00"))
      assert.deepStrictEqual(timeline, [
        "2026-10-19 09:00:00 UTC  1.4.0  Session started",
        "2026-10-19 09:00:00 UTC  1.4.1  Session ended, 13 s in the foreground",
        "2026-10-19 09:00:00 UTC  1.4.2  Launched warm, first frame 237 ms",
        "2026-10-19 09:00:00 UTC  1.4.3  Screen share.sheet  [notes.share]",
        "2026-10-19 09:00:00 UTC  1.4.4  share.completed",
        "2026-10-19 09:00:00 UTC  1.4.5  MetricKit diagnostics: 2 crashes, 5 hangs",
        "2026-10-19 09:00:00 UTC  1.4.6  MetricKit metrics",
      ])
      assert.include(answer.output, "Timeline, newest first (7 of 7):")
    }),
  )

  it.effect("keeps only the newest fourteen active days and fifty timeline entries without hiding their total", () =>
    Effect.gen(function* () {
      const days = Array.from({ length: 15 }, (_, index) => ({
        day: `2026-10-${String(19 - index).padStart(2, "0")}`,
        sessions: index + 2,
        foregroundMs: 1234,
      }))
      const timeline = Array.from({ length: 51 }, (_, index) => ({
        component: "notes-ios",
        environment: "beta",
        release: "1.4.0",
        installation: id,
        signal: { _tag: "event", id, at, session: id, name: `event.${index}` },
      }))
      const answer = yield* run(["person", "folio", id], () => Response.json({ ...nobody, days, timeline }))
      assert.strictEqual(answer.result._tag, "Success")
      const dayRows = answer.output.split("\n").filter((line) => /^2026-10-\d\d  \d+ sessions$/.test(line))
      assert.strictEqual(dayRows.length, 14)
      assert.strictEqual(dayRows[0], "2026-10-19  2 sessions")
      assert.strictEqual(dayRows[13], "2026-10-06  15 sessions")
      assert.include(answer.output, "Timeline, newest first (50 of 51):")
      const entries = answer.output.split("\n").filter((line) => line.startsWith("2026-10-19 09:00:00"))
      assert.strictEqual(entries.length, 50)
      assert.strictEqual(entries[0], "2026-10-19 09:00:00 UTC  1.4.0  event.0")
      assert.strictEqual(entries[49], "2026-10-19 09:00:00 UTC  1.4.0  event.49")
    }),
  )

  it.effect("rejects invalid identifiers and distinguishes missing people, missing projects and invalid answers", () =>
    Effect.gen(function* () {
      for (const args of [
        ["person", "Not a key", id],
        ["person", "folio", "reader-one"],
        ["person", "folio", "has spaces", "--user"],
      ]) {
        const answer = yield* run(args, () => Response.json(nobody))
        assert.strictEqual(answer.result._tag, "Failure")
        assert.isEmpty(answer.requests)
        assert.include(answer.errors, "isn't")
      }
      for (const user of [false, true]) {
        const who = user ? "reader-one" : id
        for (const [body, status, message] of [
          [{ _tag: "ProjectNotFound", project: "folio" }, 404, "has no project folio"],
          [{ _tag: "PersonNotFound" }, 404, `has the ${user ? "user ID" : "ID"} ${who}`],
          [{ _tag: "Unauthorized", message: "Token expired" }, 401, "refused the API token: Token expired"],
          [{ person: "invalid" }, 200, "answered in a way this CLI doesn't expect"],
        ] as const) {
          const args = ["person", "folio", who, ...(user ? ["--user"] : [])]
          const answer = yield* run(args, () => Response.json(body, { status }))
          assert.strictEqual(answer.result._tag, "Failure")
          assert.strictEqual(answer.requests.length, 1)
          assert.include(answer.errors, message)
          assert.strictEqual(answer.output, "")
        }
      }
    }),
  )
})
