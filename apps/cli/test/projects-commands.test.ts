import { BunCrypto } from "@effect/platform-bun"
import { assert, describe, it } from "@effect/vitest"
import { ConfigProvider, Console, Effect, FileSystem, Layer, Path, Stdio, Terminal } from "effect"
import { Command } from "effect/cli"
import { FetchHttpClient } from "effect/http"
import { ChildProcessSpawner } from "effect/process"
import { TestClock } from "effect/testing"

import { component, project } from "../src/projects-commands.ts"

const root = Command.make("cluenori").pipe(Command.withSubcommands([project, component]))
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

const at = "2026-10-19T09:00:00.000Z"
const sdkKey = `cluenori-sdk.folio.notes-api.${"A".repeat(22)}`
const issued = { key: sdkKey, component: "notes-api", issuedAt: at }
const keyId = "01960000-0000-7000-8000-000000000001"
const ingest = { id: keyId, component: "notes-api", name: "blue", createdAt: at }
const sdkArgs = ["component", "sdk-keys", "folio", "notes-api"]
const ingestArgs = ["component", "ingest-keys", "folio", "notes-api"]
const base = "https://cluenori.example/api/projects/folio/components/notes-api"

describe("component key commands", () => {
  it.effect("creates a component with its first ingest key and explains exactly where telemetry is sent", () =>
    Effect.gen(function* () {
      const argv = ["component", "add", "folio", "notes-api", "--name", "Notes API"]
      const secret = `cluenori.folio.notes-api.${"a".repeat(43)}`
      const added = { component: { key: "notes-api", name: "Notes API", createdAt: at }, ingestKey: secret }
      const answer = yield* run(argv, () => Response.json(added, { status: 201 }))
      assert.strictEqual(answer.result._tag, "Success")
      assert.strictEqual(answer.errors, "")
      assert.deepStrictEqual(
        answer.requests.map((request) => [request.method, request.url]),
        [["POST", "https://cluenori.example/api/projects/folio/components"]],
      )
      const request = answer.requests[0]
      assert(request !== undefined)
      assert.deepStrictEqual(yield* Effect.promise(() => request.json()), { key: "notes-api", name: "Notes API" })
      assert.include(
        answer.output,
        `Added Notes API (notes-api) to folio. Its ingest key, shown only now:\n\n  ${secret}\n`,
      )
      const lines = answer.output.split("\n").map((line) => line.trim())
      assert.include(lines, "Endpoint  https://cluenori.example/otlp/v1/traces")
      assert.include(lines, `Header    Authorization: Bearer ${secret}`)
      for (const [body, status, expected] of [
        [
          { _tag: "ProjectNotFound", project: "folio" },
          404,
          "has no project folio. Create it: ./cluenori project create folio",
        ],
        [
          { _tag: "ComponentExists", component: "notes-api" },
          409,
          "folio already has a component with the key notes-api.",
        ],
        [{ _tag: "NotAllowed" }, 403, "Only an owner adds a component"],
      ] as const) {
        const refused = yield* run(argv, () => Response.json(body, { status }))
        assert.strictEqual(refused.result._tag, "Failure")
        assert.strictEqual(refused.requests.length, 1)
        assert.strictEqual(refused.output, "")
        assert.include(refused.errors, expected)
      }
    }),
  )

  it.effect("lists SDK keys with their issue and revocation dates, or explains how to issue the first", () =>
    Effect.gen(function* () {
      const empty = yield* run(sdkArgs, () => Response.json({ keys: [] }))
      assert.strictEqual(empty.result._tag, "Success")
      assert.strictEqual(
        empty.output,
        "notes-api has no SDK keys yet. Issue one: ./cluenori component sdk-keys folio notes-api --new",
      )
      const answer = yield* run(sdkArgs, () =>
        Response.json({
          keys: [issued, { ...issued, key: sdkKey.replace("A", "B"), revokedAt: "2026-10-20T10:15:00.000Z" }],
        }),
      )
      assert.strictEqual(answer.result._tag, "Success")
      assert.deepStrictEqual(
        answer.requests.map((request) => [request.method, request.url]),
        [["GET", `${base}/sdk-keys`]],
      )
      assert.deepStrictEqual(
        answer.output.split("\n").map((line) => line.trim().replace(/ +/g, " ")),
        [
          "Key Issued Revoked",
          `${sdkKey} 2026-10-19 09:00 UTC active`,
          `${sdkKey.replace("A", "B")} 2026-10-19 09:00 UTC 2026-10-20 10:15 UTC`,
        ],
      )
    }),
  )

  it.effect("issues and revokes an SDK key without making extra requests", () =>
    Effect.gen(function* () {
      const added = yield* run([...sdkArgs, "--new"], () => Response.json(issued, { status: 201 }))
      assert.strictEqual(added.result._tag, "Success")
      assert.deepStrictEqual(
        added.requests.map((request) => [request.method, request.url]),
        [["POST", `${base}/sdk-keys`]],
      )
      assert.include(added.output, `Issued an SDK key for notes-api of folio:\n\n  ${sdkKey}\n`)
      assert.include(added.output, "isn't a secret")
      assert.include(
        added.output,
        "other keys stay active until you revoke them: ./cluenori component sdk-keys folio notes-api --revoke <key>",
      )
      for (const revokedAt of [undefined, "2026-10-20T10:15:00.000Z"]) {
        const revoked = yield* run([...sdkArgs, "--revoke", sdkKey], () =>
          Response.json({ ...issued, ...(revokedAt === undefined ? {} : { revokedAt }) }),
        )
        assert.strictEqual(revoked.result._tag, "Success")
        assert.deepStrictEqual(
          revoked.requests.map((request) => [request.method, request.url]),
          [["POST", `${base}/sdk-keys/${sdkKey}/revoke`]],
        )
        assert.strictEqual(
          revoked.output,
          `Revoked ${sdkKey} (since ${revokedAt === undefined ? "now" : "2026-10-20 10:15 UTC"}). Builds that carry it are refused from now on.`,
        )
      }
    }),
  )

  it.effect("adds ingest keys with exactly the requested lifetime and shows the returned secret only on creation", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse(at))
      for (const [expires, expected] of [
        [undefined, undefined],
        ["30d", "2026-11-18T09:00:00.000Z"],
        ["90d", "2027-01-17T09:00:00.000Z"],
        ["365d", "2027-10-19T09:00:00.000Z"],
      ] as const) {
        const secret = `cluenori.folio.notes-api.${"a".repeat(43)}`
        const answer = yield* run(
          [...ingestArgs, "--new", "blue", ...(expires === undefined ? [] : ["--expires", expires])],
          () => Response.json({ key: ingest, ingestKey: secret }, { status: 201 }),
        )
        assert.strictEqual(answer.result._tag, "Success")
        assert.deepStrictEqual(
          answer.requests.map((request) => [request.method, request.url]),
          [["POST", `${base}/ingest-keys`]],
        )
        const request = answer.requests[0]
        assert(request !== undefined)
        assert.deepStrictEqual(yield* Effect.promise(() => request.json()), {
          name: "blue",
          ...(expected === undefined ? {} : { expiresAt: expected }),
        })
        assert.include(answer.output, `Added the ingest key "blue" (${keyId}) to notes-api of folio:\n\n  ${secret}\n`)
        assert.include(answer.output, "It is shown only now: keep it in your service's secrets.")
        assert.include(answer.output, "./cluenori component ingest-keys folio notes-api --revoke <id> [--in 24h]")
        assert.strictEqual(answer.errors, "")
      }
    }),
  )

  it.effect("revokes ingest keys now or at each supported delay, reporting the server's effective date", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse(at))
      for (const [delay, expected] of [
        [undefined, undefined],
        ["1h", "2026-10-19T10:00:00.000Z"],
        ["24h", "2026-10-20T09:00:00.000Z"],
        ["7d", "2026-10-26T09:00:00.000Z"],
      ] as const) {
        const answer = yield* run(
          [...ingestArgs, "--revoke", keyId, ...(delay === undefined ? [] : ["--in", delay])],
          () => Response.json({ ...ingest, ...(delay === undefined ? {} : { revokedAt: "2026-10-21T12:34:00.000Z" }) }),
        )
        assert.strictEqual(answer.result._tag, "Success")
        assert.deepStrictEqual(
          answer.requests.map((request) => [request.method, request.url]),
          [["POST", `${base}/ingest-keys/${keyId}/revoke`]],
        )
        const request = answer.requests[0]
        assert(request !== undefined)
        assert.deepStrictEqual(
          yield* Effect.promise(() => request.json()),
          expected === undefined ? {} : { at: expected },
        )
        assert.strictEqual(
          answer.output,
          `"blue" stops working at ${delay === undefined ? "now" : "2026-10-21 12:34 UTC"}; what is sent with it is refused from then on.`,
        )
      }
    }),
  )

  it.effect(
    "distinguishes keys ended at the current instant from future expiry and revocation, and missing last use from a date",
    () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(Date.parse(at))
        const empty = yield* run(ingestArgs, () => Response.json({ keys: [] }))
        assert.strictEqual(empty.result._tag, "Success")
        assert.strictEqual(
          empty.output,
          "notes-api has no ingest keys. Add one: ./cluenori component ingest-keys folio notes-api --new <name>",
        )
        const fields = [
          {},
          { expiresAt: "2026-10-19T09:00:00.001Z" },
          { revokedAt: "2026-10-19T09:00:00.001Z" },
          { expiresAt: at, revokedAt: "2026-10-20T09:00:00.000Z" },
          { revokedAt: at, expiresAt: "2026-10-20T09:00:00.000Z" },
          { expiresAt: "2026-10-19T08:59:59.999Z" },
          { revokedAt: "2026-10-19T08:59:59.999Z", lastUsedAt: "2026-10-19T07:00:00.000Z" },
        ]
        const ids = fields.map((_, index) => `01960000-0000-7000-8000-${String(index + 1).padStart(12, "0")}`)
        const answer = yield* run(ingestArgs, () =>
          Response.json({
            keys: fields.map((each, index) => ({ ...ingest, id: ids[index], name: `key-${index}`, ...each })),
          }),
        )
        assert.strictEqual(answer.result._tag, "Success")
        assert.deepStrictEqual(
          answer.requests.map((request) => [request.method, request.url]),
          [["GET", `${base}/ingest-keys`]],
        )
        const lines = answer.output.split("\n")
        const rows = lines.map((line) => line.trim().replace(/ +/g, " "))
        assert.strictEqual(rows[0], "ID Name State Added Last used Expires Revoked")
        assert.deepStrictEqual(rows.slice(1), [
          `${ids[0]} key-0 works 2026-10-19 09:00 UTC never`,
          `${ids[1]} key-1 works 2026-10-19 09:00 UTC never 2026-10-19 09:00 UTC`,
          `${ids[2]} key-2 works 2026-10-19 09:00 UTC never 2026-10-19 09:00 UTC`,
          `${ids[3]} key-3 ended 2026-10-19 09:00 UTC never 2026-10-19 09:00 UTC 2026-10-20 09:00 UTC`,
          `${ids[4]} key-4 ended 2026-10-19 09:00 UTC never 2026-10-20 09:00 UTC 2026-10-19 09:00 UTC`,
          `${ids[5]} key-5 ended 2026-10-19 09:00 UTC never 2026-10-19 08:59 UTC`,
          `${ids[6]} key-6 ended 2026-10-19 09:00 UTC 2026-10-19 07:00 UTC hour 2026-10-19 08:59 UTC`,
        ])
        // Empty cells keep their meaning: a revocation alone must not appear under Expires.
        const header = lines[0] ?? ""
        const expiresOnly = lines[2] ?? ""
        const revokedOnly = lines[3] ?? ""
        const date = "2026-10-19 09:00 UTC"
        assert.strictEqual(expiresOnly.lastIndexOf(date) + date.length, header.indexOf("Expires") + "Expires".length)
        assert.strictEqual(revokedOnly.lastIndexOf(date) + date.length, header.indexOf("Revoked") + "Revoked".length)
      }),
  )

  it.effect("rejects conflicting flags, invalid names and identifiers before sending any request", () =>
    Effect.gen(function* () {
      for (const [argv, expected] of [
        [[...sdkArgs, "--new", "--revoke", sdkKey], "Use --new or --revoke, not both"],
        [[...sdkArgs, "--revoke", "not-a-key"], "isn't an SDK key"],
        [[...ingestArgs, "--new", "blue", "--revoke", keyId], "Use --new or --revoke, not both"],
        [[...ingestArgs, "--expires", "30d"], "--expires goes with --new."],
        [[...ingestArgs, "--in", "1h"], "--in goes with --revoke."],
        [[...ingestArgs, "--new", " "], "isn't a key's name"],
        [[...ingestArgs, "--revoke", "not-an-id"], "isn't an ingest key's ID"],
        [["component", "sdk-keys", "Not Folio", "notes-api"], "isn't a project key"],
        [["component", "ingest-keys", "folio", "Not Notes"], "isn't a component key"],
      ] as const) {
        const answer = yield* run(argv, () => Response.json({ keys: [] }))
        assert.strictEqual(answer.result._tag, "Failure")
        assert.isEmpty(answer.requests)
        assert.strictEqual(answer.output, "")
        assert.include(answer.errors, expected)
      }
    }),
  )

  it.effect("reports API refusals without printing success or retrying a key mutation", () =>
    Effect.gen(function* () {
      const projectMissing = { _tag: "ProjectNotFound", project: "folio" }
      const componentMissing = { _tag: "ComponentNotFound", component: "notes-api" }
      for (const [argv, body, status, expected] of [
        [sdkArgs, projectMissing, 404, "has no project folio"],
        [sdkArgs, componentMissing, 404, "has no component notes-api"],
        [[...sdkArgs, "--new"], { _tag: "TooManySdkKeys", component: "notes-api" }, 409, "20 active SDK keys"],
        [
          [...sdkArgs, "--revoke", sdkKey],
          { _tag: "SdkKeyNotFound", key: sdkKey },
          404,
          "See its keys: ./cluenori component sdk-keys folio notes-api",
        ],
        [[...sdkArgs, "--revoke", sdkKey], projectMissing, 404, "has no project folio"],
        [ingestArgs, projectMissing, 404, "has no project folio"],
        [ingestArgs, componentMissing, 404, "has no component notes-api"],
        [ingestArgs, { _tag: "NotAllowed" }, 403, "Only an owner manages ingest keys."],
        [[...ingestArgs, "--new", "blue"], { _tag: "IngestKeyRefused", reason: "tooMany" }, 409, "10 keys that work"],
        [
          [...ingestArgs, "--new", "blue"],
          { _tag: "IngestKeyRefused", reason: "expiryPast" },
          409,
          "That key would expire at once.",
        ],
        [
          [...ingestArgs, "--revoke", keyId],
          { _tag: "IngestKeyNotFound", key: keyId },
          404,
          "See them: ./cluenori component ingest-keys folio notes-api",
        ],
        [[...ingestArgs, "--revoke", keyId], projectMissing, 404, "has no project folio"],
        [[...ingestArgs, "--revoke", keyId], { _tag: "NotAllowed" }, 403, "Only an owner manages ingest keys."],
        [sdkArgs, { _tag: "Unauthorized", message: "Token expired" }, 401, "refused the API token: Token expired"],
        [ingestArgs, { keys: "invalid" }, 200, "answered in a way this CLI doesn't expect"],
      ] as const) {
        const answer = yield* run(argv, () => Response.json(body, { status }))
        assert.strictEqual(answer.result._tag, "Failure")
        assert.strictEqual(answer.requests.length, 1)
        assert.strictEqual(answer.output, "")
        assert.include(answer.errors, expected)
      }
    }),
  )
})

describe("project commands", () => {
  it.effect("creates a named project and reports an existing key without pretending creation succeeded", () =>
    Effect.gen(function* () {
      const argv = ["project", "create", "folio", "--name", "Folio Notes"]
      const answer = yield* run(argv, () => Response.json(detail.project, { status: 201 }))
      assert.strictEqual(answer.result._tag, "Success")
      assert.strictEqual(answer.errors, "")
      assert.deepStrictEqual(
        answer.requests.map((request) => [request.method, request.url]),
        [["POST", "https://cluenori.example/api/projects"]],
      )
      const request = answer.requests[0]
      assert(request !== undefined)
      assert.deepStrictEqual(yield* Effect.promise(() => request.json()), { key: "folio", name: "Folio Notes" })
      assert.include(answer.output, "Created Folio Notes (folio) on https://cluenori.example.")
      assert.include(answer.output, "./cluenori component add folio <key> --name <name>")
      const exists = yield* run(argv, () => Response.json({ _tag: "ProjectExists", project: "folio" }, { status: 409 }))
      assert.strictEqual(exists.result._tag, "Failure")
      assert.strictEqual(exists.requests.length, 1)
      assert.strictEqual(exists.output, "")
      assert.include(exists.errors, "already has a project with the key folio")
    }),
  )

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
