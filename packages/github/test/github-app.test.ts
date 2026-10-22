import { assert, describe, it } from "@effect/vitest"
import { DateTime, Effect, Layer, Option, Redacted } from "effect"
import { TestClock } from "effect/testing"

import type { GitHubAppCredentials } from "../src/index.ts"
import { GitHub, GitHubApp, Repository } from "../src/index.ts"
import { factsOf, fakeGitHub } from "./fake-github.ts"
import { installationJson, installationTokenJson, repositoryJson } from "./github-answers.ts"
import { newAppKey, openJwt, subtle } from "./web-crypto.ts"

const repository = Repository.make("octocat/Hello-World")
const now = DateTime.makeUnsafe("2026-10-22T10:00:00Z")
const nowSeconds = DateTime.toEpochMillis(now) / 1000

const credentialsOf = (privateKey: string): GitHubAppCredentials => ({
  appId: 123456,
  privateKey: Redacted.make(privateKey),
})

// Runs `program` with the app, its API answered by `github`, at `now`.
const withApp = <A, E>(
  github: ReturnType<typeof fakeGitHub>,
  credentials: GitHubAppCredentials,
  program: Effect.Effect<A, E, GitHubApp>,
) =>
  Effect.gen(function* () {
    yield* TestClock.setTime(DateTime.toEpochMillis(now))
    return yield* program.pipe(Effect.provide(GitHubApp.layer(credentials, subtle).pipe(Layer.provide(github.layer))))
  })

const tokenAnswer = (token: string, expiresAt: string) => ({
  status: 201,
  body: installationTokenJson(token, expiresAt),
})

const installedOnOrganization = {
  status: 200,
  body: installationJson({ id: 42, login: "octocat", type: "Organization", selection: "selected" }),
}

describe("GitHubApp", () => {
  it.effect("signs its JWT with RS256 from a PKCS #1 key, as GitHub gives it, and from a PKCS #8 one", () =>
    Effect.gen(function* () {
      const key = yield* newAppKey
      for (const pem of [key.pkcs1, key.pkcs8]) {
        const github = fakeGitHub({
          "GET /app/installations": [
            {
              status: 200,
              body: [
                installationJson({ id: 42, login: "octocat", type: "Organization", selection: "selected" }),
                installationJson({ id: 43, login: "monalisa", type: "User", selection: "all" }),
              ],
            },
          ],
        })
        const installations = yield* withApp(
          github,
          credentialsOf(pem),
          Effect.gen(function* () {
            const app = yield* GitHubApp
            return yield* app.installations
          }),
        )
        assert.deepStrictEqual(installations, [
          {
            id: 42,
            account: "octocat",
            accountType: "Organization",
            repositories: "selected",
            url: "https://github.com/organizations/octocat/settings/installations/42",
          },
          {
            id: 43,
            account: "monalisa",
            accountType: "User",
            repositories: "all",
            url: "https://github.com/settings/installations/43",
          },
        ])

        const authorization = github.asked[0]?.headers["authorization"] ?? ""
        assert.isTrue(authorization.startsWith("Bearer "))
        assert.strictEqual(github.asked[0]?.url.searchParams.get("per_page"), "100")
        const jwt = yield* openJwt(authorization.slice("Bearer ".length), key.publicKey)
        assert.isTrue(jwt.verifies)
        assert.strictEqual(jwt.header, '{"alg":"RS256","typ":"JWT"}')
        // Issued 60 s in the past, expiring 9 minutes ahead: within GitHub's 10.
        assert.strictEqual(jwt.claims, `{"iat":${nowSeconds - 60},"exp":${nowSeconds + 540},"iss":123456}`)
      }
    }),
  )

  it.effect("issues an installation token, keeps it, and issues another 5 minutes before it expires", () =>
    Effect.gen(function* () {
      const key = yield* newAppKey
      const github = fakeGitHub({
        "POST /app/installations/42/access_tokens": [
          tokenAnswer("ghs_test-token-one-not-real", "2026-10-22T11:00:00Z"),
          tokenAnswer("ghs_test-token-two-not-real", "2026-10-22T11:56:00Z"),
        ],
      })
      const [first, together, kept, renewed] = yield* withApp(
        github,
        credentialsOf(key.pkcs1),
        Effect.gen(function* () {
          const app = yield* GitHubApp
          const issued = yield* app.installationToken(42)
          const atOnce = yield* Effect.all([app.installationToken(42), app.installationToken(42)], {
            concurrency: "unbounded",
          })
          yield* TestClock.adjust("54 minutes")
          const later = yield* app.installationToken(42)
          yield* TestClock.adjust("2 minutes")
          const nearExpiry = yield* app.installationToken(42)
          return [issued, atOnce, later, nearExpiry] as const
        }),
      )
      assert.strictEqual(Redacted.value(first.token), "ghs_test-token-one-not-real")
      assert.deepStrictEqual(first.expiresAt, DateTime.makeUnsafe("2026-10-22T11:00:00Z"))
      assert.deepStrictEqual(
        together.map((issued) => Redacted.value(issued.token)),
        ["ghs_test-token-one-not-real", "ghs_test-token-one-not-real"],
      )
      assert.strictEqual(Redacted.value(kept.token), "ghs_test-token-one-not-real")
      assert.strictEqual(Redacted.value(renewed.token), "ghs_test-token-two-not-real")
      assert.deepStrictEqual(renewed.expiresAt, DateTime.makeUnsafe("2026-10-22T11:56:00Z"))
      assert.strictEqual(github.asked.length, 2)
      assert.isTrue(github.asked.every((question) => question.method === "POST"))
    }),
  )

  it.effect("gives the token of the installation that reaches a repository, and keeps which one it is", () =>
    Effect.gen(function* () {
      const key = yield* newAppKey
      const github = fakeGitHub({
        "GET /repos/octocat/Hello-World/installation": [installedOnOrganization],
        "POST /app/installations/42/access_tokens": [
          tokenAnswer("ghs_test-token-one-not-real", "2026-10-22T11:00:00Z"),
        ],
      })
      const [first, second] = yield* withApp(
        github,
        credentialsOf(key.pkcs1),
        Effect.gen(function* () {
          const app = yield* GitHubApp
          return yield* Effect.all([app.tokenFor(repository), app.tokenFor(repository)])
        }),
      )
      assert.strictEqual(Redacted.value(first.token), "ghs_test-token-one-not-real")
      assert.deepStrictEqual(first.expiresAt, DateTime.makeUnsafe("2026-10-22T11:00:00Z"))
      assert.strictEqual(Redacted.value(second.token), "ghs_test-token-one-not-real")
      assert.deepStrictEqual(
        github.asked.map((question) => `${question.method} ${question.url.pathname}`),
        ["GET /repos/octocat/Hello-World/installation", "POST /app/installations/42/access_tokens"],
      )
    }),
  )

  it.effect("refuses a repository the app isn't installed on, and asks again the next time", () =>
    Effect.gen(function* () {
      const key = yield* newAppKey
      const github = fakeGitHub({})
      const [refused, again] = yield* withApp(
        github,
        credentialsOf(key.pkcs1),
        Effect.gen(function* () {
          const app = yield* GitHubApp
          const found = yield* app.installationOf(repository)
          assert.deepStrictEqual(found, Option.none())
          return yield* Effect.all([
            app.tokenFor(repository).pipe(Effect.flip),
            app.tokenFor(repository).pipe(Effect.flip),
          ])
        }),
      )
      assert.deepStrictEqual(factsOf(refused), {
        _tag: "GitHubRefused",
        status: 404,
        reason:
          "The GitHub App isn't installed on octocat/Hello-World: install it on the repository's account, with access to the repository",
      })
      assert.strictEqual(again._tag, "GitHubRefused")
      assert.strictEqual(github.asked.length, 3)
    }),
  )

  it.effect("lists the repositories an installation reaches, with its token", () =>
    Effect.gen(function* () {
      const key = yield* newAppKey
      const github = fakeGitHub({
        "POST /app/installations/42/access_tokens": [
          tokenAnswer("ghs_test-token-one-not-real", "2026-10-22T11:00:00Z"),
        ],
        "GET /installation/repositories": [
          {
            status: 200,
            body: {
              total_count: 2,
              repository_selection: "selected",
              repositories: [repositoryJson, { ...repositoryJson, name: "notes-ios", full_name: "octocat/notes-ios" }],
            },
          },
        ],
      })
      const repositories = yield* withApp(
        github,
        credentialsOf(key.pkcs1),
        Effect.gen(function* () {
          const app = yield* GitHubApp
          return yield* app.repositoriesOf(42)
        }),
      )
      assert.deepStrictEqual(repositories, [repository, Repository.make("octocat/notes-ios")])
      assert.strictEqual(github.asked[1]?.headers["authorization"], "Bearer ghs_test-token-one-not-real")
    }),
  )

  it.effect("refuses an installation GitHub doesn't have, and a key that can't sign, sending nothing for it", () =>
    Effect.gen(function* () {
      const key = yield* newAppKey
      const github = fakeGitHub({})
      const missing = yield* withApp(
        github,
        credentialsOf(key.pkcs1),
        Effect.gen(function* () {
          const app = yield* GitHubApp
          return yield* app.installationToken(7).pipe(Effect.flip)
        }),
      )
      assert.deepStrictEqual(factsOf(missing), {
        _tag: "GitHubRefused",
        status: 404,
        reason: "GitHub has no installation 7 of this app",
      })

      const silent = fakeGitHub({})
      const unsigned = yield* withApp(
        silent,
        credentialsOf("-----BEGIN RSA PRIVATE KEY-----\nbm90IGEga2V5\n-----END RSA PRIVATE KEY-----"),
        Effect.gen(function* () {
          const app = yield* GitHubApp
          return yield* app.tokenFor(repository).pipe(Effect.flip)
        }),
      )
      assert.deepStrictEqual(factsOf(unsigned), { _tag: "GitHubRefused", status: 0, reason: "InvalidSigningKey" })
      assert.strictEqual(silent.asked.length, 0)
    }),
  )

  it.effect("makes a client while running, for credentials that come later, each with caches of its own", () =>
    Effect.gen(function* () {
      const key = yield* newAppKey
      const github = fakeGitHub({
        "POST /app/installations/42/access_tokens": [
          tokenAnswer("ghs_test-token-one-not-real", "2026-10-22T11:00:00Z"),
          tokenAnswer("ghs_test-token-two-not-real", "2026-10-22T11:00:00Z"),
        ],
      })
      yield* TestClock.setTime(DateTime.toEpochMillis(now))
      const tokens = yield* Effect.gen(function* () {
        const one = yield* GitHubApp.make(credentialsOf(key.pkcs1), subtle)
        const other = yield* GitHubApp.make(credentialsOf(key.pkcs8), subtle)
        return yield* Effect.all([
          one.installationToken(42),
          one.installationToken(42),
          other.installationToken(42),
          other.installationToken(42),
        ])
      }).pipe(Effect.provide(github.layer))
      assert.deepStrictEqual(
        tokens.map((issued) => Redacted.value(issued.token)),
        [
          "ghs_test-token-one-not-real",
          "ghs_test-token-one-not-real",
          "ghs_test-token-two-not-real",
          "ghs_test-token-two-not-real",
        ],
      )
      assert.strictEqual(github.asked.length, 2)
    }),
  )

  it.effect("acts as the app through GitHub.layerFor, with each repository's installation token", () =>
    Effect.gen(function* () {
      const key = yield* newAppKey
      const github = fakeGitHub({
        "GET /repos/octocat/Hello-World/installation": [installedOnOrganization],
        "POST /app/installations/42/access_tokens": [
          tokenAnswer("ghs_test-token-one-not-real", "2026-10-22T11:00:00Z"),
        ],
        "GET /repos/octocat/Hello-World": [{ status: 200, body: repositoryJson }],
      })
      // What a host writes: GitHub with the token the app has for each repository.
      const gitHubAsApp = Layer.unwrap(
        Effect.gen(function* () {
          const app = yield* GitHubApp
          return GitHub.layerFor((forRepository) =>
            app.tokenFor(forRepository).pipe(Effect.map((issued) => issued.token)),
          )
        }),
      )
      yield* TestClock.setTime(DateTime.toEpochMillis(now))
      const branch = yield* Effect.gen(function* () {
        const gitHub = yield* GitHub
        return yield* gitHub.defaultBranch(repository)
      }).pipe(
        Effect.provide(
          gitHubAsApp.pipe(
            Layer.provide(GitHubApp.layer(credentialsOf(key.pkcs1), subtle)),
            Layer.provide(github.layer),
          ),
        ),
      )
      assert.strictEqual(branch, "main")
      assert.strictEqual(github.asked[2]?.headers["authorization"], "Bearer ghs_test-token-one-not-real")
    }),
  )
})
