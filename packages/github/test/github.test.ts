import { assert, describe, it } from "@effect/vitest"
import { DateTime, Effect, Fiber, Layer, Option, Redacted, Schema } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import { TestClock } from "effect/testing"

import type { GitHubRefused, GitHubUnavailable } from "../src/index.ts"
import { CommitSha, GitHub, Repository } from "../src/index.ts"
import {
  commitJson,
  comparisonJson,
  errorJson,
  pullRequestJson,
  shas,
  singleCommitJson,
  tagJson,
} from "./github-answers.ts"

// The runtime's `Response`, which tests outside a runtime with its types can't name: the part these
// tests use.
declare const Response: new (
  body: string | null,
  init: { readonly status: number; readonly headers?: Readonly<Record<string, string>> },
) => object

interface Asked {
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
}

interface FakeAnswer {
  readonly status: number
  readonly body?: unknown
  readonly headers?: Readonly<Record<string, string>>
}

const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))

const notFound: FakeAnswer = { status: 404, body: errorJson("Not Found", 404) }

// A fake GitHub: answers each path and query in `answers`, anything else 404 as GitHub does, and
// keeps what it was asked.
const fakeGitHub = (answers: Readonly<Record<string, FakeAnswer | "no answer">>) => {
  const asked: Array<Asked> = []
  const client = HttpClient.make((request, url) =>
    Effect.gen(function* () {
      asked.push({ url: url.href, headers: request.headers })
      const answer = answers[`${url.pathname}${url.search}`] ?? notFound
      if (answer === "no answer") {
        return yield* Effect.never
      }
      const body = answer.body === undefined ? null : yield* encodeJson(answer.body).pipe(Effect.orDie)
      return HttpClientResponse.fromWeb(
        request,
        new Response(body, {
          status: answer.status,
          headers: { "content-type": "application/json; charset=utf-8", ...answer.headers },
        }),
      )
    }),
  )
  return { asked, layer: Layer.succeed(HttpClient.HttpClient, client) }
}

const token = "test-token-not-a-real-one"
const repository = Repository.make("octocat/Hello-World")
const repo = "/repos/octocat/Hello-World"
const visibleRepository: FakeAnswer = { status: 200, body: { id: 1296269, full_name: "octocat/Hello-World" } }

// An error's tag and fields, as plain data.
const factsOf = (error: GitHubRefused | GitHubUnavailable) =>
  error._tag === "GitHubRefused"
    ? { _tag: error._tag, status: error.status, reason: error.reason }
    : {
        _tag: error._tag,
        reason: error.reason,
        ...(error.retryAfter === undefined ? {} : { retryAfter: error.retryAfter }),
      }

// Runs `program` with GitHub's API answered by `github`.
const withGitHub = <A, E>(github: ReturnType<typeof fakeGitHub>, program: Effect.Effect<A, E, GitHub>) =>
  program.pipe(Effect.provide(GitHub.layer({ token: Redacted.make(token) }).pipe(Layer.provide(github.layer))))

describe("GitHub", () => {
  it.effect(
    "lists the tags containing a version, annotated or not, with their commits, highest first, in one request",
    () =>
      Effect.gen(function* () {
        const github = fakeGitHub({
          [`${repo}/tags?per_page=100`]: {
            status: 200,
            body: [
              // Annotated: `/tags` names the commit it points to, not the tag object.
              tagJson("v2.4.0", shas.released),
              tagJson("v2.4.0-rc.1", shas.candidate),
              tagJson("v12.4.0", shas.fix),
              tagJson("v1.0.0", shas.old),
              tagJson("ios-v2.4.0", shas.released),
            ],
          },
        })
        const tags = yield* withGitHub(
          github,
          Effect.gen(function* () {
            const gitHub = yield* GitHub
            return yield* gitHub.tagsContaining(repository, "2.4.0")
          }),
        )

        assert.deepStrictEqual(tags, [
          { name: "v12.4.0", commit: CommitSha.make(shas.fix) },
          { name: "v2.4.0-rc.1", commit: CommitSha.make(shas.candidate) },
          { name: "v2.4.0", commit: CommitSha.make(shas.released) },
          { name: "ios-v2.4.0", commit: CommitSha.make(shas.released) },
        ])
        assert.strictEqual(github.asked.length, 1)
        const asked = github.asked[0]
        assert.strictEqual(asked?.url, "https://api.github.com/repos/octocat/Hello-World/tags?per_page=100")
        assert.strictEqual(asked?.headers["authorization"], `Bearer ${token}`)
        assert.strictEqual(asked?.headers["accept"], "application/vnd.github+json")
        assert.strictEqual(asked?.headers["x-github-api-version"], "2022-11-28")
        assert.strictEqual(asked?.headers["user-agent"], "@cluenori/github")
      }),
  )

  it.effect("keeps 20 of the tags that match, in version order", () =>
    Effect.gen(function* () {
      const builds = Array.from({ length: 30 }, (_, index) => tagJson(`build-${index + 1}`, shas.released))
      const github = fakeGitHub({ [`${repo}/tags?per_page=100`]: { status: 200, body: builds } })
      const tags = yield* withGitHub(
        github,
        Effect.gen(function* () {
          const gitHub = yield* GitHub
          return yield* gitHub.tagsContaining(repository, "build-")
        }),
      )
      assert.strictEqual(tags.length, 20)
      assert.strictEqual(tags[0]?.name, "build-30")
      assert.strictEqual(tags[19]?.name, "build-11")
    }),
  )

  it.effect("finds a commit by a short SHA or a branch, by its author's login or else git name", () =>
    Effect.gen(function* () {
      const github = fakeGitHub({
        [`${repo}/commits/6dcb09b`]: {
          status: 200,
          body: singleCommitJson({
            sha: shas.released,
            message: "Release 2.4.0\n\nWith the fixed export.",
            login: "octocat",
            name: "Monalisa Octocat",
            date: "2026-10-21T08:00:00+02:00",
          }),
        },
        [`${repo}/commits/release/2.4`]: {
          status: 200,
          body: singleCommitJson({
            sha: shas.released,
            message: "Release 2.4.0",
            login: null,
            name: "Release Bot",
            date: "2026-10-21T06:00:00Z",
          }),
        },
      })
      const [bySha, byBranch] = yield* withGitHub(
        github,
        Effect.gen(function* () {
          const gitHub = yield* GitHub
          return yield* Effect.all([gitHub.commit(repository, "6dcb09b"), gitHub.commit(repository, "release/2.4")])
        }),
      )

      assert.deepStrictEqual(
        bySha,
        Option.some({
          sha: CommitSha.make(shas.released),
          message: "Release 2.4.0\n\nWith the fixed export.",
          author: "octocat",
          committedAt: DateTime.makeUnsafe("2026-10-21T06:00:00Z"),
          url: `https://github.com/octocat/Hello-World/commit/${shas.released}`,
        }),
      )
      assert.strictEqual(Option.getOrUndefined(byBranch)?.author, "Release Bot")
      assert.strictEqual(github.asked[1]?.url, "https://api.github.com/repos/octocat/Hello-World/commits/release/2.4")
    }),
  )

  it.effect("has no commit for a ref GitHub doesn't know, and asks for none a ref can't name", () =>
    Effect.gen(function* () {
      const github = fakeGitHub({
        [`${repo}/commits/0000000`]: { status: 422, body: errorJson("No commit found for SHA: 0000000", 422) },
        [`${repo}/commits/gone`]: notFound,
        [repo]: visibleRepository,
      })
      const found = yield* withGitHub(
        github,
        Effect.gen(function* () {
          const gitHub = yield* GitHub
          return yield* Effect.all([
            gitHub.commit(repository, "0000000"),
            gitHub.commit(repository, "gone"),
            gitHub.commit(repository, "../../pulls/1"),
            gitHub.commit(repository, ""),
          ])
        }),
      )
      assert.deepStrictEqual(found, [Option.none(), Option.none(), Option.none(), Option.none()])
      assert.deepStrictEqual(
        github.asked.map((asked) => asked.url),
        [
          "https://api.github.com/repos/octocat/Hello-World/commits/0000000",
          "https://api.github.com/repos/octocat/Hello-World/commits/gone",
          "https://api.github.com/repos/octocat/Hello-World",
        ],
      )
    }),
  )

  it.effect("refuses a repository the token can't see, rather than saying it has no such commit", () =>
    Effect.gen(function* () {
      const github = fakeGitHub({})
      const refused = yield* withGitHub(
        github,
        Effect.gen(function* () {
          const gitHub = yield* GitHub
          return yield* gitHub.commit(repository, "6dcb09b").pipe(Effect.flip)
        }),
      )
      assert.deepStrictEqual(factsOf(refused), {
        _tag: "GitHubRefused",
        status: 404,
        reason:
          "GitHub shows no repository octocat/Hello-World to this token: it doesn't exist, or the token can't read it",
      })
    }),
  )

  it.effect("compares two commits, oldest first", () =>
    Effect.gen(function* () {
      const github = fakeGitHub({
        [`${repo}/compare/${shas.previous}...${shas.released}`]: { status: 200, body: comparisonJson },
      })
      const comparison = yield* withGitHub(
        github,
        Effect.gen(function* () {
          const gitHub = yield* GitHub
          return yield* gitHub.compare(repository, CommitSha.make(shas.previous), CommitSha.make(shas.released))
        }),
      )
      assert.deepStrictEqual(comparison, {
        status: "ahead",
        totalCommits: 2,
        commits: [
          {
            sha: CommitSha.make(shas.fix),
            message: "Fix the export of empty notes (#1347)\n\nAn empty note exported as a file of zero bytes.",
            author: "octocat",
            committedAt: DateTime.makeUnsafe("2026-10-20T15:30:00Z"),
            url: `https://github.com/octocat/Hello-World/commit/${shas.fix}`,
          },
          {
            sha: CommitSha.make(shas.released),
            message: "Release 2.4.0",
            author: "Release Bot",
            committedAt: DateTime.makeUnsafe("2026-10-21T06:00:00Z"),
            url: `https://github.com/octocat/Hello-World/commit/${shas.released}`,
          },
        ],
        filesChanged: 2,
        additions: 107,
        deletions: 21,
        url: `https://github.com/octocat/Hello-World/compare/${shas.previous}...${shas.released}`,
      })
    }),
  )

  it.effect("finds a pull request, and none for a number that isn't one", () =>
    Effect.gen(function* () {
      const github = fakeGitHub({
        [`${repo}/pulls/1347`]: { status: 200, body: pullRequestJson },
        [repo]: visibleRepository,
      })
      const [found, missing, negative] = yield* withGitHub(
        github,
        Effect.gen(function* () {
          const gitHub = yield* GitHub
          return yield* Effect.all([
            gitHub.pullRequest(repository, 1347),
            gitHub.pullRequest(repository, 1348),
            gitHub.pullRequest(repository, -1),
          ])
        }),
      )
      assert.deepStrictEqual(
        found,
        Option.some({
          number: 1347,
          title: "Fix the export of empty notes",
          author: "octocat",
          url: "https://github.com/octocat/Hello-World/pull/1347",
          mergedAt: DateTime.makeUnsafe("2026-10-20T15:30:00Z"),
          labels: ["bug"],
        }),
      )
      assert.deepStrictEqual(missing, Option.none())
      assert.deepStrictEqual(negative, Option.none())
      assert.strictEqual(github.asked.length, 3)
    }),
  )

  it.effect("refuses a wrong token, and one without access", () =>
    Effect.gen(function* () {
      const github = fakeGitHub({
        [`${repo}/pulls/1`]: {
          status: 401,
          body: errorJson("Bad credentials", 401),
          headers: { "x-ratelimit-remaining": "59", "x-ratelimit-reset": "1792576800" },
        },
        [`${repo}/pulls/2`]: {
          status: 403,
          body: errorJson("Resource not accessible by personal access token", 403),
          headers: { "x-ratelimit-remaining": "4999", "x-ratelimit-reset": "1792576800" },
        },
      })
      const refusals = yield* withGitHub(
        github,
        Effect.gen(function* () {
          const gitHub = yield* GitHub
          return yield* Effect.all([
            gitHub.pullRequest(repository, 1).pipe(Effect.flip),
            gitHub.pullRequest(repository, 2).pipe(Effect.flip),
          ])
        }),
      )
      assert.deepStrictEqual(refusals.map(factsOf), [
        { _tag: "GitHubRefused", status: 401, reason: "Bad credentials" },
        { _tag: "GitHubRefused", status: 403, reason: "Resource not accessible by personal access token" },
      ])
    }),
  )

  it.effect("is unavailable while rate-limited, until GitHub says to ask again", () =>
    Effect.gen(function* () {
      const github = fakeGitHub({
        [`${repo}/tags?per_page=100`]: {
          status: 403,
          body: errorJson("API rate limit exceeded for user ID 1.", 403),
          headers: { "x-ratelimit-limit": "5000", "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1792576800" },
        },
        [`${repo}/pulls/1`]: {
          status: 429,
          body: errorJson("You have exceeded a secondary rate limit.", 429),
          headers: { "retry-after": "30" },
        },
      })
      yield* TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe("2026-10-21T10:00:00Z")))
      const [primary, secondary] = yield* withGitHub(
        github,
        Effect.gen(function* () {
          const gitHub = yield* GitHub
          return yield* Effect.all([
            gitHub.tagsContaining(repository, "2.4.0").pipe(Effect.flip),
            gitHub.pullRequest(repository, 1).pipe(Effect.flip),
          ])
        }),
      )
      assert.deepStrictEqual(factsOf(primary), {
        _tag: "GitHubUnavailable",
        reason: "API rate limit exceeded for user ID 1.",
        retryAfter: DateTime.fromEpochSeconds(1792576800),
      })
      assert.deepStrictEqual(factsOf(secondary), {
        _tag: "GitHubUnavailable",
        reason: "You have exceeded a secondary rate limit.",
        retryAfter: DateTime.makeUnsafe("2026-10-21T10:00:30Z"),
      })
    }),
  )

  it.effect("is unavailable when GitHub fails, or doesn't answer in 15 s", () =>
    Effect.gen(function* () {
      const github = fakeGitHub({
        [`${repo}/compare/${shas.previous}...${shas.released}`]: { status: 503 },
        [`${repo}/pulls/1347`]: "no answer",
      })
      const [failed, silent] = yield* withGitHub(
        github,
        Effect.gen(function* () {
          const gitHub = yield* GitHub
          const compared = yield* gitHub
            .compare(repository, CommitSha.make(shas.previous), CommitSha.make(shas.released))
            .pipe(Effect.flip)
          const waiting = yield* Effect.forkChild(gitHub.pullRequest(repository, 1347).pipe(Effect.flip))
          yield* TestClock.adjust("15 seconds")
          const unanswered = yield* Fiber.join(waiting)
          return [compared, unanswered] as const
        }),
      )
      assert.deepStrictEqual(factsOf(failed), { _tag: "GitHubUnavailable", reason: "HTTP 503" })
      assert.deepStrictEqual(factsOf(silent), { _tag: "GitHubUnavailable", reason: "GitHub didn't answer in 15 s" })
    }),
  )

  it.effect("dies, saying what differs, on an answer its documentation doesn't describe", () =>
    Effect.gen(function* () {
      const github = fakeGitHub({
        [`${repo}/tags?per_page=100`]: { status: 200, body: [{ name: "v2.4.0", commit: { sha: "not-a-sha" } }] },
        [`${repo}/commits/6dcb09b`]: {
          status: 200,
          body: {
            ...commitJson({
              sha: shas.released,
              message: "Release",
              login: null,
              name: "Bot",
              date: "2026-10-21T06:00:00Z",
            }),
            html_url: null,
          },
        },
      })
      const defects = yield* withGitHub(
        github,
        Effect.gen(function* () {
          const gitHub = yield* GitHub
          return yield* Effect.all([
            gitHub.tagsContaining(repository, "2.4.0").pipe(Effect.catchDefect((defect) => Effect.succeed(defect))),
            gitHub.commit(repository, "6dcb09b").pipe(Effect.catchDefect((defect) => Effect.succeed(defect))),
          ])
        }),
      )
      const [tags, commit] = defects.map((defect) => (typeof defect === "string" ? defect : ""))
      assert.include(
        tags,
        "GitHub's answer to GET /repos/octocat/Hello-World/tags isn't shaped as its documentation says",
      )
      assert.include(tags, "a full commit SHA")
      assert.include(commit, "html_url")
      assert.notInclude(`${tags}${commit}`, token)
    }),
  )
})
