import { BunCrypto } from "@effect/platform-bun"
import { assert, describe, it } from "@effect/vitest"
import { ConfigProvider, Console, Effect, FileSystem, Layer, Path, Stdio, Terminal } from "effect"
import { Command } from "effect/cli"
import { FetchHttpClient } from "effect/http"
import { ChildProcessSpawner } from "effect/process"

import { incident, incidents, monitor, monitors } from "../src/incidents-commands.ts"

const root = Command.make("cluenori").pipe(Command.withSubcommands([incidents, incident, monitors, monitor]))
const deployment = { jurisdiction: "eu", url: "https://cluenori.example", token: "made-up-test-token" }
const id = "01960000-0000-7000-8000-000000000001"
const otherId = "01960000-0000-7000-8000-000000000002"
const monitorId = "01960000-0000-7000-8000-000000000003"
const openedAt = "2026-10-19T08:00:00.000Z"
const at = "2026-10-19T09:00:00.000Z"
const found = {
  id,
  component: "notes-api",
  subject: "POST /notes",
  title: "Notes failing",
  evidence: { _tag: "failing", operation: "POST /notes", failed: 7, count: 20, usualRate: 0.01 },
  openedAt,
}
const empty = { open: [], resolved: [], quiet: [] }

// The real parser, typed API client and presentation, with only the external seams replaced.
const run = Effect.fnUntraced(function* (args: ReadonlyArray<string>, answer: (request: Request) => Response) {
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
      const request = new Request(input, init)
      requests.push(request)
      return Promise.resolve(answer(request))
    }),
    Effect.provide(
      Layer.mergeAll(
        BunCrypto.layer,
        ConfigProvider.layer(ConfigProvider.fromEnvRecord({ HOME: "/test-home", XDG_CONFIG_HOME: "/test-config" })),
        FileSystem.layerNoop({
          exists: (path) =>
            Effect.succeed(path === "/test-config/cluenori/deployment.json" || path === "apps/worker/.dev.vars"),
          readFileString: (path) =>
            Effect.succeed(
              path === "apps/worker/.dev.vars"
                ? `CLUENORI_API_TOKEN=made-up-local-token\nCLUENORI_OWNER=${id}\nCLUENORI_PLAIN_HTTP=local\n`
                : JSON.stringify(deployment),
            ),
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
  return { result, requests, output: output.join("\n"), errors: errors.join("\n") }
})

describe("monitor queries", () => {
  const watched = {
    id: monitorId,
    component: "notes-api",
    condition: { _tag: "noAnswer", subject: { _tag: "url", url: "https://notes.example/health" } },
    level: "alarm",
    addedAt: openedAt,
  }
  const state = { monitor: watched, days: [], firing: false }
  const detail = { state, recent: [], failures: [], incidents: [] }

  it.effect("lists conditions, environments and alert levels without confusing unchecked, passed and firing", () =>
    Effect.gen(function* () {
      const cases = [
        [
          watched,
          {},
          "notes-api",
          "https://notes.example/health: doesn't answer two checks in a row",
          "alarm",
          "not looked at yet",
        ],
        [
          watched,
          { lastCheck: { at } },
          "notes-api",
          "https://notes.example/health: doesn't answer two checks in a row",
          "alarm",
          "passed",
        ],
        [
          watched,
          { lastCheck: { at, problem: "HTTP 503" } },
          "notes-api",
          "https://notes.example/health: doesn't answer two checks in a row",
          "alarm",
          "HTTP 503",
        ],
        [
          {
            ...watched,
            environment: "staging",
            condition: { _tag: "nothingFor", subject: { _tag: "operation", operation: "cleanup.run" }, minutes: 30 },
            level: "quiet",
          },
          { measured: { at, value: 0 } },
          "notes-api (staging)",
          "cleanup.run: nothing for 30 minutes",
          "quiet",
          "fine",
        ],
        [
          {
            ...watched,
            condition: { _tag: "moreThan", subject: { _tag: "event", event: "exported" }, count: 17, minutes: 60 },
            level: "timeSensitive",
          },
          { measured: { at, value: 23 }, firing: true },
          "notes-api",
          "event exported: more than 17 in 1 hour",
          "time sensitive",
          "firing",
        ],
        [
          {
            ...watched,
            condition: {
              _tag: "moreThan",
              subject: { _tag: "error", error: "123456789abcdef0" },
              count: 3,
              minutes: 15,
            },
          },
          {},
          "notes-api",
          "error 123456789abcdef0: more than 3 in 15 minutes",
          "alarm",
          "not looked at yet",
        ],
        [
          {
            ...watched,
            condition: { _tag: "moreThan", subject: { _tag: "message", message: 42 }, count: 5, minutes: 15 },
          },
          {},
          "notes-api",
          "log message 42: more than 5 in 15 minutes",
          "alarm",
          "not looked at yet",
        ],
        [
          {
            ...watched,
            condition: {
              _tag: "latencyAbove",
              subject: { _tag: "operation", operation: "POST /notes" },
              percentile: 95,
              ms: 1500,
              minutes: 15,
            },
          },
          {},
          "notes-api",
          "POST /notes: p95 above 1.5s over 15 minutes",
          "alarm",
          "not looked at yet",
        ],
        [
          {
            ...watched,
            condition: {
              _tag: "errorRateAbove",
              subject: { _tag: "operation", operation: "POST /notes" },
              percent: 12.5,
              minutes: 15,
            },
          },
          {},
          "notes-api",
          "POST /notes: more than 12.5% failed over 15 minutes",
          "alarm",
          "not looked at yet",
        ],
      ] as const
      const answer = yield* run(["monitors", "folio"], () =>
        Response.json({
          monitors: cases.map(([watchedMonitor, status]) => ({ ...state, monitor: watchedMonitor, ...status })),
        }),
      )
      assert.strictEqual(answer.result._tag, "Success")
      assert.strictEqual(answer.requests.length, 1)
      assert.strictEqual(answer.requests[0]?.url, "https://cluenori.example/api/projects/folio/monitors")
      assert.strictEqual(answer.requests[0]?.method, "GET")
      assert.strictEqual(answer.requests[0]?.headers.get("authorization"), "Bearer made-up-test-token")
      assert.deepStrictEqual(
        answer.output
          .split("\n")
          .slice(1)
          .map((row) => row.replace(/ {2,}/g, " | ")),
        cases.map(([, , where, condition, level, now]) => `${where} | ${condition} | ${level} | ${now} | ${monitorId}`),
      )
      const none = yield* run(["monitors", "folio"], () => Response.json({ monitors: [] }))
      assert.strictEqual(none.result._tag, "Success")
      assert.include(none.output, "folio has no monitors.")
      assert.include(none.output, "./cluenori monitor add folio <component> --url <url>")
    }),
  )

  it.effect("keeps absent URL check data unknown and totals unequal days and failures for uptime", () =>
    Effect.gen(function* () {
      const cases = [
        [{}, "Not checked yet."],
        [{ lastCheck: { at } }, "Up; last checked 2026-10-19 09:00 UTC."],
        [
          { lastCheck: { at, ms: 0 }, since: openedAt },
          "Up since 2026-10-19 08:00 UTC; last checked 2026-10-19 09:00 UTC, answered in 0.00ms.",
        ],
        [
          { lastCheck: { at, problem: "HTTP 503", ms: 1250 }, since: openedAt },
          "Down: HTTP 503 since 2026-10-19 08:00 UTC; last checked 2026-10-19 09:00 UTC, answered in 1.3s.",
        ],
      ] as const
      for (const [status, expected] of cases) {
        const answer = yield* run(["monitor", "show", "folio", monitorId, "--local"], () =>
          Response.json({
            ...detail,
            state: { ...state, ...status },
          }),
        )
        assert.strictEqual(answer.result._tag, "Success")
        assert.strictEqual(answer.requests.length, 1)
        assert.strictEqual(answer.requests[0]?.url, `http://localhost:8787/api/projects/folio/monitors/${monitorId}`)
        assert.strictEqual(answer.requests[0]?.headers.get("authorization"), "Bearer made-up-local-token")
        assert.strictEqual(
          answer.output,
          `https://notes.example/health: doesn't answer two checks in a row, of notes-api; alerts alarm; looked at every minute since 2026-10-19 08:00 UTC.\n${expected}`,
        )
      }
      const answer = yield* run(["monitor", "show", "folio", monitorId], () =>
        Response.json({
          ...detail,
          state: {
            ...state,
            days: [
              { day: "2026-10-18", checks: 7, failed: 2, averageMs: 0 },
              { day: "2026-10-19", checks: 13, failed: 1 },
            ],
          },
          failures: [
            { at, problem: "HTTP 503" },
            { at: openedAt, problem: "Timed out" },
          ],
          incidents: [
            { ...found, resolvedAt: at },
            { ...found, id: otherId },
          ],
        }),
      )
      assert.strictEqual(answer.result._tag, "Success")
      assert.include(answer.output, "Up 85% of 20 checks over its last 2 days with checks:")
      assert.match(answer.output, /2026-10-18 +7 +2 +0\.00ms\n2026-10-19 +13 +1\n/)
      assert.match(answer.output, /2026-10-19 09:00 UTC +HTTP 503\n2026-10-19 08:00 UTC +Timed out/)
      assert.match(
        answer.output,
        new RegExp(
          `2026-10-19 08:00 UTC +resolved 2026-10-19 09:00 UTC +${id}\\n2026-10-19 08:00 UTC +open +${otherId}$`,
        ),
      )
    }),
  )

  it.effect("distinguishes no measurement, too few runs, zero runs and measured latency or error rate", () =>
    Effect.gen(function* () {
      const operation = { _tag: "operation", operation: "POST /notes" }
      const cases = [
        [{ _tag: "nothingFor", subject: operation, minutes: 30 }, {}, "Not looked at yet."],
        [
          { _tag: "latencyAbove", subject: operation, percentile: 99, ms: 1500, minutes: 15 },
          { measured: { at } },
          "Fine: too few runs to judge, at 2026-10-19 09:00 UTC.",
        ],
        [
          { _tag: "latencyAbove", subject: operation, percentile: 50, ms: 80, minutes: 15 },
          { measured: { at, value: 120 }, firing: true },
          "Firing: p50 120ms, at 2026-10-19 09:00 UTC.",
        ],
        [
          { _tag: "errorRateAbove", subject: operation, percent: 12.5, minutes: 15 },
          { measured: { at, value: 17.25 }, firing: true },
          "Firing: 17.3% failed, at 2026-10-19 09:00 UTC.",
        ],
        [
          { _tag: "nothingFor", subject: operation, minutes: 30 },
          { measured: { at, value: 0 } },
          "Fine: 0 in its window, at 2026-10-19 09:00 UTC.",
        ],
        [
          { _tag: "moreThan", subject: { _tag: "event", event: "exported" }, count: 4, minutes: 15 },
          { measured: { at, value: 7 }, firing: true },
          "Firing: 7 in its window, at 2026-10-19 09:00 UTC.",
        ],
      ] as const
      for (const [condition, status, expected] of cases) {
        const answer = yield* run(["monitor", "show", "folio", monitorId], () =>
          Response.json({
            ...detail,
            state: { ...state, monitor: { ...watched, condition, environment: "staging", level: "quiet" }, ...status },
          }),
        )
        assert.strictEqual(answer.result._tag, "Success")
        assert.include(answer.output, "of notes-api (staging); alerts quiet;")
        assert.strictEqual(answer.output.split("\n")[1], expected)
        assert.strictEqual(answer.output.split("\n").length, 2)
      }
    }),
  )

  it.effect("rejects invalid monitor identifiers before HTTP and reports missing or malformed answers", () =>
    Effect.gen(function* () {
      for (const args of [
        ["monitors", "Not a key"],
        ["monitor", "show", "Not a key", monitorId],
        ["monitor", "show", "folio", "bad-id"],
      ]) {
        const answer = yield* run(args, () => Response.json(detail))
        assert.strictEqual(answer.result._tag, "Failure")
        assert.isEmpty(answer.requests)
        assert.include(answer.errors, "isn't")
        assert.strictEqual(answer.output, "")
      }
      for (const args of [
        ["monitors", "folio"],
        ["monitor", "show", "folio", monitorId],
      ]) {
        const failures = [
          [{ _tag: "ProjectNotFound", project: "folio" }, 404, "https://cluenori.example has no project folio."],
          [{ _tag: "Unauthorized", message: "Token expired" }, 401, "refused the API token: Token expired"],
          [{ state: "not a monitor" }, 200, "answered in a way this CLI doesn't expect"],
          ...(args[0] === "monitor"
            ? [
                [
                  { _tag: "MonitorNotFound", monitor: monitorId },
                  404,
                  `folio has no monitor ${monitorId}. See them: ./cluenori monitors folio`,
                ] as const,
              ]
            : []),
        ] as const
        for (const [body, status, expected] of failures) {
          const answer = yield* run(args, () => Response.json(body, { status }))
          assert.strictEqual(answer.result._tag, "Failure")
          assert.strictEqual(answer.requests.length, 1)
          assert.include(answer.errors, expected)
          assert.strictEqual(answer.output, "")
        }
      }
    }),
  )
})

describe("incident commands", () => {
  it.effect("distinguishes detectors not yet run from no incidents, and selects the local deployment", () =>
    Effect.gen(function* () {
      for (const checkedAt of [undefined, at]) {
        const answer = yield* run(["incidents", "folio"], () =>
          Response.json({ ...empty, ...(checkedAt === undefined ? {} : { checkedAt }) }),
        )
        assert.strictEqual(answer.result._tag, "Success")
        assert.strictEqual(answer.requests.length, 1)
        assert.strictEqual(answer.requests[0]?.url, "https://cluenori.example/api/projects/folio/incidents")
        assert.strictEqual(answer.requests[0]?.method, "GET")
        assert.strictEqual(answer.requests[0]?.headers.get("authorization"), "Bearer made-up-test-token")
        assert.include(answer.output, "folio on https://cluenori.example:")
        assert.include(
          answer.output,
          checkedAt === undefined
            ? "the detectors haven't looked yet"
            : "the detectors last looked at 2026-10-19 09:00 UTC",
        )
        assert.include(answer.output, "\nNo open incidents.")
        assert.notInclude(answer.output, "Acknowledge one")
        assert.notInclude(answer.output, "Resolved in the last")
        assert.notInclude(answer.output, "Quiet, a guess")
      }
      for (const args of [
        ["incidents", "folio"],
        ["incident", "folio", id],
      ]) {
        const answer = yield* run([...args, "--local"], () =>
          Response.json(args[0] === "incidents" ? empty : { incident: found, updates: [], releases: [] }),
        )
        assert.strictEqual(answer.result._tag, "Success")
        assert.strictEqual(answer.requests.length, 1)
        assert.strictEqual(
          answer.requests[0]?.url,
          `http://localhost:8787/api/projects/folio/incidents${args[0] === "incidents" ? "" : `/${id}`}`,
        )
        assert.strictEqual(answer.requests[0]?.headers.get("authorization"), "Bearer made-up-local-token")
      }
    }),
  )

  it.effect("keeps incident states and order and suggests correctly quoted, rounded monitor windows", () =>
    Effect.gen(function* () {
      const answer = yield* run(["incidents", "folio"], () =>
        Response.json({
          checkedAt: at,
          open: [{ ...found, id: otherId, title: "Export failing", openedAt: at, acknowledgedAt: at }, found],
          resolved: [
            { ...found, title: "Recovered", resolvedAt: at },
            { ...found, id: otherId, title: "Earlier recovery", resolvedAt: "2026-10-19T08:30:00.000Z" },
          ],
          quiet: [
            {
              component: "jobs",
              operation: "clean'up's",
              usualGapMs: 90_001,
              lastRanAt: openedAt,
              environment: "staging",
            },
            { component: "notes-api", operation: "tick", usualGapMs: 0, lastRanAt: at },
          ],
        }),
      )
      assert.strictEqual(answer.result._tag, "Success")
      assert.match(answer.output, new RegExp(`2026-10-19 08:00 UTC +Notes failing +${id}\\n`))
      assert.match(answer.output, new RegExp(`2026-10-19 09:00 UTC +Export failing \\(acknowledged\\) +${otherId}\\n`))
      assert.isBelow(answer.output.indexOf("Export failing"), answer.output.indexOf("Notes failing"))
      assert.include(answer.output, "./cluenori acknowledge folio <ID>")
      assert.include(answer.output, "Resolved in the last 7 days, the latest first:")
      assert.match(answer.output, /2026-10-19 08:00 UTC +2026-10-19 09:00 UTC +Recovered\n/)
      assert.match(answer.output, /2026-10-19 08:00 UTC +2026-10-19 08:30 UTC +Earlier recovery\n/)
      assert.isBelow(answer.output.indexOf("Recovered"), answer.output.indexOf("Earlier recovery"))
      assert.include(answer.output, "Quiet, a guess")
      assert.include(answer.output, "Maybe fine; nothing was alerted.")
      assert.include(
        answer.output,
        "clean'up's, of jobs: usually about every 1 minute, none since 2026-10-19 08:00 UTC.",
      )
      assert.include(answer.output, "--operation 'clean'\\''up'\\''s' --nothing-for 4m --environment staging\n")
      assert.isTrue(
        answer.output.endsWith("./cluenori monitor add folio notes-api --operation 'tick' --nothing-for 1m"),
      )
      assert.notInclude(answer.output, "No open incidents")
    }),
  )

  it.effect("links every evidence kind to its subject and shows releases and the incident's whole life", () =>
    Effect.gen(function* () {
      const cases = [
        [
          { _tag: "down", monitor: monitorId, url: "https://notes.example/health", failures: 2, problem: "HTTP 503" },
          false,
        ],
        [
          {
            _tag: "monitor",
            monitor: monitorId,
            condition: { _tag: "moreThan", subject: { _tag: "event", event: "exported" }, count: 3, minutes: 15 },
            value: 4,
            name: "Exports",
          },
          true,
        ],
        [{ _tag: "failing", operation: "clean'up's", failed: 7, count: 20, usualRate: 0.01 }, true],
        [{ _tag: "stopped", operation: "cleanup.run", lastRanAt: openedAt, usualGapMs: 60_000 }, false],
      ] as const
      for (const [evidence, resolved] of cases) {
        const answer = yield* run(["incident", "folio", id], () =>
          Response.json({
            incident: { ...found, evidence, ...(resolved ? { environment: "staging", resolvedAt: at } : {}) },
            releases: resolved ? [{ release: "1.2.3", environment: "staging" }, { release: "2.3.4" }] : [],
            updates: [
              { change: "opened", at: openedAt, title: "First failure" },
              { change: "acknowledged", at: "2026-10-19T08:10:00.000Z" },
              { change: "worsened", at: "2026-10-19T08:20:00.000Z", title: "More failures" },
              { change: "resolved", at: "2026-10-19T08:30:00.000Z" },
              { change: "reopened", at, title: "Failed again" },
            ],
          }),
        )
        assert.strictEqual(answer.result._tag, "Success")
        assert.strictEqual(answer.requests.length, 1)
        assert.strictEqual(answer.requests[0]?.url, `https://cluenori.example/api/projects/folio/incidents/${id}`)
        assert.strictEqual(answer.requests[0]?.method, "GET")
        assert.strictEqual(answer.requests[0]?.headers.get("authorization"), "Bearer made-up-test-token")
        assert.include(
          answer.output,
          resolved ? "Notes failing\nResolved, in notes-api (staging)." : "Notes failing\nOpen, in notes-api.",
        )
        if (evidence._tag === "down" || evidence._tag === "monitor") {
          assert.include(answer.output, `About monitor ${monitorId}: ./cluenori monitor show folio ${monitorId}`)
          assert.notInclude(answer.output, "About operation")
        } else {
          assert.include(
            answer.output,
            evidence._tag === "failing"
              ? "About operation clean'up's: ./cluenori operation folio 'clean'\\''up'\\''s' --component notes-api --environment staging"
              : "About operation cleanup.run: ./cluenori operation folio 'cleanup.run' --component notes-api\n",
          )
          assert.notInclude(answer.output, "About monitor")
        }
        assert.include(
          answer.output,
          resolved
            ? "Running when it opened: 1.2.3 in staging, 2.3.4."
            : "No release of it ran in the hour before it opened.",
        )
        const rows = answer.output
          .split("\n")
          .slice(-5)
          .map((row) => row.trim().replace(/ +/g, " "))
        assert.deepStrictEqual(rows, [
          "2026-10-19 08:00 UTC Opened First failure",
          "2026-10-19 08:10 UTC Acknowledged",
          "2026-10-19 08:20 UTC Got worse More failures",
          "2026-10-19 08:30 UTC Resolved",
          "2026-10-19 09:00 UTC Reopened Failed again",
        ])
      }
    }),
  )

  it.effect(
    "rejects invalid identifiers without HTTP and reports missing incidents, projects and invalid answers",
    () =>
      Effect.gen(function* () {
        for (const args of [
          ["incidents", "Not a key"],
          ["incident", "Not a key", id],
          ["incident", "folio", "bad-id"],
        ]) {
          const answer = yield* run(args, () => Response.json(empty))
          assert.strictEqual(answer.result._tag, "Failure")
          assert.isEmpty(answer.requests)
          assert.include(answer.errors, "isn't")
          assert.strictEqual(answer.output, "")
        }
        for (const args of [
          ["incidents", "folio"],
          ["incident", "folio", id],
        ]) {
          const failures = [
            [{ _tag: "ProjectNotFound", project: "folio" }, 404, "https://cluenori.example has no project folio."],
            [{ _tag: "Unauthorized", message: "Token expired" }, 401, "refused the API token: Token expired"],
            [{ open: "not a list" }, 200, "answered in a way this CLI doesn't expect"],
            ...(args[0] === "incident"
              ? [
                  [
                    { _tag: "IncidentNotFound", incident: id },
                    404,
                    `folio has no incident ${id}. See them: ./cluenori incidents folio`,
                  ] as const,
                ]
              : []),
          ] as const
          for (const [body, status, message] of failures) {
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
