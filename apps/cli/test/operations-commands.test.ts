import { BunCrypto } from "@effect/platform-bun"
import { assert, describe, it } from "@effect/vitest"
import { ConfigProvider, Console, DateTime, Effect, FileSystem, Layer, Path, Stdio, Terminal } from "effect"
import { Command } from "effect/cli"
import { FetchHttpClient } from "effect/http"
import { ChildProcessSpawner } from "effect/process"

import { load, operation, operations } from "../src/operations-commands.ts"

const root = Command.make("cluenori").pipe(Command.withSubcommands([operations, operation, load]))
const deployment = { jurisdiction: "eu", url: "https://cluenori.example", token: "made-up-test-token" }
const covered = { from: "2026-10-19T08:00:00.000Z", to: "2026-10-19T09:00:00.000Z" }
const row = {
  component: "notes-api",
  environment: "production",
  operation: "GET /notes",
  count: 8,
  errors: 1,
  averageMs: 4.2,
  p50Ms: 1.1,
  p80Ms: 5.3,
  p95Ms: 12,
  p99Ms: 1500,
}
const table = { covered, rows: [row], count: 8, errors: 1, dataUntil: covered.to }
const empty = { rows: [], count: 0, errors: 0 }

// Only the external seams are fake: saved settings, the terminal, and HTTP. Arguments run through
// the real command parser, API client, response schemas, and terminal presentation.
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
  return { result, requests, output: output.join("\n"), errors: errors.join("\n") }
})

describe("operation commands", () => {
  it.effect("sends the selected project, period and filters and prints each distinct statistic", () =>
    Effect.gen(function* () {
      const answer = yield* run(
        ["operations", "folio", "--last", "6h", "--environment", "production", "--component", "notes-api"],
        () => Response.json(table),
      )
      assert.strictEqual(answer.result._tag, "Success")
      assert.strictEqual(answer.requests.length, 1)
      const request = answer.requests[0]
      assert(request !== undefined)
      const url = new URL(request.url)
      assert.strictEqual(url.origin, deployment.url)
      assert.strictEqual(url.pathname, "/api/projects/folio/operations")
      assert.strictEqual(request.headers.get("authorization"), "Bearer made-up-test-token")
      assert.strictEqual(url.searchParams.get("environment"), "production")
      assert.strictEqual(url.searchParams.get("component"), "notes-api")
      const from = DateTime.makeUnsafe(url.searchParams.get("from") ?? "")
      const to = DateTime.makeUnsafe(url.searchParams.get("to") ?? "")
      assert.strictEqual(DateTime.toEpochMillis(to) - DateTime.toEpochMillis(from), 21_600_000)
      assert.include(answer.output, "folio on https://cluenori.example, 2026-10-19 08:00 UTC to 2026-10-19 09:00 UTC")
      assert.match(answer.output, /GET \/notes\s+production\s+8\s+12.5%\s+4.2ms\s+1.1ms\s+5.3ms\s+12ms\s+1.5s/)
      assert.notInclude(answer.output, "Component")
      assert.include(answer.output, "8 counted, 12.5% failed, data until 2026-10-19 09:00 UTC.")
    }),
  )

  it.effect("distinguishes components and unknown environments, but not missing data from zero", () =>
    Effect.gen(function* () {
      const { environment: _, ...unknown } = row
      const many = yield* run(["operations", "folio"], () =>
        Response.json({ ...table, count: 16, errors: 2, rows: [row, { ...unknown, component: "jobs" }] }),
      )
      assert.strictEqual(many.result._tag, "Success")
      assert.include(many.output, "Component")
      assert.match(many.output, /GET \/notes\s+jobs\s+unknown/)
      const missing = yield* run(["operations", "folio"], () => Response.json(empty))
      assert.strictEqual(missing.result._tag, "Success")
      assert.include(missing.output, "no part of the period is kept (counts are kept 15 months)")
      assert.include(missing.output, "Nothing from folio in this period.")
      assert.notInclude(missing.output, "0 counted")
      const retained = yield* run(["operations", "folio"], () => Response.json({ ...empty, covered }))
      assert.strictEqual(retained.result._tag, "Success")
      assert.include(retained.output, "2026-10-19 08:00 UTC to 2026-10-19 09:00 UTC")
      assert.notInclude(retained.output, "no part of the period is kept")
      assert.notInclude(retained.output, "0 counted")
      const { dataUntil: _latest, ...withoutLatest } = table
      const unknownLatest = yield* run(["operations", "folio"], () => Response.json(withoutLatest))
      assert.strictEqual(unknownLatest.result._tag, "Success")
      assert.include(unknownLatest.output, "8 counted, 12.5% failed.")
      assert.notInclude(unknownLatest.output, "data until")
    }),
  )

  it.effect("shows one operation's counts and traces, preserving status and the link to open", () =>
    Effect.gen(function* () {
      const trace = {
        component: "notes-api",
        operation: "GET /notes",
        start: covered.from,
        durationMs: 250,
        failed: false,
        trace: "123456789abcdef0123456789abcdef0",
      }
      const failedTrace = { ...trace, failed: true, trace: "223456789abcdef0123456789abcdef0" }
      const answer = yield* run(["operation", "folio", "GET /notes"], (request) =>
        Response.json(
          new URL(request.url).pathname.endsWith("/operations")
            ? { ...table, count: 9, rows: [row, { ...row, component: "jobs", count: 1, errors: 0 }] }
            : {
                covered,
                slowest: [
                  { ...trace, status: 204 },
                  { ...trace, trace: "323456789abcdef0123456789abcdef0" },
                ],
                failed: [failedTrace],
              },
        ),
      )
      assert.strictEqual(answer.result._tag, "Success")
      assert.deepStrictEqual(answer.requests.map((request) => new URL(request.url).pathname).toSorted(), [
        "/api/projects/folio/kept-traces",
        "/api/projects/folio/operations",
      ])
      for (const request of answer.requests) {
        assert.strictEqual(new URL(request.url).searchParams.get("operation"), "GET /notes")
      }
      assert.include(answer.output, "GET /notes  notes-api  production")
      assert.include(answer.output, "Ran 8 times, 12.5% failed; avg 4.2ms, p50 1.1ms, p95 12ms, p99 1.5s")
      assert.include(answer.output, "Ran once, 0% failed")
      assert.include(answer.output, "Slowest traces since 2026-10-19 08:00 UTC, slowest first")
      assert.match(answer.output, /2026-10-19 08:00:00 UTC\s+250ms\s+204\s+unknown\s+123456789abcdef0123456789abcdef0/)
      assert.match(answer.output, /250ms\s+failed\s+unknown\s+223456789abcdef0123456789abcdef0/)
      assert.match(answer.output, /250ms\s+unknown\s+323456789abcdef0123456789abcdef0/)
      assert.include(answer.output, "Failed traces since 2026-10-19 08:00 UTC, newest first")
      assert.include(answer.output, "./cluenori trace folio 223456789abcdef0123456789abcdef0")
      const noTraces = yield* run(["operation", "folio", "GET /notes"], (request) =>
        Response.json(new URL(request.url).pathname.endsWith("/operations") ? table : { slowest: [], failed: [] }),
      )
      assert.strictEqual(noTraces.result._tag, "Success")
      assert.include(noTraces.output, "None is kept.")
      assert.include(noTraces.output, "None failed.")
      assert.notInclude(noTraces.output, "Open one")
    }),
  )

  it.effect("distinguishes an operation never seen from one last seen outside the period", () =>
    Effect.gen(function* () {
      for (const lastSeen of [undefined, covered.from]) {
        const answer = yield* run(["operation", "folio", "GET /notes"], (request) =>
          Response.json(
            new URL(request.url).pathname.endsWith("/operations")
              ? { ...empty, ...(lastSeen === undefined ? {} : { lastSeen }) }
              : { slowest: [], failed: [] },
          ),
        )
        assert.strictEqual(answer.result._tag, "Success")
        assert.include(answer.output, "GET /notes didn't run in this period.")
        if (lastSeen === undefined) {
          assert.include(answer.output, "Its name must match exactly")
          assert.notInclude(answer.output, "It last ran")
        } else {
          assert.include(answer.output, "It last ran until 2026-10-19 08:00 UTC, in any environment")
        }
        assert.notInclude(answer.output, "Slowest traces")
      }
    }),
  )

  it.effect("uses the period's default load step, accepts an override, and explains a coarser answer", () =>
    Effect.gen(function* () {
      const cases = [
        ["1h", "5m", 3_600_000],
        ["6h", "1h", 21_600_000],
        ["24h", "1h", 86_400_000],
        ["7d", "1d", 604_800_000],
        ["14d", "1d", 1_209_600_000],
        ["30d", "1d", 2_592_000_000],
        ["90d", "1d", 7_776_000_000],
      ] as const
      for (const [last, step, duration] of cases) {
        const answer = yield* run(["load", "folio", "--last", last], () => Response.json({ covered, step, points: [] }))
        assert.strictEqual(answer.result._tag, "Success")
        const url = new URL(answer.requests[0]?.url ?? "")
        assert.strictEqual(url.pathname, "/api/projects/folio/load")
        assert.strictEqual(url.searchParams.get("step"), step)
        assert.isFalse(url.searchParams.has("environment"))
        assert.isFalse(url.searchParams.has("component"))
        assert.strictEqual(
          DateTime.toEpochMillis(DateTime.makeUnsafe(url.searchParams.get("to") ?? "")) -
            DateTime.toEpochMillis(DateTime.makeUnsafe(url.searchParams.get("from") ?? "")),
          duration,
        )
        assert.include(answer.output, "Nothing from folio in this period.")
      }
      const answer = yield* run(["load", "folio", "--step", "1m"], () =>
        Response.json({ covered, step: "1h", points: [{ ...row, start: covered.from }] }),
      )
      assert.strictEqual(answer.result._tag, "Success")
      assert.strictEqual(new URL(answer.requests[0]?.url ?? "").searchParams.get("step"), "1m")
      assert.include(answer.output, "Past two days the load is counted by the hour, so each line is 1h.")
      assert.match(answer.output, /2026-10-19 08:00 UTC\s+8\s+12.5%/)
      assert.include(answer.output, "A step that isn't listed had nothing reported.")
      const unchanged = yield* run(
        ["load", "folio", "--step", "5m", "--environment", "production", "--component", "notes-api"],
        () => Response.json({ covered, step: "5m", points: [{ ...row, start: covered.from }] }),
      )
      assert.strictEqual(unchanged.result._tag, "Success")
      const url = new URL(unchanged.requests[0]?.url ?? "")
      assert.strictEqual(url.searchParams.get("step"), "5m")
      assert.strictEqual(url.searchParams.get("environment"), "production")
      assert.strictEqual(url.searchParams.get("component"), "notes-api")
      assert.match(unchanged.output, /2026-10-19 08:00 UTC\s+8\s+12.5%/)
      assert.notInclude(unchanged.output, "Past two days")
    }),
  )

  it.effect("refuses invalid keys before sending, and reports refused tokens and invalid responses", () =>
    Effect.gen(function* () {
      for (const args of [
        ["operations", "Not a key"],
        ["operations", "folio", "--environment", "Production"],
        ["operations", "folio", "--component", "NOTES"],
      ]) {
        const refused = yield* run(args, () => Response.json(table))
        assert.strictEqual(refused.result._tag, "Failure")
        assert.isEmpty(refused.requests)
        assert.include(refused.errors, "isn't")
      }
      const unauthorized = yield* run(["operations", "folio"], () =>
        Response.json({ _tag: "Unauthorized", message: "Token expired" }, { status: 401 }),
      )
      assert.strictEqual(unauthorized.result._tag, "Failure")
      assert.include(unauthorized.errors, "refused the API token: Token expired")
      const invalid = yield* run(["operations", "folio"], () => Response.json({ rows: "not a table" }))
      assert.strictEqual(invalid.result._tag, "Failure")
      assert.include(invalid.errors, "answered in a way this CLI doesn't expect")
      for (const args of [
        ["operations", "folio"],
        ["operation", "folio", "GET /notes"],
        ["load", "folio"],
      ]) {
        const missing = yield* run(args, () =>
          Response.json({ _tag: "ProjectNotFound", project: "folio" }, { status: 404 }),
        )
        assert.strictEqual(missing.result._tag, "Failure")
        assert.strictEqual(missing.requests.length, 1)
        assert.include(missing.errors, "https://cluenori.example has no project folio.")
        assert.strictEqual(missing.output, "")
      }
    }),
  )
})
