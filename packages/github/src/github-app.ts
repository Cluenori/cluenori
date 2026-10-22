import type { Rs256Signing } from "@cluenori/rs256-jwt"
import { signRs256 } from "@cluenori/rs256-jwt"
import { Cache, Clock, Context, DateTime, Duration, Effect, Exit, Layer, Option, Redacted, Ref } from "effect"
import { HttpClient } from "effect/http"

import {
  InstallationAnswer,
  InstallationRepositoriesAnswer,
  InstallationsAnswer,
  InstallationTokenAnswer,
} from "./answers.ts"
import type { GitHubUnavailable } from "./github-errors.ts"
import { GitHubRefused } from "./github-errors.ts"
import { ask, failure, read, readSecrets } from "./github-rest.ts"
import type { Repository } from "./repository.ts"

/**
 * A GitHub App, as GitHub gives it: its ID, such as 123456, or its client ID, such as
 * `Iv23li…`, which GitHub recommends, either the issuer of its JWTs; and a private key GitHub
 * generated for it, the PEM's text: PKCS #1 (`BEGIN RSA PRIVATE KEY`), as GitHub gives it, or PKCS #8.
 */
export interface GitHubAppCredentials {
  readonly appId: number | string
  readonly privateKey: Redacted.Redacted
}

/**
 * The part of the Web Crypto API a GitHub App signs its JWTs with: `globalThis.crypto.subtle` in
 * Workers, browsers, Bun, and Node. The same shape `@cluenori/rs256-jwt` signs with.
 */
export type GitHubAppSigning = Rs256Signing

/** Where a GitHub App is installed: on one account, reaching all its repositories or those chosen. */
export interface Installation {
  readonly id: number
  /** The login of the account it is installed on. */
  readonly account: string
  readonly accountType: "User" | "Organization"
  /** Whether it reaches every repository of the account, now and later, or those chosen. */
  readonly repositories: "all" | "selected"
  /** Its settings on GitHub. */
  readonly url: string
}

/** A token GitHub issued, and when it expires: an installation's, an hour after it was issued. */
export interface IssuedToken {
  readonly token: Redacted.Redacted
  readonly expiresAt: DateTime.Utc
}

// GitHub takes an app's JWT for at most 10 minutes ahead, and asks for its `iat` 60 s in the past,
// against clocks that drift. Ours expires 9 minutes ahead, so a clock a minute fast still passes,
// and is signed again after 8.
const jwtExpiresIn = Duration.toSeconds(Duration.minutes(9))
const jwtKept = Duration.toMillis(Duration.minutes(8))
// An installation token is kept until 5 minutes before it expires, so none is sent about to.
const tokenMargin = Duration.toMillis(Duration.minutes(5))
// Which installation reaches a repository is kept a minute: enough for the requests of one task,
// short enough that a reinstalled app is found again soon. Not being installed isn't kept.
const installationKept = Duration.minutes(1)
// One page of installations and of an installation's repositories, GitHub's largest.
const pageSize = 100
// Bounds on what is kept: more installations, or repositories asked about, than a product reaches.
const entriesKept = 1000

/**
 * A GitHub App: where it is installed, the repositories each installation reaches, and the
 * installation tokens it acts with, which `GitHub.layerFor` takes per repository.
 */
export class GitHubApp extends Context.Service<
  GitHubApp,
  {
    /**
     * The installation that reaches `repository`; none when the app isn't installed on its account,
     * the installation doesn't reach it, or it doesn't exist. One request, with the app's JWT.
     */
    readonly installationOf: (
      repository: Repository,
    ) => Effect.Effect<Option.Option<Installation>, GitHubRefused | GitHubUnavailable>
    /** The app's installations: at most 100, the first page GitHub lists. One request. */
    readonly installations: Effect.Effect<ReadonlyArray<Installation>, GitHubRefused | GitHubUnavailable>
    /**
     * The repositories the installation reaches: at most 100, the first page GitHub lists. One
     * request, with its token. Refused with 404 for an installation of another app, or none.
     */
    readonly repositoriesOf: (
      installation: number,
    ) => Effect.Effect<ReadonlyArray<Repository>, GitHubRefused | GitHubUnavailable>
    /**
     * A token to act as the installation, with every permission and repository it was granted. A
     * token is kept and given again until 5 minutes before it expires, then a new one is issued
     * (one request); calls at the same time share one. Refused with 404 for an installation of
     * another app, or none, and with 403 for one suspended.
     */
    readonly installationToken: (installation: number) => Effect.Effect<IssuedToken, GitHubRefused | GitHubUnavailable>
    /**
     * The token of the installation that reaches `repository`: `installationOf`, kept a minute,
     * then `installationToken`. Refused with 404, saying so, when the app isn't installed on it.
     */
    readonly tokenFor: (repository: Repository) => Effect.Effect<IssuedToken, GitHubRefused | GitHubUnavailable>
  }
>()("@cluenori/github/github-app/GitHubApp") {
  /**
   * A client of the app with `credentials`, signing its JWTs with `signing`, on the `HttpClient`
   * the host provides, with caches of its own: for an app whose credentials come while a product
   * runs, as from `convertManifest`, made once per app and kept. A JWT is signed once and kept 8
   * minutes. A private key that can't sign is refused with status 0 and the reason
   * "InvalidSigningKey", with nothing sent.
   */
  static readonly make = (
    credentials: GitHubAppCredentials,
    signing: GitHubAppSigning,
  ): Effect.Effect<GitHubApp["Service"], never, HttpClient.HttpClient> =>
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient
      const signed = yield* Ref.make(Option.none<{ readonly jwt: Redacted.Redacted; readonly at: number }>())

      // The app's JWT (RS256): `iat` 60 s in the past, `exp` 9 minutes ahead, `iss` the app.
      const jwt = Effect.fn("GitHubApp.jwt")(function* () {
        const now = yield* Clock.currentTimeMillis
        const previous = yield* Ref.get(signed)
        if (Option.isSome(previous) && now - previous.value.at < jwtKept) {
          return previous.value.jwt
        }
        const seconds = Math.floor(now / 1000)
        const token = yield* signRs256(
          signing,
          credentials.privateKey,
          { typ: "JWT" },
          { iat: seconds - 60, exp: seconds + jwtExpiresIn, iss: credentials.appId },
        ).pipe(Effect.mapError(() => new GitHubRefused({ status: 0, reason: "InvalidSigningKey" })))
        const fresh = Redacted.make(token)
        yield* Ref.set(signed, Option.some({ jwt: fresh, at: now }))
        return fresh
      })

      const installationOf = Effect.fn("GitHubApp.installationOf")(function* (repository: Repository) {
        const bearer = yield* jwt()
        const answer = yield* ask(client, { method: "GET", path: `/repos/${repository}/installation`, token: bearer })
        if (answer.status === 200) {
          const found = yield* read(InstallationAnswer, answer)
          return Option.some(installationFrom(found))
        }
        if (answer.status === 404) {
          return Option.none<Installation>()
        }
        return yield* failure(answer)
      })

      const installations = Effect.gen(function* () {
        const bearer = yield* jwt()
        const answer = yield* ask(client, {
          method: "GET",
          path: "/app/installations",
          urlParams: { per_page: pageSize },
          token: bearer,
        })
        if (answer.status !== 200) {
          return yield* failure(answer)
        }
        const found = yield* read(InstallationsAnswer, answer)
        return found.map(installationFrom)
      }).pipe(Effect.withSpan("GitHubApp.installations"))

      // A new token for the installation, and how long to keep it: until 5 minutes before it
      // expires, or not at all when that has passed, as on a clock far behind GitHub's.
      const issue = Effect.fn("GitHubApp.issue")(function* (installation: number) {
        const numbered = Number.isSafeInteger(installation) && installation > 0
        if (!numbered) {
          return yield* refusedInstallation(installation)
        }
        const bearer = yield* jwt()
        const answer = yield* ask(client, {
          method: "POST",
          path: `/app/installations/${installation}/access_tokens`,
          token: bearer,
        })
        if (answer.status === 404) {
          return yield* refusedInstallation(installation)
        }
        if (answer.status !== 201) {
          return yield* failure(answer)
        }
        const issued = yield* readSecrets(InstallationTokenAnswer, answer)
        const now = yield* Clock.currentTimeMillis
        const keepFor = DateTime.toEpochMillis(issued.expires_at) - tokenMargin - now
        return {
          issued: { token: issued.token, expiresAt: issued.expires_at },
          keepFor: Duration.millis(Math.max(0, keepFor)),
        }
      })
      const tokens = yield* Cache.makeWith(issue, {
        capacity: entriesKept,
        timeToLive: (exit) => (Exit.isSuccess(exit) ? exit.value.keepFor : Duration.zero),
      })

      const installationToken = Effect.fn("GitHubApp.installationToken")(function* (installation: number) {
        const token = yield* Cache.get(tokens, installation)
        return token.issued
      })

      const reaching = yield* Cache.makeWith(installationOf, {
        capacity: entriesKept,
        timeToLive: (exit) => (Exit.isSuccess(exit) && Option.isSome(exit.value) ? installationKept : Duration.zero),
      })

      const tokenFor = Effect.fn("GitHubApp.tokenFor")(function* (repository: Repository) {
        const installation = yield* Cache.get(reaching, repository)
        if (Option.isNone(installation)) {
          return yield* new GitHubRefused({
            status: 404,
            reason: `The GitHub App isn't installed on ${repository}: install it on the repository's account, with access to the repository`,
          })
        }
        return yield* installationToken(installation.value.id)
      })

      const repositoriesOf = Effect.fn("GitHubApp.repositoriesOf")(function* (installation: number) {
        const issued = yield* installationToken(installation)
        const answer = yield* ask(client, {
          method: "GET",
          path: "/installation/repositories",
          urlParams: { per_page: pageSize },
          token: issued.token,
        })
        if (answer.status !== 200) {
          return yield* failure(answer)
        }
        const found = yield* read(InstallationRepositoriesAnswer, answer)
        return found.repositories.map((repository) => repository.full_name)
      })

      return GitHubApp.of({ installationOf, installations, repositoriesOf, installationToken, tokenFor })
    })

  /** The app with `credentials`, as `make` builds it, for credentials known when the host starts. */
  static readonly layer = (
    credentials: GitHubAppCredentials,
    signing: GitHubAppSigning,
  ): Layer.Layer<GitHubApp, never, HttpClient.HttpClient> =>
    Layer.effect(GitHubApp, GitHubApp.make(credentials, signing))
}

const refusedInstallation = (installation: number) =>
  Effect.fail(new GitHubRefused({ status: 404, reason: `GitHub has no installation ${installation} of this app` }))

const installationFrom = (answer: InstallationAnswer): Installation => ({
  id: answer.id,
  account: answer.account.login,
  accountType: answer.target_type,
  repositories: answer.repository_selection,
  url: answer.html_url,
})
