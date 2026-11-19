import { BunCrypto } from "@effect/platform-bun"
import { assert, describe, it } from "@effect/vitest"
import { ConfigProvider, Console, Effect, FileSystem, Layer, Path, Stdio, Terminal } from "effect"
import { Command } from "effect/cli"
import { FetchHttpClient } from "effect/http"
import { ChildProcessSpawner } from "effect/process"

import { release } from "../src/releases-commands.ts"

const root = Command.make("cluenori").pipe(Command.withSubcommands([release]))
const args = ["release", "folio", "notes-api", "1.4.0+58"]
const from = "2026-10-17T08:00:00.000Z"
const to = "2026-10-17T10:40:00.000Z"
const detail = {
  summary: {
    component: "notes-api",
    release: "1.4.0+58",
    verdict: "unmeasured",
    slower: 0,
    failingMore: 0,
    newErrors: 0,
  },
  slower: [],
  failingMore: [],
  faster: [],
  failingLess: [],
  newOperations: [],
  errors: [],
  incidents: [],
  problems: [],
  promotions: [],
  deployTargets: [],
  notes: [],
}
const totals = { from, to, requests: 1200, failed: 30, warnings: 7, errors: 3, people: 19 }

// The real command parser, typed HTTP client and terminal output; only external seams are fake.
const run = Effect.fnUntraced(function* (command: ReadonlyArray<string>, answer: () => Response) {
  const requests: Array<Request> = []
  const output: Array<string> = []
  const errors: Array<string> = []
  const current = yield* Console.Console
  const result = yield* Command.runWith(root, { version: "test" })(command).pipe(
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
            readInput: Effect.die("Release detail must not prompt"),
            readLine: Effect.die("Release detail must not prompt"),
            display: () => Effect.void,
          }),
        ),
        Layer.succeed(
          ChildProcessSpawner.ChildProcessSpawner,
          ChildProcessSpawner.make(() => Effect.die("Release detail must not start programs")),
        ),
      ),
    ),
  )
  return { result, requests, output: output.join("\n"), errors: errors.join("\n") }
})

describe("release detail command", () => {
  it.effect("asks for the exact release and optional environment without inventing telemetry or a life", () =>
    Effect.gen(function* () {
      for (const environment of [undefined, "beta"]) {
        const answer = yield* run([...args, ...(environment === undefined ? [] : ["--environment", environment])], () =>
          Response.json(detail),
        )
        assert.strictEqual(answer.result._tag, "Success")
        assert.strictEqual(answer.errors, "")
        assert.strictEqual(answer.requests.length, 1)
        const request = answer.requests[0]
        assert(request !== undefined)
        const url = new URL(request.url)
        assert.strictEqual(request.method, "GET")
        assert.strictEqual(url.origin, "https://cluenori.example")
        assert.strictEqual(url.pathname, "/api/projects/folio/releases/notes-api/1.4.0%2B58")
        assert.deepStrictEqual([...url.searchParams], environment === undefined ? [] : [["environment", environment]])
        assert.strictEqual(request.headers.get("authorization"), "Bearer made-up-test-token")
        assert.include(answer.output, "1.4.0+58 of notes-api: no telemetry yet.")
        assert.include(answer.output, "No telemetry from it yet, so nothing to compare")
        assert.notInclude(answer.output, "Its life:")
        assert.notInclude(answer.output, "0 runs")
        assert.notInclude(answer.output, "Compared with")
      }
    }),
  )

  it.effect("compares whole-life totals independently of the summary and only lists steps with --life", () =>
    Effect.gen(function* () {
      for (const steps of [false, true]) {
        const answer = yield* run([...args, ...(steps ? ["--life"] : [])], () =>
          Response.json({
            ...detail,
            summary: {
              ...detail.summary,
              environment: "production",
              count: 200,
              errors: 4,
              verdict: "same",
              previous: "1.3.0",
            },
            life: {
              step: "1h",
              totals: { ...totals, logsFrom: "2026-10-17T09:00:00.000Z" },
              previous: {
                from: "2026-10-16T01:00:00.000Z",
                to: "2026-10-16T05:10:00.000Z",
                requests: 800,
                failed: 40,
                warnings: 2,
                errors: 9,
                people: 31,
              },
              points: [
                { start: from, requests: 1000, failed: 21, p95Ms: 125, warnings: 5, errors: 2, people: 17 },
                {
                  start: "2026-10-17T09:00:00.000Z",
                  requests: 0,
                  failed: 0,
                  p95Ms: 0,
                  warnings: 0,
                  errors: 0,
                  people: 0,
                },
                { start: "2026-10-17T10:00:00.000Z" },
              ],
            },
          }),
        )
        assert.strictEqual(answer.result._tag, "Success")
        assert.include(answer.output, "1.4.0+58 of notes-api in production: 200 runs, 2% failed.")
        assert.include(answer.output, "Compared with 1.3.0. About the same.")
        assert.include(
          answer.output,
          "Its life: 2026-10-17 08:00 UTC to 2026-10-17 10:40 UTC, 3 hours (1.3.0: 4 hours).",
        )
        assert.include(answer.output, "People   19 (1.3.0: 31)")
        assert.include(answer.output, "Requests 1,200 (1.3.0: 800)")
        assert.include(answer.output, "Failed   2.5% (1.3.0: 5%)")
        assert.include(answer.output, "Warnings 7 (1.3.0: 2)")
        assert.include(answer.output, "Errors   3 (1.3.0: 9)")
        assert.include(answer.output, "Warnings and errors from 2026-10-17 09:00 UTC: older ones aren't kept.")
        const rows = answer.output.split("\n").filter((line) => line.startsWith("2026-10-17"))
        assert.strictEqual(rows.length, steps ? 3 : 0)
        if (steps) {
          assert.match(answer.output, /Start\s+Requests\s+Failed\s+p95\s+Warnings\s+Errors\s+People/)
          assert.match(rows[0] ?? "", /^2026-10-17 08:00 UTC\s+1,000\s+21\s+125ms\s+5\s+2\s+17$/)
          assert.match(rows[1] ?? "", /^2026-10-17 09:00 UTC\s+0\s+0\s+0.00ms\s+0\s+0\s+0$/)
          assert.match(rows[2] ?? "", /^2026-10-17 10:00 UTC\s+unknown\s+unknown\s+unknown\s+unknown$/)
        }
      }
    }),
  )

  it.effect("keeps missing totals and missing previous measurements absent, not zero", () =>
    Effect.gen(function* () {
      for (const [current, before, expected] of [
        [{ from, to }, totals, ["Its life: 2026-10-17 08:00 UTC to 2026-10-17 10:40 UTC, 3 hours (before: 3 hours)."]],
        [
          { ...totals, requests: 0, failed: 0, people: 0, warnings: 0, errors: 0 },
          { from, to },
          [
            "Its life: 2026-10-17 08:00 UTC to 2026-10-17 10:40 UTC, 3 hours (before: 3 hours).",
            "People 0",
            "Requests 0",
            "Failed 0%",
            "Warnings 0",
            "Errors 0",
          ],
        ],
        [
          { ...totals, failed: undefined, errors: undefined },
          { ...totals, requests: undefined, people: undefined },
          [
            "Its life: 2026-10-17 08:00 UTC to 2026-10-17 10:40 UTC, 3 hours (before: 3 hours).",
            "People 19",
            "Requests 1,200",
            "Failed",
          ],
        ],
        [
          { ...totals, warnings: undefined },
          undefined,
          [
            "Its life: 2026-10-17 08:00 UTC to 2026-10-17 10:40 UTC, 3 hours.",
            "People 19",
            "Requests 1,200",
            "Failed 2.5%",
          ],
        ],
      ] as const) {
        const answer = yield* run(args, () =>
          Response.json({ ...detail, life: { step: "5m", totals: current, previous: before, points: [] } }),
        )
        assert.strictEqual(answer.result._tag, "Success")
        const life = answer.output.slice(answer.output.indexOf("Its life:"))
        // Compare the measurements present, not the spacing that aligns them in a terminal.
        assert.deepStrictEqual(
          life.split("\n").map((line) => line.trim().replace(/ +/g, " ")),
          [...expected],
        )
      }
    }),
  )

  it.effect("shows UTC day steps and clamps a short life to one hour without inventing a previous life", () =>
    Effect.gen(function* () {
      const answer = yield* run([...args, "--life"], () =>
        Response.json({
          ...detail,
          life: {
            step: "1d",
            totals: { from, to: "2026-10-17T08:10:00.000Z", people: 5 },
            points: [{ start: from, people: 5 }],
          },
        }),
      )
      assert.strictEqual(answer.result._tag, "Success")
      assert.include(answer.output, "08:10 UTC, 1 hours.")
      assert.include(answer.output, "People   5")
      assert.notInclude(answer.output, "(before:")
      assert.match(answer.output, /Day\s+Requests\s+Failed\s+p95\s+Warnings\s+Errors\s+People/)
      assert.match(answer.output, /\n2026-10-17\s+unknown\s+unknown\s+unknown\s+unknown\s+5$/)
    }),
  )

  it.effect("refuses invalid identifiers before HTTP and reports missing releases and invalid answers", () =>
    Effect.gen(function* () {
      for (const command of [
        ["release", "Not a key", "notes-api", "1.4.0"],
        ["release", "folio", "Not a key", "1.4.0"],
        ["release", "folio", "notes-api", "has spaces"],
        [...args, "--environment", "Not a key"],
      ]) {
        const answer = yield* run(command, () => Response.json(detail))
        assert.strictEqual(answer.result._tag, "Failure")
        assert.isEmpty(answer.requests)
        assert.include(answer.errors, "isn't")
      }
      for (const [body, status, message] of [
        [{ _tag: "ProjectNotFound", project: "folio" }, 404, "has no project folio"],
        [
          { _tag: "ReleaseNotFound", component: "notes-api", release: "1.4.0+58" },
          404,
          "has no release 1.4.0+58 of notes-api in beta",
        ],
        [{ summary: "invalid" }, 200, "answered in a way this CLI doesn't expect"],
      ] as const) {
        const answer = yield* run([...args, "--environment", "beta"], () => Response.json(body, { status }))
        assert.strictEqual(answer.result._tag, "Failure")
        assert.strictEqual(answer.requests.length, 1)
        assert.include(answer.errors, message)
        assert.strictEqual(answer.output, "")
      }
    }),
  )
})
