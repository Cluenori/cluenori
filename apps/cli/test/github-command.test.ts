import { BunCrypto } from "@effect/platform-bun"
import { assert, describe, it } from "@effect/vitest"
import { ConfigProvider, Console, Effect, FileSystem, Layer, Path, Stdio, Terminal } from "effect"
import { Command } from "effect/cli"
import { FetchHttpClient } from "effect/http"
import { ChildProcessSpawner } from "effect/process"

import { github } from "../src/sources-commands.ts"

const root = Command.make("cluenori").pipe(Command.withSubcommands([github]))
const app = {
  name: "Folio Releases",
  slug: "folio-releases",
  url: "https://github.com/apps/folio-releases",
  installUrl: "https://github.com/apps/folio-releases/installations/new",
  connectedAt: "2026-10-19T09:00:00.000Z",
}

// The real parser, typed client and response schemas; only external seams are fake.
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
            readInput: Effect.die("GitHub status must not prompt"),
            readLine: Effect.die("GitHub status must not prompt"),
            display: () => Effect.void,
          }),
        ),
        Layer.succeed(
          ChildProcessSpawner.ChildProcessSpawner,
          ChildProcessSpawner.make(() => Effect.die("GitHub status must not start programs")),
        ),
      ),
    ),
  )
  return { result, requests, output: output.join("\n"), errors: errors.join("\n") }
})

describe("github command", () => {
  it.effect("reads connection status from the chosen deployment without starting a connection", () =>
    Effect.gen(function* () {
      for (const local of [false, true]) {
        const origin = local ? "http://localhost:8787" : "https://cluenori.example"
        const answer = yield* run(["github", ...(local ? ["--local"] : [])], () => Response.json({ installations: [] }))
        assert.strictEqual(answer.result._tag, "Success")
        assert.strictEqual(answer.errors, "")
        assert.strictEqual(answer.requests.length, 1)
        const request = answer.requests[0]
        assert(request !== undefined)
        assert.strictEqual(request.method, "GET")
        assert.strictEqual(request.url, `${origin}/api/github`)
        assert.strictEqual(
          request.headers.get("authorization"),
          `Bearer ${local ? "made-up-local-token" : "made-up-token"}`,
        )
        assert.include(answer.output, `${origin} isn't connected to GitHub.`)
        assert.include(answer.output, `${origin}/github`)
        assert.notInclude(answer.output, "Connected to GitHub as")
        assert.notInclude(answer.output, "Installed on")
      }
    }),
  )

  it.effect("distinguishes an uninstalled app from an installation lookup failure", () =>
    Effect.gen(function* () {
      for (const problem of [undefined, "GitHub rate limit reached"]) {
        const answer = yield* run(["github"], () => Response.json({ app, installations: [], problem }))
        assert.strictEqual(answer.result._tag, "Success")
        assert.include(answer.output, `Connected to GitHub as ${app.name}: ${app.url}`)
        assert.notInclude(answer.output, "Installed on")
        if (problem === undefined) {
          assert.include(answer.output, `It isn't installed anywhere yet.`)
          assert.include(answer.output, app.installUrl)
          assert.notInclude(answer.output, "couldn't be read")
        } else {
          assert.include(answer.output, `Its installations couldn't be read: ${problem}.`)
          assert.notInclude(answer.output, "isn't installed anywhere")
          assert.notInclude(answer.output, app.installUrl)
        }
      }
    }),
  )

  it.effect("shows each account's kind and repository access independently", () =>
    Effect.gen(function* () {
      const answer = yield* run(["github"], () =>
        Response.json({
          app,
          installations: [
            { account: "folio-team", accountType: "Organization", repositories: "selected" },
            { account: "folio-reader", accountType: "User", repositories: "all" },
            { account: "folio-labs", accountType: "Organization", repositories: "all" },
            { account: "folio-writer", accountType: "User", repositories: "selected" },
          ],
        }),
      )
      assert.strictEqual(answer.result._tag, "Success")
      assert.include(answer.output, `Connected to GitHub as ${app.name}: ${app.url}`)
      assert.match(answer.output, /Installed on\s+Kind\s+Repositories\n/)
      const rows = answer.output.split("\n").filter((line) => line.startsWith("folio-"))
      assert.deepStrictEqual(
        rows.map((row) => row.trim().replace(/ +/g, " ")),
        [
          "folio-team organization chosen ones",
          "folio-reader user all",
          "folio-labs organization all",
          "folio-writer user chosen ones",
        ],
      )
      assert.include(answer.output, `Install it on another account: ${app.installUrl}`)
      assert.notInclude(answer.output, "isn't installed anywhere")
      assert.notInclude(answer.output, "couldn't be read")
    }),
  )

  it.effect("reports owner-only access, refused tokens and malformed answers without claiming a connection", () =>
    Effect.gen(function* () {
      for (const [body, status, message] of [
        [{ _tag: "NotAllowed" }, 403, "Only an owner sees how the deployment is connected to GitHub."],
        [{ _tag: "Unauthorized", message: "Token expired" }, 401, "refused the API token: Token expired"],
        [{ app, installations: "invalid" }, 200, "answered in a way this CLI doesn't expect"],
      ] as const) {
        const answer = yield* run(["github"], () => Response.json(body, { status }))
        assert.strictEqual(answer.result._tag, "Failure")
        assert.strictEqual(answer.requests.length, 1)
        assert.include(answer.errors, message)
        assert.strictEqual(answer.output, "")
      }
    }),
  )
})
