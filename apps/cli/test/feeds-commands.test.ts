import { BunCrypto } from "@effect/platform-bun"
import { assert, describe, it } from "@effect/vitest"
import { ConfigProvider, Console, Effect, FileSystem, Layer, Path, Stdio, Terminal } from "effect"
import { Command } from "effect/cli"
import { FetchHttpClient } from "effect/http"
import { ChildProcessSpawner } from "effect/process"

import { feed, feeds } from "../src/feeds-commands.ts"

const root = Command.make("cluenori").pipe(Command.withSubcommands([feeds, feed]))
const deployment = { jurisdiction: "eu", url: "https://cluenori.example", token: "made-up-test-token" }
const id = "01960000-0000-7000-8000-000000000001"
const at = "2026-10-19T08:15:37.000Z"
const summary = {
  feed: {
    id,
    name: "Registrations",
    level: "quiet",
    sources: [
      { project: "folio", event: "user.registered" },
      { project: "notes", event: "account.created" },
    ],
  },
  lastDay: 1234,
  lastWeek: 5678,
  byProject: [],
}
const entry = {
  id: 27,
  project: "folio",
  event: "user.registered",
  at,
  component: "folio-web",
  environment: "production",
  release: "1.4.0",
}

// Exercise the parser, typed API client and output; replace only external seams.
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

describe("feed commands", () => {
  it.effect("lists sources, unequal daily and weekly counts, newest entries and every alert level", () =>
    Effect.gen(function* () {
      const answer = yield* run(["feeds"], () =>
        Response.json({
          feeds: [
            { ...summary, latest: at },
            { ...summary, feed: { ...summary.feed, name: "Purchases", level: "none" }, lastDay: 0, lastWeek: 3 },
            { ...summary, feed: { ...summary.feed, name: "Exports", level: "timeSensitive" }, latest: at },
          ],
        }),
      )
      assert.strictEqual(answer.result._tag, "Success")
      assert.strictEqual(answer.requests.length, 1)
      const request = answer.requests[0]
      assert(request !== undefined)
      assert.strictEqual(request.url, "https://cluenori.example/api/feeds")
      assert.strictEqual(request.method, "GET")
      assert.strictEqual(request.headers.get("authorization"), "Bearer made-up-test-token")
      assert.match(answer.output, /Registrations\s+1,234\s+5,678\s+2026-10-19 08:15 UTC\s+quiet alerts/)
      assert.match(answer.output, /Purchases\s+0\s+3\s+none yet\s+no alerts/)
      assert.match(answer.output, /Exports\s+1,234\s+5,678\s+2026-10-19 08:15 UTC\s+time-sensitive alerts/)
      assert.include(answer.output, `folio user.registered, notes account.created  ${id}`)
      assert.include(answer.output, "./cluenori feed <ID>")
      const empty = yield* run(["feeds"], () => Response.json({ feeds: [] }))
      assert.strictEqual(empty.result._tag, "Success")
      assert.include(empty.output, "https://cluenori.example has no feeds you see.")
      assert.notInclude(empty.output, "./cluenori feed <ID>")
    }),
  )

  it.effect("prints identified and anonymous entries, preserving a zero pagination cursor", () =>
    Effect.gen(function* () {
      const answer = yield* run(["feed", id, "--before", "28"], () =>
        Response.json({
          summary,
          entries: [
            { ...entry, user: "person-42", country: "PL" },
            { ...entry, id: 26, project: "notes", event: "account.created", component: "notes-ios", release: "2.3.1" },
          ],
          next: 0,
        }),
      )
      assert.strictEqual(answer.result._tag, "Success")
      assert.strictEqual(answer.requests.length, 1)
      const url = new URL(answer.requests[0]?.url ?? "")
      assert.strictEqual(url.pathname, `/api/feeds/${id}`)
      assert.strictEqual(url.search, "?before=28")
      assert.include(
        answer.output,
        "Registrations on https://cluenori.example: 1,234 in 24 hours, 5,678 in 7 days, from production. Watches folio user.registered, notes account.created.",
      )
      assert.match(
        answer.output,
        /2026-10-19 08:15:37 UTC\s+folio\s+user.registered\s+person-42\s+PL\s+folio-web 1.4.0/,
      )
      assert.match(answer.output, /2026-10-19 08:15:37 UTC\s+notes\s+account.created\s+not signed in\s+notes-ios 2.3.1/)
      assert.include(answer.output, "Older ones: add --before 0")
      assert.notInclude(answer.output, "undefined")
      const last = yield* run(["feed", id], () => Response.json({ summary, entries: [entry] }))
      assert.strictEqual(last.result._tag, "Success")
      assert.strictEqual(new URL(last.requests[0]?.url ?? "").search, "")
      assert.isTrue(last.output.endsWith("folio-web 1.4.0"))
      assert.notInclude(last.output, "Older ones")
      const empty = yield* run(["feed", id], () => Response.json({ summary, entries: [] }))
      assert.strictEqual(empty.result._tag, "Success")
      assert.include(empty.output, "No entries yet, or none older.")
      assert.notInclude(empty.output, "When")
    }),
  )

  it.effect("routes both queries locally when requested and refuses invalid IDs and inaccessible feeds", () =>
    Effect.gen(function* () {
      for (const command of [["feeds"], ["feed", id]]) {
        const local = yield* run([...command, "--local"], () =>
          Response.json(command[0] === "feeds" ? { feeds: [] } : { summary, entries: [] }),
        )
        assert.strictEqual(local.result._tag, "Success")
        assert.strictEqual(local.requests.length, 1)
        const request = local.requests[0]
        assert(request !== undefined)
        assert.strictEqual(new URL(request.url).origin, "http://localhost:8787")
        assert.strictEqual(request.headers.get("authorization"), "Bearer made-up-local-token")
        assert.include(local.output, "http://localhost:8787")
        const refused = yield* run(command, () =>
          Response.json({ _tag: "Unauthorized", message: "Sign in again" }, { status: 401 }),
        )
        assert.strictEqual(refused.result._tag, "Failure")
        assert.include(refused.errors, "https://cluenori.example refused the API token: Sign in again")
        assert.strictEqual(refused.output, "")
      }
      for (const args of [
        ["feed", "bad-id"],
        ["feed", id, "--before", "1.5"],
      ]) {
        const invalid = yield* run(args, () => Response.json({}))
        assert.strictEqual(invalid.result._tag, "Failure")
        assert.isEmpty(invalid.requests)
      }
      const missing = yield* run(["feed", id], () => Response.json({ _tag: "FeedNotFound", feed: id }, { status: 404 }))
      assert.strictEqual(missing.result._tag, "Failure")
      assert.include(missing.errors, `https://cluenori.example has no feed ${id} you see. See them: ./cluenori feeds`)
      assert.strictEqual(missing.output, "")
    }),
  )
})
