import { BunCrypto } from "@effect/platform-bun"
import { assert, describe, it } from "@effect/vitest"
import { ConfigProvider, Console, Effect, FileSystem, Layer, Path, Stdio, Terminal } from "effect"
import { Command } from "effect/cli"
import { FetchHttpClient } from "effect/http"
import { ChildProcessSpawner } from "effect/process"

import { watcher } from "../src/watcher-commands.ts"

const root = Command.make("cluenori").pipe(Command.withSubcommands([watcher]))
const at = "2026-10-19T09:00:00.000Z"
const repository = "notesapp/outside-watch"

// The real command parser, typed client and response schemas; only external seams are fake.
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
          exists: (path) =>
            Effect.succeed(path === "/test-config/cluenori/deployment.json" || path === "apps/worker/.dev.vars"),
          readFileString: (path) =>
            Effect.succeed(
              path === "apps/worker/.dev.vars"
                ? "CLUENORI_API_TOKEN=made-up-local-token\nCLUENORI_OWNER=01960000-0000-7000-8000-000000000001\nCLUENORI_PLAIN_HTTP=local\n"
                : JSON.stringify({ jurisdiction: "eu", url: "https://cluenori.example", token: "made-up-token" }),
            ),
        }),
        Path.layer,
        Stdio.layerTest({}),
        Layer.succeed(
          Terminal.Terminal,
          Terminal.make({
            columns: Effect.succeed(120),
            rows: Effect.succeed(40),
            readInput: Effect.die("Watcher commands must not prompt"),
            readLine: Effect.die("Watcher commands must not prompt"),
            display: () => Effect.void,
          }),
        ),
        Layer.succeed(
          ChildProcessSpawner.ChildProcessSpawner,
          ChildProcessSpawner.make(() => Effect.die("Watcher commands must not start programs")),
        ),
      ),
    ),
  )
  return { result, requests, output: output.join("\n"), errors: errors.join("\n") }
})

describe("watcher commands", () => {
  it.effect("shows the repository and problems, and reports phone counts only with a write time", () =>
    Effect.gen(function* () {
      const named = `The outside watcher runs in ${repository}.`
      const cases = [
        [{}, "No outside watcher yet. Name its repository: ./cluenori watcher set <owner/name>"],
        [{ repository }, named],
        [{ repository, phones: 2 }, named],
        [{ repository, writtenAt: at }, named],
        [
          { repository, phones: 0, writtenAt: at },
          `${named}\nIts secrets hold 0 owners' phones, written 2026-10-19 09:00 UTC.`,
        ],
        [
          { repository, phones: 1, writtenAt: at },
          `${named}\nIts secrets hold 1 owner's phone, written 2026-10-19 09:00 UTC.`,
        ],
        [
          { repository, phones: 3, writtenAt: at, problem: "GitHub refused the write" },
          `${named}\nIts secrets hold 3 owners' phones, written 2026-10-19 09:00 UTC.\nProblem: GitHub refused the write`,
        ],
        [{ repository, problem: "Push is not configured" }, `${named}\nProblem: Push is not configured`],
      ] as const
      for (const command of [
        ["watcher", "status"],
        ["watcher", "set", repository],
      ]) {
        for (const [status, expected] of cases) {
          const answer = yield* run(command, () => Response.json(status))
          assert.strictEqual(answer.result._tag, "Success")
          assert.strictEqual(answer.output, expected)
          assert.strictEqual(answer.errors, "")
        }
      }
    }),
  )

  it.effect("gets status and sends the trimmed repository to the selected deployment, displaying its answer", () =>
    Effect.gen(function* () {
      for (const local of [false, true]) {
        for (const set of [false, true]) {
          const args = ["watcher", ...(set ? ["set", `  ${repository}  `] : ["status"]), ...(local ? ["--local"] : [])]
          const answer = yield* run(args, () => Response.json({ repository: "notesapp/confirmed-watch" }))
          assert.strictEqual(answer.result._tag, "Success")
          assert.strictEqual(answer.requests.length, 1)
          const request = answer.requests[0]
          assert(request !== undefined)
          assert.strictEqual(request.url, `${local ? "http://localhost:8787" : "https://cluenori.example"}/api/watcher`)
          assert.strictEqual(request.method, set ? "PUT" : "GET")
          assert.strictEqual(request.headers.get("authorization"), `Bearer made-up-${local ? "local-token" : "token"}`)
          const body = yield* Effect.promise(() => request.text())
          assert.strictEqual(body, set ? '{"repository":"notesapp/outside-watch"}' : "")
          assert.strictEqual(answer.output, "The outside watcher runs in notesapp/confirmed-watch.")
          assert.strictEqual(answer.errors, "")
        }
      }
    }),
  )

  it.effect("rejects invalid repositories before HTTP and explains refusals without reporting success", () =>
    Effect.gen(function* () {
      for (const invalid of ["not-a-repository", "owner/name/extra", "   "]) {
        const answer = yield* run(["watcher", "set", invalid], () => Response.json({ repository }))
        assert.strictEqual(answer.result._tag, "Failure")
        assert.isEmpty(answer.requests)
        assert.include(answer.errors, "isn't a repository, owner/name")
        assert.strictEqual(answer.output, "")
      }
      for (const set of [false, true]) {
        const args = ["watcher", ...(set ? ["set", repository] : ["status"])]
        for (const [body, status, expected] of [
          [{ _tag: "NotAllowed" }, 403, `Only an owner ${set ? "names" : "sees"} the watcher.`],
          [{ _tag: "Unauthorized", message: "Token expired" }, 401, "refused the API token: Token expired"],
          [{ repository, writtenAt: "not-a-time" }, 200, "answered in a way this CLI doesn't expect"],
        ] as const) {
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
