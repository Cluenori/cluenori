import { BunCrypto } from "@effect/platform-bun"
import { assert, describe, it } from "@effect/vitest"
import { ConfigProvider, Console, Effect, FileSystem, Layer, Path, Stdio, Terminal } from "effect"
import { Command } from "effect/cli"
import { FetchHttpClient } from "effect/http"
import { ChildProcessSpawner } from "effect/process"

import { version } from "../src/versions-commands.ts"

const root = Command.make("cluenori").pipe(Command.withSubcommands([version]))
const at = "2026-10-19T09:00:00.000Z"
const line = { component: "notes-ios", version: "1.4.2", lastBuild: 57, setAt: at }
const detail = {
  project: { key: "folio", name: "Folio Notes", createdAt: at },
  components: ["notes-api", "notes-ios", "jobs"].map((key) => ({ key, name: key, createdAt: at })),
}
// Deliberately not in the project's component order: versions are joined by key, not position.
const versions = { versions: [line, { ...line, component: "notes-api", version: "2.0.0", lastBuild: 0 }] }

// Exercise the real command and typed API client; only settings, HTTP and terminal are fake.
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
      requests.push(request.clone())
      return Promise.resolve(answer(request))
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
            readInput: Effect.die("Version commands must not prompt"),
            readLine: Effect.die("Version commands must not prompt"),
            display: () => Effect.void,
          }),
        ),
        Layer.succeed(
          ChildProcessSpawner.ChildProcessSpawner,
          ChildProcessSpawner.make(() => Effect.die("Version commands must not start programs")),
        ),
      ),
    ),
  )
  return { result, requests, output: output.join("\n"), errors: errors.join("\n") }
})

const show = (request: Request) =>
  Response.json(new URL(request.url).pathname.endsWith("/versions") ? versions : detail)

describe("version command", () => {
  it.effect("joins versions to components, distinguishing unset versions, unused builds and the next release", () =>
    Effect.gen(function* () {
      const answer = yield* run(["version", "folio"], show)
      assert.strictEqual(answer.result._tag, "Success")
      assert.deepStrictEqual(
        answer.requests.map((request) => [request.method, request.url]),
        [
          ["GET", "https://cluenori.example/api/projects/folio/versions"],
          ["GET", "https://cluenori.example/api/projects/folio"],
        ],
      )
      assert.isTrue(
        answer.requests.every((request) => request.headers.get("authorization") === "Bearer made-up-test-token"),
      )
      assert.match(answer.output, /Component\s+Version\s+Last build\s+Next release/)
      assert.match(
        answer.output,
        /notes-api\s+2.0.0\s+none\s+2.0.0\+1\nnotes-ios\s+1.4.2\s+57\s+1.4.2\+58\njobs\s+not set/,
      )
      assert.include(answer.output, "CI can't number its builds until its version is set")
      assert.include(answer.output, "./cluenori version folio <component> 1.0.0")
      assert.include(answer.output, "./cluenori version folio <component> patch, minor or major")
      const one = yield* run(["version", "folio", "notes-ios"], show)
      assert.strictEqual(one.result._tag, "Success")
      assert.match(one.output, /notes-ios\s+1.4.2\s+57\s+1.4.2\+58/)
      assert.notInclude(one.output, "notes-api")
      assert.notInclude(one.output, "jobs")
      assert.notInclude(one.output, "CI can't number")
      const missing = yield* run(["version", "folio", "missing"], show)
      assert.strictEqual(missing.result._tag, "Failure")
      assert.include(missing.errors, "folio has no component missing.")
      const empty = yield* run(["version", "folio"], (request) =>
        Response.json(
          new URL(request.url).pathname.endsWith("/versions") ? { versions: [] } : { ...detail, components: [] },
        ),
      )
      assert.strictEqual(empty.result._tag, "Success")
      assert.include(empty.output, "folio has no components yet. Add one: ./cluenori component add folio")
      assert.notInclude(empty.output, "Next release")
    }),
  )

  it.effect("sets explicit or bumped versions and sends first-build only when requested", () =>
    Effect.gen(function* () {
      for (const [wanted, expected, firstBuild, existing] of [
        ["patch", "1.4.3", undefined, true],
        ["minor", "1.5.0", undefined, true],
        ["major", "2.0.0", undefined, true],
        ["1.4.2", "1.4.2", undefined, true],
        ["3.2.1", "3.2.1", 80, true],
        ["1.0.0", "1.0.0", undefined, false],
      ] as const) {
        const next = firstBuild ?? (existing ? 58 : 1)
        const answer = yield* run(
          [
            "version",
            "folio",
            "notes-ios",
            wanted,
            ...(firstBuild === undefined ? [] : ["--first-build", `${firstBuild}`]),
          ],
          (request) => {
            if (request.method === "GET") return Response.json(existing ? versions : { versions: [] })
            return Response.json({ ...line, version: expected, lastBuild: next - 1 })
          },
        )
        assert.strictEqual(answer.result._tag, "Success")
        assert.strictEqual(answer.requests.length, 2)
        const write = answer.requests[1]
        assert(write !== undefined)
        assert.strictEqual(write.method, "PUT")
        assert.strictEqual(write.url, "https://cluenori.example/api/projects/folio/versions/notes-ios")
        assert.deepStrictEqual(yield* Effect.promise(() => write.json()), {
          version: expected,
          ...(firstBuild === undefined ? {} : { firstBuild }),
        })
        const was = existing && expected !== "1.4.2" ? ", was 1.4.2" : ""
        assert.include(answer.output, `notes-ios is ${expected}${was}. Its next build is ${expected}+${next}.`)
        assert.strictEqual(answer.output.includes("Commits numbered before keep their releases"), existing)
      }
    }),
  )

  it.effect("refuses invalid input before HTTP and never writes when a version cannot be bumped", () =>
    Effect.gen(function* () {
      for (const args of [
        ["version", "Not a key"],
        ["version", "folio", "Not a key"],
        ["version", "folio", "notes-ios", "1.4"],
        ["version", "folio", "notes-ios", "1.4.2", "--first-build", "0"],
        ["version", "folio", "notes-ios", "1.4.2", "--first-build", "1000000000"],
        ["version", "folio", "--first-build", "80"],
        ["version", "folio", "notes-ios", "--first-build", "80"],
      ]) {
        const answer = yield* run(args, () => Response.json({}))
        assert.strictEqual(answer.result._tag, "Failure")
        assert.isEmpty(answer.requests)
        assert.isNotEmpty(answer.errors)
      }
      const missing = yield* run(["version", "folio", "jobs", "patch"], () => Response.json(versions))
      assert.strictEqual(missing.result._tag, "Failure")
      assert.strictEqual(missing.requests.length, 1)
      assert.include(missing.errors, "jobs has no version yet, so no patch to raise.")
    }),
  )

  it.effect("reports missing projects at each request and preserves the API's reason for refusing a write", () =>
    Effect.gen(function* () {
      for (const [args, failAt] of [
        [["version", "folio"], 1],
        [["version", "folio"], 2],
        [["version", "folio", "notes-ios", "patch"], 1],
        [["version", "folio", "notes-ios", "patch"], 2],
      ] as const) {
        let calls = 0
        const answer = yield* run(args, () =>
          ++calls === failAt
            ? Response.json({ _tag: "ProjectNotFound", project: "folio" }, { status: 404 })
            : Response.json(versions),
        )
        assert.strictEqual(answer.result._tag, "Failure")
        assert.strictEqual(answer.requests.length, failAt)
        assert.include(answer.errors, "https://cluenori.example has no project folio.")
        assert.strictEqual(answer.output, "")
      }
      const refused = yield* run(["version", "folio", "notes-ios", "1.0.0"], (request) =>
        request.method === "GET"
          ? Response.json(versions)
          : Response.json({ _tag: "VersionRefused", reason: "The version must not go back" }, { status: 422 }),
      )
      assert.strictEqual(refused.result._tag, "Failure")
      assert.include(refused.errors, "Not set: The version must not go back.")
      assert.strictEqual(refused.output, "")
    }),
  )
})
