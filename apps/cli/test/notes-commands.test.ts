import { defaultNotesStyle } from "@cluenori/releases"
import { BunCrypto } from "@effect/platform-bun"
import { assert, describe, it } from "@effect/vitest"
import { ConfigProvider, Console, Effect, FileSystem, Layer, Path, Stdio, Terminal } from "effect"
import { Command } from "effect/cli"
import { FetchHttpClient } from "effect/http"
import { ChildProcessSpawner } from "effect/process"

import { notes, notesStyle } from "../src/notes-commands.ts"

const root = Command.make("cluenori").pipe(Command.withSubcommands([notes, notesStyle]))
const args = ["notes", "folio", "notes-ios", "1.4.0+58"]
const path = "/api/projects/folio/releases/notes-ios/1.4.0%2B58"
const english = { locale: "en-US", text: "Faster exports.\n\nFixed search." }
const german = { locale: "de-DE", text: "Schneller exportieren." }
const detail = {
  summary: {
    component: "notes-ios",
    release: "1.4.0+58",
    verdict: "unmeasured",
    slower: 0,
    failingMore: 0,
    newErrors: 0,
  },
  slower: [],
  failingMore: [],
  faster: [],
  failingLess: [],
  newOperations: [],
  errors: [],
  incidents: [],
  problems: [],
  promotions: [],
  deployTargets: [],
  notes: [english, german],
}

// The real command parser and typed HTTP client; only external seams are fake.
const run = Effect.fnUntraced(function* (
  command: ReadonlyArray<string>,
  answer: (request: Request) => Response | Promise<Response>,
  files: Readonly<Record<string, string>> = {},
) {
  const requests: Array<Request> = []
  const output: Array<string> = []
  const errors: Array<string> = []
  const current = yield* Console.Console
  const result = yield* Command.runWith(root, { version: "test" })(command).pipe(
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
          exists: (name) =>
            Effect.succeed(name === "/test-config/cluenori/deployment.json" || name === "apps/worker/.dev.vars"),
          readFileString: (name) => {
            if (name === "apps/worker/.dev.vars") {
              return Effect.succeed(
                "CLUENORI_API_TOKEN=made-up-local-token\nCLUENORI_OWNER=01960000-0000-7000-8000-000000000001\nCLUENORI_PLAIN_HTTP=local\n",
              )
            }
            if (name === "/test-config/cluenori/deployment.json") {
              return Effect.succeed(
                JSON.stringify({ jurisdiction: "eu", url: "https://cluenori.example", token: "made-up-token" }),
              )
            }
            return Effect.succeed(files[name] ?? "")
          },
        }),
        Path.layer,
        Stdio.layerTest({}),
        Layer.succeed(
          Terminal.Terminal,
          Terminal.make({
            columns: Effect.succeed(120),
            rows: Effect.succeed(40),
            readInput: Effect.die("Notes commands must not prompt"),
            readLine: Effect.die("Notes commands must not prompt"),
            display: () => Effect.void,
          }),
        ),
        Layer.succeed(
          ChildProcessSpawner.ChildProcessSpawner,
          ChildProcessSpawner.make(() => Effect.die("Notes commands must not start programs")),
        ),
      ),
    ),
  )
  return { result, requests, output: output.join("\n"), errors: errors.join("\n") }
})

describe("release notes commands", () => {
  it.effect("reads every saved language without writing and explains an empty release", () =>
    Effect.gen(function* () {
      for (const saved of [[], [english], [english, german]]) {
        const answer = yield* run(args, () => Response.json({ ...detail, notes: saved }))
        assert.strictEqual(answer.result._tag, "Success")
        assert.deepStrictEqual(
          answer.requests.map((request) => [request.method, request.url]),
          [["GET", `https://cluenori.example${path}`]],
        )
        if (saved.length === 0) {
          assert.include(answer.output, "has no notes yet")
          assert.include(answer.output, "./cluenori notes folio notes-ios 1.4.0+58 --draft <environment>")
        } else {
          assert.include(answer.output, saved.length === 1 ? "in 1 language:" : "in 2 languages:")
          assert.include(answer.output, "en-US:\n  Faster exports.\n\n  Fixed search.")
          assert.strictEqual(answer.output.includes("de-DE:\n  Schneller exportieren."), saved.length === 2)
        }
        assert.strictEqual(answer.errors, "")
      }
    }),
  )

  it.effect("replaces only the chosen language or appends it, reading files and stdin with edge space removed", () =>
    Effect.gen(function* () {
      for (const [flags, locale, expected] of [
        [["--text", "New English."], "en-US", [{ locale: "en-US", text: "New English." }, german]],
        [["--file", "notes.txt"], "de-DE", [english, { locale: "de-DE", text: "New German.\n\nKeep this line." }]],
        [["--file", "-"], "fr-FR", [english, german, { locale: "fr-FR", text: "New French." }]],
      ] as const) {
        const answer = yield* run(
          [...args, "--locale", locale, ...flags, "--local"],
          (request) => Response.json(request.method === "GET" ? detail : [german, english]),
          { "notes.txt": " \nNew German.\n\nKeep this line.\n ", "/dev/stdin": "\tNew French.\n" },
        )
        assert.strictEqual(answer.result._tag, "Success")
        assert.deepStrictEqual(
          answer.requests.map((request) => [request.method, request.url]),
          [
            ["GET", `http://localhost:8787${path}`],
            ["PUT", `http://localhost:8787${path}/notes`],
          ],
        )
        const write = answer.requests[1]
        assert(write !== undefined)
        const payload = yield* Effect.promise(() => write.json())
        assert.deepStrictEqual(payload, { notes: expected })
        assert.isTrue(
          answer.requests.every((request) => request.headers.get("authorization") === "Bearer made-up-local-token"),
        )
        assert.include(answer.output, `Saved the ${locale} note of 1.4.0+58 of notes-ios`)
        assert.strictEqual(answer.output.includes(", in place of the one it had"), locale !== "fr-FR")
        assert.include(answer.output, "Its notes are in de-DE, en-US.")
      }
    }),
  )

  it.effect("drafts for the selected environment but saves the returned languages only with --save", () =>
    Effect.gen(function* () {
      for (const save of [false, true]) {
        for (const since of [undefined, "1.3.0+40"]) {
          const draft = {
            notes: [german, english],
            commits: since === undefined ? 1 : 3,
            ...(since === undefined ? {} : { since }),
          }
          const answer = yield* run([...args, "--draft", "staging", ...(save ? ["--save"] : [])], (request) =>
            Response.json(request.method === "POST" ? draft : [english]),
          )
          assert.strictEqual(answer.result._tag, "Success")
          assert.deepStrictEqual(
            answer.requests.map((request) => [request.method, request.url]),
            [
              ["POST", `https://cluenori.example${path}/notes/draft`],
              ...(save ? [["PUT", `https://cluenori.example${path}/notes`]] : []),
            ],
          )
          const draftRequest = answer.requests[0]
          assert(draftRequest !== undefined)
          assert.deepStrictEqual(yield* Effect.promise(() => draftRequest.json()), { environment: "staging" })
          assert.include(
            answer.output,
            since === undefined ? "1 commit, with no release in staging before it" : "since 1.3.0+40, 3 commits",
          )
          assert.include(
            answer.output,
            "de-DE:\n  Schneller exportieren.\n\nen-US:\n  Faster exports.\n\n  Fixed search.",
          )
          if (save) {
            const write = answer.requests[1]
            assert(write !== undefined)
            assert.deepStrictEqual(yield* Effect.promise(() => write.json()), { notes: draft.notes })
            assert.include(answer.output, "Saved as the notes of 1.4.0+58, in 1 language, in place of those it had.")
            assert.notInclude(answer.output, "Nothing is saved")
          } else {
            assert.include(answer.output, "Nothing is saved.")
            assert.notInclude(answer.output, "Saved as the notes")
          }
        }
      }
    }),
  )

  it.effect("refuses conflicting flags and invalid notes before HTTP", () =>
    Effect.gen(function* () {
      for (const [flags, expected] of [
        [["--draft", "production", "--locale", "en-US"], "--draft writes every language at once"],
        [["--draft", "production", "--text", "note"], "--draft writes every language at once"],
        [["--draft", "production", "--file", "notes.txt"], "--draft writes every language at once"],
        [["--save"], "--save saves a draft"],
        [["--text", "note"], "Say which language"],
        [["--file", "notes.txt"], "Say which language"],
        [["--locale", "en-US"], "Give the en-US note"],
        [["--locale", "en-US", "--text", "note", "--file", "notes.txt"], "not both"],
        [["--locale", "en-US", "--text", ""], "The en-US note can't be saved"],
        [["--locale", "en-US", "--text", "x".repeat(4001)], "The en-US note can't be saved"],
        [["--locale", "en-US", "--file", "empty.txt"], "The en-US note can't be saved"],
        [["--locale", "invalid", "--text", "note"], "isn't a language"],
        [["--draft", "Invalid key"], "isn't an environment key"],
      ] as const) {
        const answer = yield* run([...args, ...flags], () => Response.json(detail), { "empty.txt": " \n " })
        assert.strictEqual(answer.result._tag, "Failure")
        assert.isEmpty(answer.requests)
        assert.include(answer.errors, expected)
        assert.strictEqual(answer.output, "")
      }
    }),
  )

  it.effect("reports API refusals at reads, drafts and saves without claiming a successful save", () =>
    Effect.gen(function* () {
      for (const flags of [[], ["--draft", "production"], ["--locale", "en-US", "--text", "note"]]) {
        for (const [body, status, expected] of [
          [{ _tag: "ProjectNotFound", project: "folio" }, 404, "has no project folio"],
          [
            { _tag: "ReleaseNotFound", component: "notes-ios", release: "1.4.0+58" },
            404,
            "has no release 1.4.0+58 of notes-ios",
          ],
          [{ _tag: "Unauthorized", message: "Token expired" }, 401, "refused the API token: Token expired"],
          [{ invalid: true }, 200, "answered in a way this CLI doesn't expect"],
        ] as const) {
          const answer = yield* run([...args, ...flags], () => Response.json(body, { status }))
          assert.strictEqual(answer.result._tag, "Failure")
          assert.strictEqual(answer.requests.length, 1)
          assert.include(answer.errors, expected)
          assert.strictEqual(answer.output, "")
        }
      }
      const unavailable = yield* run([...args, "--draft", "production"], () =>
        Response.json({ _tag: "DraftUnavailable", reason: "No commits yet" }, { status: 503 }),
      )
      assert.strictEqual(unavailable.result._tag, "Failure")
      assert.include(unavailable.errors, "No draft: No commits yet")
      for (const drafting of [false, true]) {
        const answer = yield* run(
          [...args, ...(drafting ? ["--draft", "production", "--save"] : ["--locale", "en-US", "--text", "note"])],
          (request) =>
            request.method === "PUT"
              ? Response.json({ _tag: "ProjectNotFound", project: "folio" }, { status: 404 })
              : Response.json(drafting ? { notes: [english], commits: 2 } : detail),
        )
        assert.strictEqual(answer.result._tag, "Failure")
        assert.strictEqual(answer.requests.length, 2)
        assert.include(answer.errors, "has no project folio")
        assert.notInclude(answer.output, "Saved")
      }
    }),
  )

  it.effect("reads the default or custom notes style and writes only a valid explicit style", () =>
    Effect.gen(function* () {
      for (const style of [defaultNotesStyle, "Short sentences."]) {
        const answer = yield* run(["notes-style", "folio"], () => Response.json({ style }))
        assert.strictEqual(answer.result._tag, "Success")
        assert.strictEqual(answer.requests[0]?.method, "GET")
        assert.strictEqual(answer.requests[0]?.url, "https://cluenori.example/api/projects/folio/notes-style")
        assert.strictEqual(
          answer.output.includes("(Cluenori's default, until you set one)"),
          style === defaultNotesStyle,
        )
        assert.include(answer.output, `\n\n  ${style}`)
      }
      const answer = yield* run(["notes-style", "folio", "--set", "Plain words.", "--local"], () =>
        Response.json({ style: "Confirmed style." }),
      )
      assert.strictEqual(answer.result._tag, "Success")
      assert.strictEqual(answer.requests.length, 1)
      assert.strictEqual(answer.requests[0]?.url, "http://localhost:8787/api/projects/folio/notes-style")
      assert.strictEqual(answer.requests[0]?.method, "PUT")
      const write = answer.requests[0]
      assert(write !== undefined)
      assert.deepStrictEqual(yield* Effect.promise(() => write.json()), { style: "Plain words." })
      assert.include(
        answer.output,
        "Set how folio's release notes read; drafts follow it from now on:\n\n  Confirmed style.",
      )
      for (const style of ["", " padded ", "x".repeat(2001)]) {
        const invalid = yield* run(["notes-style", "folio", "--set", style], () => Response.json({ style }))
        assert.strictEqual(invalid.result._tag, "Failure")
        assert.isEmpty(invalid.requests)
        assert.include(invalid.errors, "That notes style can't be set")
      }
    }),
  )
})
