import { BunCrypto } from "@effect/platform-bun"
import { assert, describe, it } from "@effect/vitest"
import { ConfigProvider, Console, Effect, FileSystem, Layer, Path, Stdio, Terminal } from "effect"
import { Command } from "effect/cli"
import { FetchHttpClient } from "effect/http"
import { ChildProcessSpawner } from "effect/process"

import { phone, phones } from "../src/phones-commands.ts"

const root = Command.make("cluenori").pipe(Command.withSubcommands([phones, phone]))
const id = "01960000-0000-7000-8000-000000000001"
const otherId = "01960000-0000-7000-8000-000000000002"
const at = "2026-10-19T09:00:00.000Z"
const paired = {
  id,
  model: "iPhone17,2",
  modelName: "iPhone 16 Pro Max",
  systemVersion: "27.2",
  appVersion: "1.4.0",
  pairedAt: at,
}

// The real parser, typed client and response schemas; only external seams are fake.
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
            readInput: Effect.die("Phone commands must not prompt"),
            readLine: Effect.die("Phone commands must not prompt"),
            display: () => Effect.void,
          }),
        ),
        Layer.succeed(
          ChildProcessSpawner.ChildProcessSpawner,
          ChildProcessSpawner.make(() => Effect.die("Phone commands must not start programs")),
        ),
      ),
    ),
  )
  return { result, requests, output: output.join("\n"), errors: errors.join("\n") }
})

describe("phone commands", () => {
  it.effect("lists versions and last contact without inventing missing times or location parts", () =>
    Effect.gen(function* () {
      const empty = yield* run(["phones"], () => Response.json({ phones: [] }))
      assert.strictEqual(empty.result._tag, "Success")
      assert.strictEqual(
        empty.output,
        "No phones are paired with https://cluenori.example. Pair one: ./cluenori phone pair",
      )
      const answer = yield* run(["phones"], () =>
        Response.json({
          phones: [
            paired,
            { ...paired, id: otherId, lastSeen: { at, address: "192.0.2.42", country: "PL" } },
            { ...paired, lastSeen: { at, country: "DE" } },
            { ...paired, lastSeen: { at, address: "198.51.100.7" } },
            { ...paired, lastSeen: { at } },
          ],
        }),
      )
      assert.strictEqual(answer.result._tag, "Success")
      assert.match(answer.output, /^Phone\s+iOS\s+App\s+Last seen\s+From\s+ID\n/)
      const rows = answer.output
        .split("\n")
        .slice(1)
        .map((row) => row.trim().replace(/ +/g, " "))
      assert.deepStrictEqual(rows, [
        `iPhone 16 Pro Max 27.2 1.4.0 not yet ${id}`,
        `iPhone 16 Pro Max 27.2 1.4.0 2026-10-19 09:00 UTC 192.0.2.42, PL ${otherId}`,
        `iPhone 16 Pro Max 27.2 1.4.0 2026-10-19 09:00 UTC DE ${id}`,
        `iPhone 16 Pro Max 27.2 1.4.0 2026-10-19 09:00 UTC 198.51.100.7 ${id}`,
        `iPhone 16 Pro Max 27.2 1.4.0 2026-10-19 09:00 UTC ${id}`,
      ])
      assert.strictEqual(answer.requests.length, 1)
      assert.strictEqual(answer.requests[0]?.url, "https://cluenori.example/api/phones")
      assert.strictEqual(answer.requests[0]?.method, "GET")
    }),
  )

  it.effect("starts pairing, removes the named phone and sends alerts to the explicit or sole phone", () =>
    Effect.gen(function* () {
      const link = "cluenori://pair?url=https%3A%2F%2Fcluenori.example&code=made-up-pairing-code"
      for (const [args, method, path, expected] of [
        [
          ["phone", "pair"],
          "POST",
          "/api/phones/pairings",
          `by 2026-10-19 09:00 UTC. It pairs one phone, for you:\n\n${link}`,
        ],
        [
          ["phone", "remove", otherId],
          "DELETE",
          `/api/phones/${otherId}`,
          "Removed the phone. Its key stopped working",
        ],
        [["phone", "test-alert", otherId], "POST", `/api/phones/${otherId}/test-alert`, "APNs took the test alarm"],
        [["phone", "test-alert"], "POST", `/api/phones/${id}/test-alert`, "APNs took the test alarm"],
      ] as const) {
        for (const local of [false, true]) {
          const answer = yield* run([...args, ...(local ? ["--local"] : [])], (request) => {
            if (request.method === "GET") {
              return Response.json({ phones: [paired] })
            }
            return path.endsWith("pairings")
              ? Response.json({ link, expiresAt: at }, { status: 201 })
              : new Response(null, { status: 204 })
          })
          assert.strictEqual(answer.result._tag, "Success")
          const origin = local ? "http://localhost:8787" : "https://cluenori.example"
          assert.deepStrictEqual(
            answer.requests.map((request) => [request.method, request.url]),
            [
              ...(args.length === 2 && args[1] === "test-alert" ? [["GET", `${origin}/api/phones`]] : []),
              [method, `${origin}${path}`],
            ],
          )
          assert.isTrue(
            answer.requests.every(
              (request) => request.headers.get("authorization") === `Bearer made-up-${local ? "local-token" : "token"}`,
            ),
          )
          assert.include(answer.output, expected)
          assert.strictEqual(answer.errors, "")
        }
      }
    }),
  )

  it.effect("refuses ambiguous or absent alert targets and malformed IDs without sending an alert", () =>
    Effect.gen(function* () {
      for (const [listed, expected] of [
        [[], "No phones are paired with https://cluenori.example. Pair one: ./cluenori phone pair"],
        [
          [paired, { ...paired, id: otherId }],
          "More than one phone is paired: give the ID of one, from ./cluenori phones.",
        ],
      ] as const) {
        const answer = yield* run(["phone", "test-alert"], () => Response.json({ phones: listed }))
        assert.strictEqual(answer.result._tag, "Failure")
        assert.deepStrictEqual(
          answer.requests.map((request) => request.method),
          ["GET"],
        )
        assert.strictEqual(answer.errors, expected)
        assert.strictEqual(answer.output, "")
      }
      for (const command of ["remove", "test-alert"]) {
        const answer = yield* run(["phone", command, "bad-id"], () => new Response(null, { status: 204 }))
        assert.strictEqual(answer.result._tag, "Failure")
        assert.isEmpty(answer.requests)
        assert.include(answer.errors, "\"bad-id\" isn't a phone's ID:")
        assert.strictEqual(answer.output, "")
      }
    }),
  )

  it.effect("explains refused removals and APNs failures without announcing success", () =>
    Effect.gen(function* () {
      const missing = yield* run(["phone", "remove", id], () =>
        Response.json({ _tag: "PhoneNotFound", phone: id }, { status: 404 }),
      )
      assert.strictEqual(missing.result._tag, "Failure")
      assert.strictEqual(missing.errors, `https://cluenori.example has no phone ${id}. See them: ./cluenori phones`)
      assert.strictEqual(missing.output, "")
      for (const [body, status, expected] of [
        [{ _tag: "PushNotSetUp" }, 409, "Push isn't set up on https://cluenori.example: ./cluenori push setup"],
        [{ _tag: "NoPushToken", phone: id }, 409, "That phone hasn't registered for pushes: open the Cluenori app"],
        [
          { _tag: "PushUnavailable", reason: "Connection reset" },
          503,
          "APNs didn't take the test alarm now (Connection reset). Try again in a minute.",
        ],
        ...[
          ["BadDeviceToken", "other APNs"],
          ["InvalidProviderToken", "key ID or the team ID is wrong"],
          ["InvalidSigningKey", "isn't an APNs key"],
          ["TopicDisallowed", "team doesn't own the app"],
          ["BadTopic", "bundle ID is wrong"],
          ["UnknownAppleReason", ""],
        ].map(
          ([reason, hint]) =>
            [{ _tag: "PushRejected", reason }, 502, hint || `APNs refused the test alarm: ${reason}.`] as const,
        ),
      ] as const) {
        const answer = yield* run(["phone", "test-alert", id], () => Response.json(body, { status }))
        assert.strictEqual(answer.result._tag, "Failure")
        assert.strictEqual(answer.requests.length, 1)
        assert.include(answer.errors, expected.trim())
        if (body._tag === "PushRejected") {
          assert.include(answer.errors, `APNs refused the test alarm: ${body.reason}.`)
        }
        assert.strictEqual(answer.output, "")
        assert.notInclude(answer.errors, "undefined")
      }
    }),
  )

  it.effect("stops every command on unauthorized or malformed API answers, including automatic target lookup", () =>
    Effect.gen(function* () {
      for (const args of [
        ["phones"],
        ["phone", "pair"],
        ["phone", "remove", id],
        ["phone", "test-alert", id],
        ["phone", "test-alert"],
      ]) {
        const answer = yield* run(args, () =>
          Response.json({ _tag: "Unauthorized", message: "Token expired" }, { status: 401 }),
        )
        assert.strictEqual(answer.result._tag, "Failure")
        assert.strictEqual(answer.requests.length, 1)
        assert.include(answer.errors, "refused the API token: Token expired")
        assert.strictEqual(answer.output, "")
      }
      for (const args of [["phones"], ["phone", "pair"], ["phone", "test-alert"]]) {
        const answer = yield* run(args, () =>
          Response.json({ phones: "not a list" }, { status: args[1] === "pair" ? 201 : 200 }),
        )
        assert.strictEqual(answer.result._tag, "Failure")
        assert.strictEqual(answer.requests.length, 1)
        assert.include(answer.errors, "answered in a way this CLI doesn't expect")
        assert.strictEqual(answer.output, "")
      }
      const local = yield* run(["phones", "--local"], () => Response.json({ phones: [] }))
      assert.strictEqual(local.result._tag, "Success")
      assert.strictEqual(local.requests[0]?.url, "http://localhost:8787/api/phones")
      assert.strictEqual(local.requests[0]?.headers.get("authorization"), "Bearer made-up-local-token")
      assert.include(local.output, "No phones are paired with http://localhost:8787.")
    }),
  )
})
