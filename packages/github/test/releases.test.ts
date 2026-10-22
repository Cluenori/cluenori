import { assert, describe, it } from "@effect/vitest"
import { Effect, Layer, Redacted } from "effect"

import type { ReleaseToPublish } from "../src/index.ts"
import { CommitSha, GitHub, Repository } from "../src/index.ts"
import type { FakeAnswer } from "./fake-github.ts"
import { factsOf, fakeGitHub, notFound } from "./fake-github.ts"
import { errorJson, releaseJson, repositoryJson, shas } from "./github-answers.ts"

const repository = Repository.make("octocat/Hello-World")
const repo = "/repos/octocat/Hello-World"
const visibleRepository: FakeAnswer = { status: 200, body: repositoryJson }

const release: ReleaseToPublish = {
  tag: "v2.4.0+58",
  commit: CommitSha.make(shas.released),
  name: "2.4.0+58",
  body: "Notes open twice as fast.",
  latest: true,
}
// The tag in a path, as GitHub reads it: `+` escaped.
const byTag = `GET ${repo}/releases/tags/v2.4.0%2B58`

// Publishes `release` with GitHub's API answered by `github`.
const publish = (github: ReturnType<typeof fakeGitHub>, published: ReleaseToPublish = release) =>
  Effect.gen(function* () {
    const gitHub = yield* GitHub
    return yield* gitHub.publishRelease(repository, published)
  }).pipe(
    Effect.provide(
      GitHub.layer({ token: Redacted.make("test-token-not-a-real-one") }).pipe(Layer.provide(github.layer)),
    ),
  )

describe("GitHub's releases", () => {
  it.effect("creates a release, and its tag on the commit, when the repository has none", () =>
    Effect.gen(function* () {
      const github = fakeGitHub({
        [byTag]: [notFound],
        [`POST ${repo}/releases`]: [{ status: 201, body: releaseJson({ id: 1, tag: "v2.4.0+58", name: "2.4.0+58" }) }],
      })
      const published = yield* publish(github)

      assert.deepStrictEqual(published, { url: "https://github.com/octocat/Hello-World/releases/tag/v2.4.0+58" })
      assert.deepStrictEqual(github.asked[1]?.body, {
        tag_name: "v2.4.0+58",
        target_commitish: shas.released,
        name: "2.4.0+58",
        body: "Notes open twice as fast.",
        make_latest: "true",
      })
    }),
  )

  it.effect("updates the release the tag has, so publishing again adds none", () =>
    Effect.gen(function* () {
      const github = fakeGitHub({
        [byTag]: [{ status: 200, body: releaseJson({ id: 7, tag: "v2.4.0+58", name: "2.4.0+58" }) }],
        [`PATCH ${repo}/releases/7`]: [
          { status: 200, body: releaseJson({ id: 7, tag: "v2.4.0+58", name: "2.4.0+58" }) },
        ],
      })
      const published = yield* publish(github, { ...release, body: "Notes open three times as fast.", latest: false })

      assert.deepStrictEqual(published, { url: "https://github.com/octocat/Hello-World/releases/tag/v2.4.0+58" })
      assert.deepStrictEqual(
        github.asked.map((question) => `${question.method} ${question.url.pathname}`),
        [`GET ${repo}/releases/tags/v2.4.0%2B58`, `PATCH ${repo}/releases/7`],
      )
      assert.deepStrictEqual(github.asked[1]?.body, {
        name: "2.4.0+58",
        body: "Notes open three times as fast.",
        make_latest: "false",
      })
    }),
  )

  it.effect("is refused without Contents: write, and says why GitHub rejected a release", () =>
    Effect.gen(function* () {
      const forbidden = fakeGitHub({
        [byTag]: [notFound],
        [`POST ${repo}/releases`]: [{ status: 403, body: errorJson("Resource not accessible by integration", 403) }],
      })
      const hidden = fakeGitHub({
        [byTag]: [notFound],
        [`POST ${repo}/releases`]: [notFound],
        [`GET ${repo}`]: [visibleRepository],
      })
      const rejecting = fakeGitHub({
        [byTag]: [notFound],
        [`POST ${repo}/releases`]: [{ status: 422, body: errorJson("Validation Failed", 422) }],
      })
      const withoutWrite = yield* publish(forbidden).pipe(Effect.flip)
      const unwritable = yield* publish(hidden).pipe(Effect.flip)
      const rejected = yield* publish(rejecting).pipe(Effect.flip)

      assert.deepStrictEqual(factsOf(withoutWrite), {
        _tag: "GitHubRefused",
        status: 403,
        reason:
          "octocat/Hello-World's releases can't be written with this token: it needs Contents: write (Resource not accessible by integration)",
      })
      assert.deepStrictEqual(factsOf(unwritable), {
        _tag: "GitHubRefused",
        status: 404,
        reason: "octocat/Hello-World's releases can't be written with this token: it needs Contents: write",
      })
      assert.deepStrictEqual(factsOf(rejected), {
        _tag: "GitHubRefused",
        status: 422,
        reason: "GitHub rejected the release v2.4.0+58: Validation Failed",
      })
    }),
  )
})
