import type { GitHubAppCrypto, IssuedToken } from "@bagatka/github-app"
import { AppSlug, appManifest, convertManifest, GitHubApp, installLink } from "@bagatka/github-app"
import { ActivityLog, Actor, Instant, NotAllowed, Source } from "@cluenori/foundation"
import type { Repository } from "@cluenori/github"
import { GitHubRefused, GitHubUnavailable } from "@cluenori/github"
import type { Access } from "@cluenori/members"
import { Context, Crypto, DateTime, Duration, Effect, Layer, Option, Redacted, Schema } from "effect"
import { Base64Url, Hex } from "effect/encoding"
import { HttpClient } from "effect/http"
import { SqlClient, SqlSchema } from "effect/sql"

import type { GitHubAppForm, GitHubAppSummary, GitHubStatus, ManifestCode } from "./connection.ts"
import { ConnectRejected, GitHubAccount, GitHubAlreadyConnected } from "./connection.ts"
import { GitHubAppConnected, GitHubAppDisconnected } from "./github-activity.ts"
import { migrateGitHub } from "./github-migrations.ts"

const source = Source.make("engine:github")

// A connect is good once, for this long: GitHub gives the code it returns with an hour too.
const connectLasts = Duration.toMillis(Duration.hours(1))
// At most this many connects are open at once; another drops the oldest.
const openConnects = 5

// What the app may do where it is installed: read repositories' code and pull requests, for
// releases, and publish releases on their Releases pages, which takes writing contents (GitHub has
// no narrower permission for releases); start their workflows, to promote them; and see whether an
// organization's self-hosted runners are online, to choose where a build runs. Metadata is every
// app's. An app made before keeps its permissions until an owner changes them on GitHub.
const permissions = {
  contents: "write",
  pull_requests: "read",
  actions: "write",
  metadata: "read",
  organization_self_hosted_runners: "read",
} as const

/** The engine's settings: the platform's Web Crypto, which signs the app's tokens. */
export interface GitHubConnectionSettings {
  readonly signing: GitHubAppCrypto
}

const AppRow = Schema.Struct({
  appId: Schema.Int,
  slug: AppSlug,
  name: Schema.String,
  url: Schema.String,
  organization: Schema.NullOr(GitHubAccount),
  privateKey: Schema.String,
  connectedAt: Instant,
})
type AppRow = typeof AppRow.Type

const ConnectRow = Schema.Struct({
  actor: Schema.fromJsonString(Actor),
  organization: Schema.NullOr(GitHubAccount),
})

const summaryOf = (row: AppRow): GitHubAppSummary => ({
  name: row.name,
  slug: row.slug,
  url: row.url,
  installUrl: installLink(row.slug),
  ...(row.organization === null ? {} : { organization: row.organization }),
  connectedAt: row.connectedAt,
})

// What the app is called, from the deployment's address: `Cluenori example` for
// `https://example.cluenori.dev`. GitHub wants names unique, of at most 34 characters; the owner
// can change it on GitHub's page before creating it.
const appNameFor = (deployment: string) => {
  const host = /^https?:\/\/([^/:]+)/.exec(deployment)?.[1] ?? ""
  const [label = ""] = host.split(".")
  return `Cluenori ${label}`.trim().slice(0, 34)
}

// Refused before anything is sent to GitHub: status 0, as GitHubRefused has it.
const notConnected = new GitHubRefused({
  status: 0,
  reason: "Cluenori isn't connected to GitHub yet: an owner connects it on the web, on the GitHub page",
})

const ownerOnly = (access: Access) => (access._tag === "Everything" ? Effect.void : Effect.fail(new NotAllowed()))

/**
 * The workspace's connection to GitHub: one GitHub App, which an owner connects from the web through
 * GitHub's manifest flow and installs on their accounts, and the tokens that act as it on the
 * repositories it reaches. Runs in the workspace's Durable Object, which keeps the app's private key;
 * projects get only tokens, through `tokenFor`.
 */
export class GitHubConnection extends Context.Service<
  GitHubConnection,
  {
    /**
     * The app, absent until connected, and the accounts it is installed on, read from GitHub now;
     * `problem` says why they couldn't be. For an owner only: anyone else fails with `NotAllowed`.
     */
    readonly status: (access: Access) => Effect.Effect<GitHubStatus, NotAllowed>
    /**
     * Starts connecting: the form the owner's browser posts to GitHub, which creates the app from
     * its manifest, in `organization` or the owner's own account, and sends the browser back to
     * `<deployment>/api/github/connected`. Its state is good once, for an hour. For an owner only;
     * fails with `GitHubAlreadyConnected` while an app is connected.
     */
    readonly startConnecting: (
      actor: Actor,
      access: Access,
      deployment: string,
      organization: GitHubAccount | undefined,
    ) => Effect.Effect<GitHubAppForm, NotAllowed | GitHubAlreadyConnected>
    /**
     * Finishes connecting, with what GitHub sent the browser back with: asks GitHub for the new
     * app's credentials and keeps them, with `github_app.connected` for whoever started. Fails with
     * `ConnectRejected` for a state that isn't open, a code GitHub refuses, or an app connected
     * meanwhile; and when GitHub doesn't answer, after which the same code may be tried again.
     */
    readonly finishConnecting: (code: ManifestCode, state: string) => Effect.Effect<GitHubAppSummary, ConnectRejected>
    /**
     * Forgets the app, with `github_app.disconnected`: nothing acts as it any more. It stays on
     * GitHub, with its installations, until its owner deletes it there. For an owner only; nothing
     * happens when none is connected.
     */
    readonly disconnect: (actor: Actor, access: Access) => Effect.Effect<void, NotAllowed>
    /**
     * A token that acts as the app on `repository`, and when it expires: an installation's token,
     * good for an hour and reused until 5 minutes before. Fails with `GitHubRefused` when no app is
     * connected, or it isn't installed where it reaches `repository`, saying what to do; and with
     * `GitHubUnavailable` when GitHub doesn't answer. Asks GitHub up to twice.
     */
    readonly tokenFor: (repository: Repository) => Effect.Effect<IssuedToken, GitHubRefused | GitHubUnavailable>
  }
>()("@cluenori/github-app/github-connection/GitHubConnection") {
  /** Builds the engine on the object's database, first creating or updating its tables. */
  static readonly layer = (settings: GitHubConnectionSettings) =>
    Layer.effect(
      GitHubConnection,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const crypto = yield* Crypto.Crypto
        const log = yield* ActivityLog
        const http = yield* HttpClient.HttpClient
        yield* migrateGitHub.pipe(Effect.orDie)

        // States are ASCII, so their characters are their bytes.
        const digestOf = (text: string) =>
          crypto
            .digest(
              "SHA-256",
              Uint8Array.from(text, (character) => character.charCodeAt(0)),
            )
            .pipe(Effect.orDie, Effect.map(Hex.encode))
        const nowMs = DateTime.now.pipe(Effect.map(DateTime.toEpochMillis))
        const encodeActor = Schema.encodeEffect(Schema.fromJsonString(Actor))

        const findApp = SqlSchema.findOneOption({
          Request: Schema.Void,
          Result: AppRow,
          execute: () =>
            sql`SELECT app_id AS "appId", slug, name, url, organization, private_key AS "privateKey",
              connected_at AS "connectedAt" FROM github_app`,
        })
        const app = findApp(undefined).pipe(Effect.orDie)
        const findConnect = SqlSchema.findOneOption({
          Request: Schema.Struct({ digest: Schema.String, now: Schema.Int }),
          Result: ConnectRow,
          execute: (asked) =>
            sql`SELECT actor, organization FROM github_connects
              WHERE state_digest = ${asked.digest} AND expires_at > ${asked.now}`,
        })

        // The app's client, built once for each app: it keeps its installations' tokens until they
        // expire. Owned here, and replaced when another app is connected.
        let client: { readonly appId: number; readonly app: GitHubApp["Service"] } | undefined
        const clientFor = (row: AppRow) =>
          client !== undefined && client.appId === row.appId
            ? Effect.succeed(client.app)
            : GitHubApp.make({ appId: row.appId, privateKey: Redacted.make(row.privateKey) }, settings.signing).pipe(
                Effect.provideService(HttpClient.HttpClient, http),
                // Refused before anything is sent: the key GitHub gave can't sign.
                Effect.mapError(
                  (invalid) =>
                    new GitHubRefused({
                      status: 0,
                      reason: `${row.name}'s key can't sign: ${invalid.reason}. Disconnect GitHub and connect it again`,
                    }),
                ),
                Effect.tap((built) =>
                  Effect.sync(() => {
                    client = { appId: row.appId, app: built }
                  }),
                ),
              )

        const status = Effect.fn("GitHubConnection.status")(function* (access: Access) {
          yield* ownerOnly(access)
          const row = yield* app
          if (Option.isNone(row)) {
            const none: GitHubStatus = { installations: [] }
            return none
          }
          const installations = yield* clientFor(row.value).pipe(
            Effect.flatMap((github) => github.installations),
            Effect.result,
          )
          const answer: GitHubStatus =
            installations._tag === "Success"
              ? {
                  app: summaryOf(row.value),
                  installations: installations.success.map((installation) => ({
                    account: installation.account,
                    accountType: installation.accountType,
                    repositories: installation.repositories,
                    url: installation.url,
                  })),
                }
              : { app: summaryOf(row.value), installations: [], problem: installations.failure.reason }
          return answer
        })

        const startConnecting = Effect.fn("GitHubConnection.startConnecting")(function* (
          actor: Actor,
          access: Access,
          deployment: string,
          organization: GitHubAccount | undefined,
        ) {
          yield* ownerOnly(access)
          if (Option.isSome(yield* app)) {
            return yield* new GitHubAlreadyConnected()
          }
          const state = Base64Url.encode(yield* crypto.randomBytes(32).pipe(Effect.orDie))
          const now = yield* nowMs
          yield* sql`DELETE FROM github_connects WHERE expires_at <= ${now}`.pipe(Effect.orDie)
          yield* sql`DELETE FROM github_connects WHERE state_digest NOT IN (
            SELECT state_digest FROM github_connects ORDER BY expires_at DESC LIMIT ${openConnects - 1})`.pipe(
            Effect.orDie,
          )
          yield* sql`INSERT INTO github_connects ${sql.insert({
            state_digest: yield* digestOf(state),
            actor: yield* encodeActor(actor).pipe(Effect.orDie),
            organization: organization ?? null,
            expires_at: now + connectLasts,
          })}`.pipe(Effect.orDie)
          return yield* appManifest({
            name: appNameFor(deployment),
            url: deployment,
            redirectUrl: `${deployment}/api/github/connected`,
            setupUrl: `${deployment}/github`,
            permissions,
            public: true,
            state,
            ...(organization === undefined ? {} : { organization }),
          })
        })

        const finishConnecting = Effect.fn("GitHubConnection.finishConnecting")(function* (
          code: ManifestCode,
          state: string,
        ) {
          const digest = yield* digestOf(state)
          const started = yield* findConnect({ digest, now: yield* nowMs }).pipe(Effect.orDie)
          if (Option.isNone(started)) {
            return yield* new ConnectRejected({
              reason: "This link to finish connecting GitHub was used, or is older than an hour: connect GitHub again",
            })
          }
          const dropConnect = sql`DELETE FROM github_connects WHERE state_digest = ${digest}`.pipe(Effect.orDie)
          if (Option.isSome(yield* app)) {
            yield* dropConnect
            return yield* new ConnectRejected({ reason: "Cluenori is connected to GitHub already" })
          }
          // A code GitHub refuses won't be taken later either, so its state is dropped too.
          const refusedCode = (refused: { readonly reason: string }) =>
            dropConnect.pipe(
              Effect.andThen(
                Effect.fail(
                  new ConnectRejected({
                    reason: `GitHub refused the new app's code: ${refused.reason}. Connect GitHub again`,
                  }),
                ),
              ),
            )
          const created = yield* convertManifest(code).pipe(
            Effect.provideService(HttpClient.HttpClient, http),
            Effect.catchTags({
              GitHubRefused: refusedCode,
              GitHubAppCredentialsRefused: refusedCode,
              GitHubForbidden: refusedCode,
              // The code stays good for an hour, and so does the state, so the same link can try again.
              GitHubUnavailable: (unavailable) =>
                Effect.fail(
                  new ConnectRejected({
                    reason: `GitHub didn't answer: ${unavailable.reason}. Reload this page to try again`,
                  }),
                ),
            }),
          )
          const connectedAt = yield* DateTime.now
          const row: AppRow = {
            appId: created.id,
            slug: created.slug,
            name: created.name,
            url: created.url,
            organization: started.value.organization,
            privateKey: Redacted.value(created.privateKey),
            connectedAt,
          }
          return yield* log.commit({
            source,
            actor: started.value.actor,
            write: Effect.gen(function* () {
              yield* sql`INSERT INTO github_app ${sql.insert({
                only: 1,
                app_id: row.appId,
                slug: row.slug,
                name: row.name,
                url: row.url,
                organization: row.organization,
                private_key: row.privateKey,
                webhook_secret: created.webhookSecret === undefined ? null : Redacted.value(created.webhookSecret),
                connected_at: DateTime.formatIso(connectedAt),
              })}`.pipe(Effect.orDie)
              yield* dropConnect
              return summaryOf(row)
            }),
            activity: (summary) => [
              {
                payload: GitHubAppConnected.make({
                  app: summary.slug,
                  name: summary.name,
                  ...(summary.organization === undefined ? {} : { organization: summary.organization }),
                }),
              },
            ],
          })
        })

        const disconnect = Effect.fn("GitHubConnection.disconnect")(function* (actor: Actor, access: Access) {
          yield* ownerOnly(access)
          const row = yield* app
          if (Option.isNone(row)) {
            return
          }
          yield* log.commit({
            source,
            actor,
            write: sql`DELETE FROM github_app`.pipe(Effect.asVoid, Effect.orDie),
            activity: () => [{ payload: GitHubAppDisconnected.make({ app: row.value.slug }) }],
          })
          client = undefined
        })

        const tokenFor = Effect.fn("GitHubConnection.tokenFor")(function* (repository: Repository) {
          const row = yield* app
          if (Option.isNone(row)) {
            return yield* notConnected
          }
          const github = yield* clientFor(row.value)
          const name = row.value.name
          // GitHub's answers as the GitHub client's errors, each saying what to do.
          return yield* github.tokenFor(repository).pipe(
            Effect.catchTags({
              GitHubRefused: () =>
                Effect.fail(
                  new GitHubRefused({
                    status: 404,
                    reason: `${name} isn't installed where it reaches ${repository}: install it on the account and choose the repository, from the GitHub page`,
                  }),
                ),
              GitHubAppCredentialsRefused: (refused) =>
                Effect.fail(
                  new GitHubRefused({
                    status: 401,
                    reason: `GitHub refused ${name}'s key: ${refused.reason}. Disconnect GitHub and connect it again`,
                  }),
                ),
              GitHubForbidden: (forbidden) =>
                Effect.fail(
                  new GitHubRefused({
                    status: 403,
                    reason: `GitHub forbade ${name} on ${repository}: ${forbidden.reason}. Check its installation on GitHub`,
                  }),
                ),
              // Kit says how long to wait; Cluenori's error says until when.
              GitHubUnavailable: (unavailable) =>
                Effect.flatMap(DateTime.now, (now) =>
                  Effect.fail(
                    new GitHubUnavailable({
                      reason: unavailable.reason,
                      ...(unavailable.retryAfter === undefined
                        ? {}
                        : { retryAfter: DateTime.addDuration(now, unavailable.retryAfter) }),
                    }),
                  ),
                ),
            }),
          )
        })

        return GitHubConnection.of({ status, startConnecting, finishConnecting, disconnect, tokenFor })
      }),
    )
}
