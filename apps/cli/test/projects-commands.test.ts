import { BunCrypto } from "@effect/platform-bun"
import { assert, describe, it } from "@effect/vitest"
import { ConfigProvider, Console, Effect, FileSystem, Layer, Path, Stdio, Terminal } from "effect"
import { Command } from "effect/cli"
import { FetchHttpClient } from "effect/http"
import { ChildProcessSpawner } from "effect/process"

import { project } from "../src/projects-commands.ts"

const root = Command.make("cluenori").pipe(Command.withSubcommands([project]))
const detail = {
  project: { key: "folio", name: "Folio Notes", createdAt: "2026-10-19T09:00:00.000Z" },
  components: [],
}
const args = ["project", "settings", "folio"]

// The real command parser, typed client and response schemas; fake only the external seams.
const run = Effect.fnUntraced(function* (argv: ReadonlyArray<string>, answer: (request: Request) => Response) {
  const requests: Array<Request> = []
  const output: Array<string> = []
  const errors: Array<string> = []
  const current = yield* Console.Console
  const result = yield* Command.runWith(root, { version: "test" })(argv).pipe(
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
      requests.push(request.clone())
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
            readInput: Effect.die("Project settings must not prompt"),
            readLine: Effect.die("Project settings must not prompt"),
            display: () => Effect.void,
          }),
        ),
        Layer.succeed(
          ChildProcessSpawner.ChildProcessSpawner,
          ChildProcessSpawner.make(() => Effect.die("Project settings must not start programs")),
        ),
      ),
    ),
  )
  return { result, requests, output: output.join("\n"), errors: errors.join("\n") }
})

describe("project settings command", () => {
  it.effect("reads without writing, showing chosen and seen environments including absent and empty fields", () =>
    Effect.gen(function* () {
      for (const [fields, production, seen] of [
        [{}, "", "none"],
        [{ settings: { productionEnvironments: ["live"] }, environments: [] }, "live", "none"],
        [
          { settings: { productionEnvironments: ["prod", "live"] }, environments: ["live", "staging"] },
          "prod, live",
          "live, staging",
        ],
      ] as const) {
        const answer = yield* run(args, () => Response.json({ ...detail, ...fields }))
        assert.strictEqual(answer.result._tag, "Success")
        assert.strictEqual(answer.errors, "")
        assert.deepStrictEqual(
          answer.requests.map((request) => [request.method, request.url]),
          [["GET", "https://cluenori.example/api/projects/folio"]],
        )
        assert.deepStrictEqual(answer.output.split("\n").slice(0, 3), [
          "Folio Notes (folio) on https://cluenori.example:",
          `  Production   ${production}`,
          `  Seen lately  ${seen}`,
        ])
      }
    }),
  )

  it.effect("sends trimmed nonempty environment names to the selected deployment and reads back saved settings", () =>
    Effect.gen(function* () {
      for (const local of [false, true]) {
        const answer = yield* run(
          [...args, "--production", " , prod, live , ,staging, ", ...(local ? ["--local"] : [])],
          (request) =>
            request.method === "PUT"
              ? Response.json({ productionEnvironments: ["prod", "live", "staging"] })
              : Response.json({
                  ...detail,
                  settings: { productionEnvironments: ["live", "prod"] },
                  environments: ["staging", "live"],
                }),
        )
        assert.strictEqual(answer.result._tag, "Success")
        assert.strictEqual(answer.errors, "")
        const origin = local ? "http://localhost:8787" : "https://cluenori.example"
        assert.deepStrictEqual(
          answer.requests.map((request) => [request.method, request.url]),
          [
            ["PUT", `${origin}/api/projects/folio/settings`],
            ["GET", `${origin}/api/projects/folio`],
          ],
        )
        const write = answer.requests[0]
        assert(write !== undefined)
        assert.deepStrictEqual(yield* Effect.promise(() => write.json()), {
          productionEnvironments: ["prod", "live", "staging"],
        })
        assert.isTrue(
          answer.requests.every(
            (request) => request.headers.get("authorization") === `Bearer made-up-${local ? "local-token" : "token"}`,
          ),
        )
        assert.include(answer.output, `Folio Notes (folio) on ${origin}:`)
        assert.include(answer.output, "  Production   live, prod\n  Seen lately  staging, live")
      }
    }),
  )

  it.effect("rejects empty or invalid environment lists and invalid project keys without contacting the API", () =>
    Effect.gen(function* () {
      for (const [argv, expected] of [
        [[...args, "--production", " , , "], "Name at least one environment, such as --production prod."],
        [[...args, "--production", "prod,Not Live"], '"Not Live" isn\'t an environment key:'],
        [["project", "settings", "Not Folio"], '"Not Folio" isn\'t a project key:'],
      ] as const) {
        const answer = yield* run(argv, () => Response.json(detail))
        assert.strictEqual(answer.result._tag, "Failure")
        assert.isEmpty(answer.requests)
        assert.include(answer.errors, expected)
        assert.strictEqual(answer.output, "")
      }
    }),
  )

  it.effect("reports a missing project or refused token at either read or write without printing settings", () =>
    Effect.gen(function* () {
      for (const argv of [args, [...args, "--production", "live"]]) {
        for (const [body, status, expected] of [
          [{ _tag: "ProjectNotFound", project: "folio" }, 404, "https://cluenori.example has no project folio."],
          [
            { _tag: "Unauthorized", message: "Token expired" },
            401,
            "https://cluenori.example refused the API token: Token expired",
          ],
        ] as const) {
          const answer = yield* run(argv, () => Response.json(body, { status }))
          assert.strictEqual(answer.result._tag, "Failure")
          assert.strictEqual(answer.requests.length, 1)
          assert.strictEqual(answer.errors, expected)
          assert.strictEqual(answer.output, "")
        }
      }
    }),
  )
})
