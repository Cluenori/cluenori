import { BunCrypto } from "@effect/platform-bun"
import { assert, describe, it } from "@effect/vitest"
import { ConfigProvider, Console, Effect, FileSystem, Layer, Path, Stdio, Terminal } from "effect"
import { Command } from "effect/cli"
import { FetchHttpClient } from "effect/http"
import { ChildProcessSpawner } from "effect/process"

import { member, members } from "../src/members-commands.ts"

const root = Command.make("cluenori").pipe(Command.withSubcommands([members, member]))
const id = "01960000-0000-7000-8000-000000000001"
const at = "2026-10-19T09:00:00.000Z"
const reader = {
  id,
  role: "member",
  email: "reader@example.com",
  projects: ["notes", "atlas"],
  passkeys: 2,
  addedAt: at,
}

// The real parser, typed API client and response schemas; only external seams are fake.
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
            readInput: Effect.die("Member commands must not prompt"),
            readLine: Effect.die("Member commands must not prompt"),
            display: () => Effect.void,
          }),
        ),
        Layer.succeed(
          ChildProcessSpawner.ChildProcessSpawner,
          ChildProcessSpawner.make(() => Effect.die("Member commands must not start programs")),
        ),
      ),
    ),
  )
  return { result, requests, output: output.join("\n"), errors: errors.join("\n") }
})

describe("member commands", () => {
  it.effect("lists member access without confusing no projects with every project", () =>
    Effect.gen(function* () {
      const answer = yield* run(["members"], () =>
        Response.json({
          members: [
            { id, role: "owner", passkeys: 1, addedAt: at },
            reader,
            { ...reader, email: "restricted@example.com", projects: [], passkeys: 0 },
          ],
        }),
      )
      assert.strictEqual(answer.result._tag, "Success")
      assert.strictEqual(answer.errors, "")
      assert.deepStrictEqual(
        answer.requests.map((request) => [request.method, request.url]),
        [["GET", "https://cluenori.example/api/members"]],
      )
      const rows = answer.output.split("\n").map((row) => row.trim().replace(/ +/g, " "))
      assert.deepStrictEqual(rows, [
        "Member Role Sees Passkeys Added ID",
        `you owner every project 1 2026-10-19 09:00 UTC ${id}`,
        `reader@example.com member notes, atlas 2 2026-10-19 09:00 UTC ${id}`,
        `restricted@example.com member 0 2026-10-19 09:00 UTC ${id}`,
      ])
      for (const local of [false, true]) {
        const empty = yield* run(["members", ...(local ? ["--local"] : [])], () => Response.json({ members: [] }))
        assert.strictEqual(empty.result._tag, "Success")
        assert.match(empty.output, /^Member\s+Role\s+Sees\s+Passkeys\s+Added\s+ID$/)
        assert.deepStrictEqual(
          empty.requests.map((request) => [request.method, request.url, request.headers.get("authorization")]),
          [
            [
              "GET",
              `${local ? "http://localhost:8787" : "https://cluenori.example"}/api/members`,
              `Bearer made-up-${local ? "local-token" : "token"}`,
            ],
          ],
        )
      }
    }),
  )

  it.effect("normalizes invitations and sends exactly the projects requested to the chosen deployment", () =>
    Effect.gen(function* () {
      for (const local of [false, true]) {
        const link = "https://cluenori.example/invite#made-up-code"
        const answer = yield* run(
          ["member", "invite", " Reader@Example.COM ", "--projects", " notes, ,atlas, ", ...(local ? ["--local"] : [])],
          () => Response.json({ link, expiresAt: at }, { status: 201 }),
        )
        assert.strictEqual(answer.result._tag, "Success")
        assert.strictEqual(answer.errors, "")
        assert.strictEqual(answer.requests.length, 1)
        const request = answer.requests[0]
        assert(request !== undefined)
        assert.strictEqual(request.method, "POST")
        assert.strictEqual(
          request.url,
          `${local ? "http://localhost:8787" : "https://cluenori.example"}/api/members/invites`,
        )
        assert.strictEqual(request.headers.get("authorization"), `Bearer made-up-${local ? "local-token" : "token"}`)
        assert.deepStrictEqual(yield* Effect.promise(() => request.json()), {
          email: "reader@example.com",
          projects: ["notes", "atlas"],
        })
        assert.include(
          answer.output,
          `Send reader@example.com this link, by 2026-10-19 09:00 UTC. It makes their passkey and signs them in, once:\n\n${link}`,
        )
      }
    }),
  )

  it.effect("sets access including an empty project list and removes the named member", () =>
    Effect.gen(function* () {
      for (const projects of [["notes", "atlas"], []]) {
        const answer = yield* run(["member", "projects", id, "--projects", projects.join(",")], () =>
          Response.json({ ...reader, projects }),
        )
        assert.strictEqual(answer.result._tag, "Success")
        assert.strictEqual(answer.requests.length, 1)
        const request = answer.requests[0]
        assert(request !== undefined)
        assert.strictEqual(request.method, "PUT")
        assert.strictEqual(request.url, `https://cluenori.example/api/members/${id}/projects`)
        assert.deepStrictEqual(yield* Effect.promise(() => request.json()), { projects })
        assert.strictEqual(
          answer.output,
          `reader@example.com sees ${projects.length === 0 ? "no project" : "notes, atlas"}.`,
        )
        assert.strictEqual(answer.errors, "")
      }
      const removed = yield* run(["member", "remove", id], () => new Response(null, { status: 204 }))
      assert.strictEqual(removed.result._tag, "Success")
      assert.deepStrictEqual(
        removed.requests.map((request) => [request.method, request.url]),
        [["DELETE", `https://cluenori.example/api/members/${id}`]],
      )
      assert.strictEqual(
        removed.output,
        "Removed. Their passkeys, their browsers' sign-ins and their phones stopped working.",
      )
      assert.strictEqual(removed.errors, "")
    }),
  )

  it.effect("rejects malformed identifiers and empty invitations before making an API call", () =>
    Effect.gen(function* () {
      for (const [args, message] of [
        [["member", "invite", "not-an-email", "--projects", "notes"], "isn't an email address"],
        [
          ["member", "invite", "reader@example.com", "--projects", " , , "],
          "Name the projects they see: --projects notes,atlas",
        ],
        [["member", "invite", "reader@example.com", "--projects", "notes,Not a key"], "isn't a project key"],
        [["member", "projects", "bad-id", "--projects", "notes"], "isn't a member's ID"],
        [["member", "projects", id, "--projects", "Not a key"], "isn't a project key"],
        [["member", "remove", "bad-id"], "isn't a member's ID"],
      ] as const) {
        const answer = yield* run(args, () => Response.json({}))
        assert.strictEqual(answer.result._tag, "Failure")
        assert.isEmpty(answer.requests)
        assert.include(answer.errors, message)
        assert.strictEqual(answer.output, "")
      }
    }),
  )

  it.effect("explains permission and missing-record failures without claiming a write succeeded", () =>
    Effect.gen(function* () {
      for (const [args, body, status, message] of [
        [["members"], { _tag: "NotAllowed" }, 403, "Only an owner sees the members."],
        [
          ["member", "invite", "reader@example.com", "--projects", "notes"],
          { _tag: "NotAllowed" },
          403,
          "Only an owner invites.",
        ],
        [
          ["member", "invite", "reader@example.com", "--projects", "notes"],
          { _tag: "MemberExists", email: "reader@example.com" },
          409,
          "reader@example.com is a member already. To invite them again, remove them first.",
        ],
        [
          ["member", "invite", "reader@example.com", "--projects", "notes"],
          { _tag: "ProjectNotFound", project: "notes" },
          404,
          "https://cluenori.example has no project notes.",
        ],
        [
          ["member", "projects", id, "--projects", "notes"],
          { _tag: "NotAllowed" },
          403,
          "Only an owner changes what a member sees, and an owner sees everything.",
        ],
        [
          ["member", "projects", id, "--projects", "notes"],
          { _tag: "MemberNotFound", member: id },
          404,
          `https://cluenori.example has no member ${id}. See them: ./cluenori members`,
        ],
        [
          ["member", "projects", id, "--projects", "notes"],
          { _tag: "ProjectNotFound", project: "notes" },
          404,
          "https://cluenori.example has no project notes.",
        ],
        [
          ["member", "remove", id],
          { _tag: "NotAllowed" },
          403,
          "Only an owner removes members, and an owner can't be removed.",
        ],
        [
          ["member", "remove", id],
          { _tag: "MemberNotFound", member: id },
          404,
          `https://cluenori.example has no member ${id}. See them: ./cluenori members`,
        ],
      ] as const) {
        const answer = yield* run(args, () => Response.json(body, { status }))
        assert.strictEqual(answer.result._tag, "Failure")
        assert.strictEqual(answer.requests.length, 1)
        assert.strictEqual(answer.errors, message)
        assert.strictEqual(answer.output, "")
      }
    }),
  )

  it.effect("stops every command on refused tokens or malformed API answers", () =>
    Effect.gen(function* () {
      for (const [args, successStatus] of [
        [["members"], 200],
        [["member", "invite", "reader@example.com", "--projects", "notes"], 201],
        [["member", "projects", id, "--projects", "notes"], 200],
        [["member", "remove", id], 204],
      ] as const) {
        for (const unauthorized of [true, false]) {
          if (!unauthorized && successStatus === 204) continue
          const answer = yield* run(args, () =>
            unauthorized
              ? Response.json({ _tag: "Unauthorized", message: "Token expired" }, { status: 401 })
              : Response.json({ invalid: true }, { status: successStatus }),
          )
          assert.strictEqual(answer.result._tag, "Failure")
          assert.strictEqual(answer.requests.length, 1)
          assert.include(
            answer.errors,
            unauthorized ? "refused the API token: Token expired" : "answered in a way this CLI doesn't expect",
          )
          assert.strictEqual(answer.output, "")
        }
      }
    }),
  )
})
