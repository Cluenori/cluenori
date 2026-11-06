import { BunCrypto } from "@effect/platform-bun"
import { assert, describe, it } from "@effect/vitest"
import { ConfigProvider, Console, Effect, FileSystem, Layer, Path, Stdio, Terminal } from "effect"
import { Command } from "effect/cli"
import { FetchHttpClient } from "effect/http"
import { ChildProcessSpawner } from "effect/process"

import { versionPolicy } from "../src/version-policy-commands.ts"

const root = Command.make("cluenori").pipe(Command.withSubcommands([versionPolicy]))
const at = "2026-10-19T09:00:00.000Z"
const base = { storeUrl: "https://apps.example/notes", words: [] }
const policy = {
  ...base,
  component: "notes-ios",
  minimum: "1.4",
  recommended: "1.5.2",
  minimumOsVersion: "26.0",
  words: [
    { locale: "en-US", decision: "require", text: { title: "New notes await", message: "Update to keep writing." } },
    { locale: "pl", decision: "recommend", text: { title: "Nowe notatki", message: "Pobierz aktualizację." } },
  ],
  setAt: at,
}
const detail = {
  project: { key: "folio", name: "Folio Notes", createdAt: at },
  components: [{ key: "notes-ios", name: "Notes for iOS", createdAt: at }],
}
const endpoint = "https://cluenori.example/api/projects/folio/version-policies"
const args = ["version-policy", "folio", "notes-ios"]

// The real parser, typed HTTP client, schemas and output; only settings, HTTP and terminal are fake.
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
            readInput: Effect.die("Version policy commands must not prompt"),
            readLine: Effect.die("Version policy commands must not prompt"),
            display: () => Effect.void,
          }),
        ),
        Layer.succeed(
          ChildProcessSpawner.ChildProcessSpawner,
          ChildProcessSpawner.make(() => Effect.die("Version policy commands must not start programs")),
        ),
      ),
    ),
  )
  return { result, requests, output: output.join("\n"), errors: errors.join("\n") }
})

describe("version-policy command", () => {
  it.effect("selects the component by key and explains required versus offered updates, including equal versions", () =>
    Effect.gen(function* () {
      const cases = [
        [{ minimum: "1.4" }, "Releases below 1.4 must update, to 1.4, in production."],
        [{ recommended: "1.5.2" }, "Releases below 1.5.2 are offered 1.5.2, in production."],
        [{ minimum: "1.4", recommended: "1.4.0" }, "Releases below 1.4 must update, to 1.4.0, in production."],
        [
          { minimum: "1.4", recommended: "1.5.2" },
          "Releases below 1.4 must update; below 1.5.2 they're offered 1.5.2, in production.",
        ],
      ] as const
      for (const [versions, expected] of cases) {
        const answer = yield* run(args, (request) =>
          Response.json(
            new URL(request.url).pathname.endsWith("/version-policies")
              ? {
                  policies: [
                    { ...policy, component: "notes-android" },
                    { ...base, ...versions, component: "notes-ios", setAt: at },
                  ],
                }
              : detail,
          ),
        )
        assert.strictEqual(answer.result._tag, "Success")
        assert.deepStrictEqual(
          answer.requests.map((request) => [request.method, request.url]),
          [
            ["GET", "https://cluenori.example/api/projects/folio"],
            ["GET", endpoint],
          ],
        )
        assert.isTrue(
          answer.requests.every((request) => request.headers.get("authorization") === "Bearer made-up-token"),
        )
        assert.include(answer.output, "notes-ios's version policy, set 2026-10-19 09:00 UTC:")
        const rows = answer.output.split("\n").map((row) => row.trim().replace(/ +/g, " "))
        assert.include(rows, `Minimum ${"minimum" in versions ? versions.minimum : "none"}`)
        assert.include(rows, `Recommended ${"recommended" in versions ? versions.recommended : "none"}`)
        assert.match(answer.output, /Store +https:\/\/apps.example\/notes\n +Minimum OS +unknown/)
        assert.include(answer.output, expected)
        assert.include(answer.output, "Apps show the SDK's own words: the project has written none.")
        assert.notInclude(answer.output, "New notes await")
      }
      const words = yield* run(args, (request) =>
        Response.json(new URL(request.url).pathname.endsWith("/version-policies") ? { policies: [policy] } : detail),
      )
      assert.strictEqual(words.result._tag, "Success")
      assert.match(words.output, /Minimum OS +26.0/)
      assert.match(words.output, /require +en-US +New notes await\nrecommend +pl +Nowe notatki$/)
      assert.notInclude(words.output, "SDK's own words")
    }),
  )

  it.effect("distinguishes a component without a policy from an unknown component and supports the local target", () =>
    Effect.gen(function* () {
      const answer = yield* run([...args, "--local"], (request) =>
        Response.json(new URL(request.url).pathname.endsWith("/version-policies") ? { policies: [] } : detail),
      )
      assert.strictEqual(answer.result._tag, "Success")
      assert.include(answer.output, "notes-ios has no version policy: its releases are never asked to update.")
      assert.include(answer.output, "./cluenori version-policy folio notes-ios --minimum 0.4.0 --recommended 0.4.1")
      assert.isTrue(answer.requests.every((request) => new URL(request.url).origin === "http://localhost:8787"))
      assert.isTrue(
        answer.requests.every((request) => request.headers.get("authorization") === "Bearer made-up-local-token"),
      )
      const missing = yield* run(args, () =>
        Response.json({
          ...detail,
          components: [{ key: "notes-android", name: "Notes for Android", createdAt: at }],
        }),
      )
      assert.strictEqual(missing.result._tag, "Failure")
      assert.strictEqual(missing.requests.length, 1)
      assert.strictEqual(missing.errors, "folio has no component notes-ios.")
      assert.strictEqual(missing.output, "")
    }),
  )

  it.effect("changes only the named fields, preserving the other versions, store, OS and every language's words", () =>
    Effect.gen(function* () {
      const { component: _, setAt: _at, ...kept } = policy
      const cases = [
        [["--minimum", "1.4.1"], { minimum: "1.4.1" }],
        [["--recommended", "1.6.0"], { recommended: "1.6.0" }],
        [["--store-url", "https://store.example/notes"], { storeUrl: "https://store.example/notes" }],
        [["--minimum-os", "26.1"], { minimumOsVersion: "26.1" }],
        [
          [
            "--minimum",
            "1.4.1",
            "--recommended",
            "1.6",
            "--store-url",
            "https://store.example/new",
            "--minimum-os",
            "27",
          ],
          { minimum: "1.4.1", recommended: "1.6", storeUrl: "https://store.example/new", minimumOsVersion: "27" },
        ],
      ] as const
      for (const [flags, changed] of cases) {
        const answer = yield* run([...args, ...flags], (request) =>
          Response.json(request.method === "GET" ? { policies: [policy] } : { ...policy, ...changed }),
        )
        assert.strictEqual(answer.result._tag, "Success")
        assert.deepStrictEqual(
          answer.requests.map((request) => [request.method, request.url]),
          [
            ["GET", endpoint],
            ["PUT", `${endpoint}/notes-ios`],
          ],
        )
        const write = answer.requests[1]
        assert(write !== undefined)
        assert.deepStrictEqual(yield* Effect.promise(() => write.json()), { ...kept, ...changed })
        assert.include(answer.output, "Apps pick it up within five minutes, when they next read their manifest.")
        assert.notInclude(answer.output, "Its store page:")
      }
    }),
  )

  it.effect(
    "creates a policy without inventing absent fields and reports a discovered store page only when needed",
    () =>
      Effect.gen(function* () {
        for (const givenStore of [false, true]) {
          const answer = yield* run(
            [...args, "--minimum", "1.4", ...(givenStore ? ["--store-url", base.storeUrl] : [])],
            (request) =>
              Response.json(
                request.method === "GET"
                  ? { policies: [] }
                  : { ...base, component: "notes-ios", minimum: "1.4", setAt: at },
              ),
          )
          assert.strictEqual(answer.result._tag, "Success")
          assert.strictEqual(answer.requests.length, 2)
          const write = answer.requests[1]
          assert(write !== undefined)
          assert.deepStrictEqual(yield* Effect.promise(() => write.json()), {
            minimum: "1.4",
            ...(givenStore ? { storeUrl: base.storeUrl } : {}),
          })
          assert.include(answer.output, "Releases below 1.4 must update, to 1.4, in production.")
          assert.strictEqual(answer.output.includes(`Its store page: ${base.storeUrl}.`), !givenStore)
        }
        const answer = yield* run([...args, "--recommended", "1.6"], (request) =>
          Response.json(
            request.method === "GET"
              ? { policies: [{ ...base, component: "notes-ios", recommended: "1.5", setAt: at }] }
              : { ...base, component: "notes-ios", recommended: "1.6", setAt: at },
          ),
        )
        assert.strictEqual(answer.result._tag, "Success")
        const write = answer.requests[1]
        assert(write !== undefined)
        assert.deepStrictEqual(yield* Effect.promise(() => write.json()), { ...base, recommended: "1.6" })
      }),
  )

  it.effect("clears only an existing policy and distinguishes removal from nothing to clear", () =>
    Effect.gen(function* () {
      for (const exists of [false, true]) {
        const answer = yield* run([...args, "--clear"], (request) =>
          request.method === "GET"
            ? Response.json({ policies: exists ? [policy] : [{ ...policy, component: "notes-android" }] })
            : new Response(null, { status: 204 }),
        )
        assert.strictEqual(answer.result._tag, "Success")
        assert.deepStrictEqual(
          answer.requests.map((request) => [request.method, request.url]),
          [["GET", endpoint], ...(exists ? [["DELETE", `${endpoint}/notes-ios`]] : [])],
        )
        assert.include(
          answer.output,
          exists
            ? "notes-ios has no version policy now: its releases aren't asked to update."
            : "notes-ios has no version policy; there is nothing to clear.",
        )
        assert.strictEqual(answer.output.includes("Apps pick it up within five minutes"), exists)
      }
    }),
  )

  it.effect("refuses malformed keys, invalid field values and clear combined with any change before HTTP", () =>
    Effect.gen(function* () {
      const invalid = [
        ["version-policy", "Not a key", "notes-ios"],
        ["version-policy", "folio", "Not a key"],
        ...["--minimum", "--recommended", "--minimum-os"].map((flag) => [...args, flag, "1.x"]),
        [...args, "--store-url", "http://store.example/notes"],
        ...["--minimum", "--recommended", "--minimum-os", "--store-url"].map((flag) => [
          ...args,
          "--clear",
          flag,
          "1.4",
        ]),
      ]
      for (const input of invalid) {
        const answer = yield* run(input, () => Response.json({}))
        assert.strictEqual(answer.result._tag, "Failure")
        assert.isEmpty(answer.requests)
        assert.isNotEmpty(answer.errors)
        assert.strictEqual(answer.output, "")
        if (input.includes("--clear")) {
          assert.strictEqual(answer.errors, "--clear removes the whole policy, so it takes no other options.")
        }
      }
    }),
  )

  it.effect(
    "stops on missing projects at every request and never announces a refused write or removal as successful",
    () =>
      Effect.gen(function* () {
        for (const [input, failAt] of [
          [args, 1],
          [args, 2],
          [[...args, "--recommended", "1.6"], 1],
          [[...args, "--recommended", "1.6"], 2],
          [[...args, "--clear"], 1],
          [[...args, "--clear"], 2],
        ] as const) {
          let calls = 0
          const answer = yield* run(input, () =>
            ++calls === failAt
              ? Response.json({ _tag: "ProjectNotFound", project: "folio" }, { status: 404 })
              : Response.json(input === args ? detail : { policies: [policy] }),
          )
          assert.strictEqual(answer.result._tag, "Failure")
          assert.strictEqual(answer.requests.length, failAt)
          assert.strictEqual(answer.errors, "https://cluenori.example has no project folio.")
          assert.strictEqual(answer.output, "")
        }
        const refused = yield* run([...args, "--minimum", "2.0"], (request) =>
          Response.json(
            request.method === "GET"
              ? { policies: [policy] }
              : { _tag: "VersionPolicyRefused", reason: "The recommended version is lower than the minimum" },
            { status: request.method === "GET" ? 200 : 422 },
          ),
        )
        assert.strictEqual(refused.result._tag, "Failure")
        assert.strictEqual(refused.errors, "Not set: The recommended version is lower than the minimum.")
        assert.strictEqual(refused.output, "")
        for (const [body, status, expected] of [
          [{ _tag: "Unauthorized", message: "Token expired" }, 401, "refused the API token: Token expired"],
          [{ policies: "not policies" }, 200, "answered in a way this CLI doesn't expect"],
        ] as const) {
          const answer = yield* run([...args, "--clear"], () => Response.json(body, { status }))
          assert.strictEqual(answer.result._tag, "Failure")
          assert.strictEqual(answer.requests.length, 1)
          assert.include(answer.errors, expected)
          assert.strictEqual(answer.output, "")
        }
      }),
  )
})
