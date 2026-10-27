import type { Actor } from "@cluenori/foundation"
import { ActivityLog, NotAllowed, Source } from "@cluenori/foundation"
import { GitHub, Repository } from "@cluenori/github"
import type { Access } from "@cluenori/members"
import { Members } from "@cluenori/members"
import { Phones } from "@cluenori/phones"
import { Clock, Context, Crypto, DateTime, Duration, Effect, Layer, Option, Redacted, Result, Schema } from "effect"
import { Base64, Hex } from "effect/encoding"
import { SqlClient, SqlSchema } from "effect/sql"

import { WatcherRepositorySet } from "./watcher-activity.ts"
import { migrateWatcher } from "./watcher-migrations.ts"
import type { WatcherStatus } from "./watcher-status.ts"

const source = Source.make("engine:watcher")

// The secrets the watcher reads (Cluenori/cluenori-watch, its README): the APNs key, and the
// owners' phones.
const keySecret = "CLUENORI_APNS_KEY"
const phonesSecret = "CLUENORI_PHONES"

// After a write fails, the next waits this long, so a GitHub that refuses isn't asked on every call.
const retryAfter = Duration.toMillis(Duration.minutes(5))

/** APNs's key, its IDs, and the app's bundle ID: the Worker's own push settings. */
export interface WatcherPush {
  readonly key: Redacted.Redacted
  readonly keyId: string
  readonly teamId: string
  readonly topic: string
}

/** The engine's settings: the deployment's push settings, absent until push is set up. */
export interface WatcherSettings {
  readonly push: Option.Option<WatcherPush>
}

const Row = Schema.Struct({
  repository: Repository,
  keyDigest: Schema.NullOr(Schema.String),
  phonesDigest: Schema.NullOr(Schema.String),
  phones: Schema.NullOr(Schema.Int),
  writtenAt: Schema.NullOr(Schema.Int),
  problem: Schema.NullOr(Schema.String),
  failedAt: Schema.NullOr(Schema.Int),
})

const KeySecret = Schema.Struct({
  keyId: Schema.String,
  teamId: Schema.String,
  topic: Schema.String,
  key: Schema.String,
})
const PhonesSecret = Schema.Struct({
  writtenAt: Schema.String,
  phones: Schema.Array(Schema.Struct({ token: Schema.String, environment: Schema.String })),
})
const encodeKey = Schema.encodeEffect(Schema.fromJsonString(KeySecret))
const encodePhones = Schema.encodeEffect(Schema.fromJsonString(PhonesSecret))

// What is wrong: the last write's failure, else push not set up, else nothing.
const problemOf = (problem: string | null, push: Option.Option<WatcherPush>) => {
  if (problem !== null) {
    return { problem }
  }
  return Option.isNone(push)
    ? { problem: "Push isn't set up: ./cluenori push setup gives the deployment APNs's key" }
    : {}
}

const ownerOnly = (access: Access) => (access._tag === "Everything" ? Effect.void : Effect.fail(new NotAllowed()))

/**
 * The outside watcher's secrets: the repository an owner names, where Cluenori writes, as the
 * workspace's GitHub App, the APNs key its alerts are sent with and the push tokens of every owner's
 * phone, so the watcher can ring them while Cluenori is down. Runs in the workspace's Durable Object.
 */
export class Watcher extends Context.Service<
  Watcher,
  {
    /** The watcher's repository and how its secrets were last written. For an owner only. */
    readonly status: (access: Access) => Effect.Effect<WatcherStatus, NotAllowed>
    /**
     * Names the watcher's repository, with `watcher.repository_set`, then writes its secrets at
     * once, whatever was written before. For an owner only. A write GitHub refuses doesn't fail
     * this: the status says what is wrong.
     */
    readonly setRepository: (
      actor: Actor,
      access: Access,
      repository: Repository,
    ) => Effect.Effect<WatcherStatus, NotAllowed>
    /**
     * Writes each secret whose content changed since it was last written: the owners' phones that
     * have a push token, and the key. Nothing before a repository is named or push is set up, and
     * nothing within 5 minutes of a failed write. Never fails: a failure is kept in the status, and
     * logged without the secrets. The host calls it after every change to phones or members; up to
     * two writes to GitHub, of two requests each, when something changed, else none.
     */
    readonly sync: Effect.Effect<void>
  }
>()("@cluenori/watcher/watcher") {
  /** Builds the engine on the workspace's database, first creating or updating its table. */
  static readonly layer = (
    settings: WatcherSettings,
  ): Layer.Layer<Watcher, never, SqlClient.SqlClient | ActivityLog | Phones | Members | GitHub | Crypto.Crypto> =>
    Layer.effect(
      Watcher,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const log = yield* ActivityLog
        const phones = yield* Phones
        const members = yield* Members
        const github = yield* GitHub
        const crypto = yield* Crypto.Crypto
        yield* migrateWatcher.pipe(Effect.orDie)

        const findRow = SqlSchema.findOneOption({
          Request: Schema.Void,
          Result: Row,
          execute: () =>
            sql`SELECT repository, key_digest AS "keyDigest", phones_digest AS "phonesDigest", phones,
              written_at AS "writtenAt", problem, failed_at AS "failedAt" FROM watcher`,
        })
        const row = findRow(undefined).pipe(Effect.orDie)

        const digestOf = (text: string) =>
          crypto
            // UTF-8 bytes through Effect's own encoder: engines have no TextEncoder.
            .digest("SHA-256", Result.getOrThrow(Base64.decode(Base64.encode(text))))
            .pipe(Effect.orDie, Effect.map(Hex.encode))

        const statusOf = (found: typeof Row.Type): WatcherStatus => ({
          repository: found.repository,
          ...(found.phones === null ? {} : { phones: found.phones }),
          ...(found.writtenAt === null ? {} : { writtenAt: DateTime.makeUnsafe(found.writtenAt) }),
          ...problemOf(found.problem, settings.push),
        })

        // The owners' phones that have a push token, in a stable order, so the same phones digest
        // the same. A removed member's phones, and members' who aren't owners, aren't among them.
        const ownersPhones = Effect.gen(function* () {
          const targets = yield* phones.pushTargets
          const owners = new Map<string, boolean>()
          const listed: Array<{ readonly token: string; readonly environment: string }> = []
          for (const target of targets) {
            if (target.member === undefined) {
              continue
            }
            const known = owners.get(target.member)
            const owner =
              known ??
              (yield* members.accessOf(target.member).pipe(
                Effect.map((access) => access._tag === "Everything"),
                Effect.orElseSucceed(() => false),
              ))
            owners.set(target.member, owner)
            if (owner) {
              listed.push({ token: target.token, environment: target.environment })
            }
          }
          // Tokens are distinct hex, so this order is total.
          return listed.toSorted((a, b) => (a.token < b.token ? -1 : 1))
        })

        const write = Effect.fn("Watcher.write")(function* (force: boolean) {
          const found = yield* row
          if (Option.isNone(found) || Option.isNone(settings.push)) {
            return
          }
          const now = yield* Clock.currentTimeMillis
          const current = found.value
          if (!force && current.failedAt !== null && now - current.failedAt < retryAfter) {
            return
          }
          const repository = current.repository
          const push = settings.push.value
          const keyText = yield* encodeKey({
            keyId: push.keyId,
            teamId: push.teamId,
            topic: push.topic,
            key: Redacted.value(push.key),
          }).pipe(Effect.orDie)
          const listed = yield* ownersPhones
          const listText = yield* encodePhones({ writtenAt: "", phones: listed }).pipe(Effect.orDie)
          const keyDigest = yield* digestOf(keyText)
          const phonesDigest = yield* digestOf(listText)
          const keyChanged = force || keyDigest !== current.keyDigest
          const phonesChanged = force || phonesDigest !== current.phonesDigest
          if (!keyChanged && !phonesChanged) {
            return
          }
          const written = yield* Effect.gen(function* () {
            if (keyChanged) {
              yield* github.setActionsSecret(repository, keySecret, Redacted.make(keyText))
            }
            if (phonesChanged) {
              const stamped = yield* encodePhones({
                writtenAt: DateTime.formatIso(DateTime.makeUnsafe(now)),
                phones: listed,
              }).pipe(Effect.orDie)
              yield* github.setActionsSecret(repository, phonesSecret, Redacted.make(stamped))
            }
          }).pipe(Effect.result)
          if (written._tag === "Failure") {
            const reason = written.failure.reason
            // GitHub's words, which name the repository and the permission, never a secret's value.
            yield* Effect.logWarning("The watcher's secrets couldn't be written", { reason })
            // A key written before the phones failed stays written; only what failed is tried again.
            // Both digests stay as before, so both secrets are written again next time.
            yield* sql`UPDATE watcher SET problem = ${reason}, failed_at = ${now}`.pipe(Effect.orDie)
            return
          }
          yield* sql`UPDATE watcher SET key_digest = ${keyDigest}, phones_digest = ${phonesDigest},
            phones = ${listed.length}, written_at = ${now}, problem = NULL, failed_at = NULL`.pipe(Effect.orDie)
        })

        const status = Effect.fn("Watcher.status")(function* (access: Access) {
          yield* ownerOnly(access)
          const found = yield* row
          const none: WatcherStatus = {}
          return Option.match(found, { onNone: () => none, onSome: statusOf })
        })

        const setRepository = Effect.fn("Watcher.setRepository")(function* (
          actor: Actor,
          access: Access,
          repository: Repository,
        ) {
          yield* ownerOnly(access)
          yield* log.commit({
            source,
            actor,
            write: sql`INSERT INTO watcher (only, repository) VALUES (1, ${repository})
              ON CONFLICT (only) DO UPDATE SET repository = excluded.repository, key_digest = NULL,
              phones_digest = NULL, phones = NULL, written_at = NULL, problem = NULL, failed_at = NULL`.pipe(
              Effect.asVoid,
              Effect.orDie,
            ),
            activity: () => [{ payload: WatcherRepositorySet.make({ repository }) }],
          })
          yield* write(true)
          return yield* status(access).pipe(Effect.orDie)
        })

        const sync = write(false)

        return Watcher.of({ status, setRepository, sync })
      }),
    )
}
