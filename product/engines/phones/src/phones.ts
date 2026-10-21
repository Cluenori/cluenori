import type { Caller, MemberId } from "@cluenori/foundation"
import { ActivityLog, Actor, Instant, Source } from "@cluenori/foundation"
import { Context, Crypto, DateTime, Duration, Effect, Layer, Option, Redacted, Schema } from "effect"
import { Base64Url, Hex } from "effect/encoding"
import { SqlClient, SqlSchema } from "effect/sql"
import type { SqlError } from "effect/sql"

import { appleModels } from "./apple-models.ts"
import type { Pairing, PairPhone, PhoneDetails, PhoneList, RegisterPush } from "./phone.ts"
import {
  AppVersion,
  ModelIdentifier,
  PairingCode,
  PairingCodeRejected,
  Phone,
  PhoneId,
  PhoneKey,
  PhoneKeyRejected,
  PhoneNotFound,
  PushTarget,
  SystemVersion,
} from "./phone.ts"
import { PhonePaired, PhoneRemoved, PhoneUpdated } from "./phones-activity.ts"
import { migratePhones } from "./phones-migrations.ts"

const source = Source.make("engine:phones")

// A pairing code is good once, for this long.
const pairingLasts = Duration.toMillis(Duration.minutes(10))

// At most this many codes are good at once; another drops the oldest, so they can't pile up.
const openPairings = 5

// A phone's call is recorded at most this often, unless it comes from another address.
const seenEvery = Duration.toMillis(Duration.minutes(1))

const keyPrefix = "cluenori.phone."

// The app's User-Agent: `Cluenori/1.0 (12) iOS/27.1`.
const userAgentPattern = /^Cluenori\/(.{1,32}) iOS\/([\d.]{1,11})$/

const decodeVersions = Schema.decodeUnknownOption(
  Schema.Struct({ appVersion: AppVersion, systemVersion: SystemVersion }),
)

// The versions a phone's User-Agent says; none from another one.
const versionsOf = (userAgent: string | undefined) => {
  const match = userAgent === undefined ? null : userAgentPattern.exec(userAgent)
  return match === null ? Option.none() : decodeVersions({ appVersion: match[1], systemVersion: match[2] })
}

const PhoneRow = Schema.Struct({
  id: PhoneId,
  model: ModelIdentifier,
  systemVersion: SystemVersion,
  appVersion: AppVersion,
  pairedAt: Instant,
  seenAt: Schema.NullOr(Schema.Int),
  address: Schema.NullOr(Schema.String),
  country: Schema.NullOr(Schema.String),
  actor: Schema.fromJsonString(Actor),
})
type PhoneRow = typeof PhoneRow.Type

// The member an actor is, if a member.
const memberOf = (actor: Actor) => (actor._tag === "Member" ? { member: actor.id } : {})

const phoneOf = (row: PhoneRow) =>
  new Phone({
    id: row.id,
    model: row.model,
    modelName: appleModels.get(row.model) ?? row.model,
    systemVersion: row.systemVersion,
    appVersion: row.appVersion,
    pairedAt: row.pairedAt,
    ...memberOf(row.actor),
    ...(row.seenAt === null
      ? {}
      : {
          lastSeen: {
            at: DateTime.makeUnsafe(row.seenAt),
            ...(row.address === null ? {} : { address: row.address }),
            ...(row.country === null ? {} : { country: row.country }),
          },
        }),
  })

/**
 * The phones paired with the deployment, the keys they call the API with, and the codes that pair
 * them. Runs inside the workspace's Durable Object, which holds the workspace's own database.
 */
export class Phones extends Context.Service<
  Phones,
  {
    /**
     * Starts pairing a phone for `actor`, who the phone will act for: a link to `deployment`, the
     * deployment's origin as phones reach it, with a code good once for 10 minutes. At most 5 are
     * good at once; another drops the oldest.
     */
    readonly startPairing: (actor: Actor, deployment: string) => Effect.Effect<Pairing>
    /**
     * Pairs a phone with a code from `startPairing`, with `phone.paired` by whoever started it, and
     * makes its key: returned here only, once, since the deployment keeps only its SHA-256 digest.
     * The code is used up. Fails with `PairingCodeRejected` for a code that is wrong, used, or
     * expired, the same way whichever.
     */
    readonly pair: (
      input: PairPhone,
      caller: Caller,
    ) => Effect.Effect<{ readonly phone: Phone; readonly key: Redacted.Redacted<PhoneKey> }, PairingCodeRejected>
    /**
     * Pairs a phone for `actor`, whom the caller has checked otherwise, such as by their passkey, with
     * `phone.paired`, and makes its key: returned here only, once, as by `pair`.
     */
    readonly pairFor: (
      actor: Actor,
      phone: PhoneDetails,
      caller: Caller,
    ) => Effect.Effect<{ readonly phone: Phone; readonly key: Redacted.Redacted<PhoneKey> }>
    /**
     * Who a phone's key acts for: whoever paired it. Records when and where it called, at most once
     * a minute from one address, and the versions its User-Agent says when they changed, with
     * `phone.updated`. Fails with `PhoneKeyRejected`, the same way whatever is wrong, for a key that
     * isn't a paired phone's. Reads one row, and writes now and then.
     */
    readonly authenticate: (key: Redacted.Redacted<PhoneKey>, caller: Caller) => Effect.Effect<Actor, PhoneKeyRejected>
    /** The phones, the latest paired first. Reads only. */
    readonly phones: Effect.Effect<PhoneList>
    /**
     * Removes a phone, with `phone.removed`: its key stops working at once, and pushes stop reaching
     * it. Fails with `PhoneNotFound` for a phone the deployment doesn't have.
     */
    readonly remove: (actor: Actor, phone: PhoneId) => Effect.Effect<void, PhoneNotFound>
    /**
     * Removes every phone acting for `member`, each with `phone.removed`: their keys stop working at
     * once. None is nothing to remove.
     */
    readonly removeAllOf: (actor: Actor, member: MemberId) => Effect.Effect<void>
    /**
     * Keeps the push token of the phone whose key this is, in place of any before; a token another
     * phone had moves to this one. Authenticates the key as `authenticate` does, and fails the same
     * way. Without activity: iOS changes a token on its own.
     */
    readonly registerPush: (
      key: Redacted.Redacted<PhoneKey>,
      caller: Caller,
      push: RegisterPush,
    ) => Effect.Effect<void, PhoneKeyRejected>
    /** The phones with a push token, each with its latest. Reads only. */
    readonly pushTargets: Effect.Effect<ReadonlyArray<PushTarget>>
    /**
     * Forgets a token APNs says no longer reaches its phone. Keeps one the phone registered since,
     * so a forget that comes late removes nothing new.
     */
    readonly forgetPushToken: (target: PushTarget) => Effect.Effect<void>
  }
>()("@cluenori/phones/phones") {
  /** Builds the engine on the workspace's database, first creating or updating its tables. */
  static readonly layer = Layer.effect(
    Phones,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const crypto = yield* Crypto.Crypto
      const log = yield* ActivityLog
      yield* migratePhones.pipe(Effect.orDie)

      // Keys and codes are ASCII, so their characters are their bytes.
      const digestOf = (text: string) =>
        crypto
          .digest(
            "SHA-256",
            Uint8Array.from(text, (character) => character.charCodeAt(0)),
          )
          .pipe(Effect.orDie, Effect.map(Hex.encode))
      const secret = crypto.randomBytes(32).pipe(Effect.orDie, Effect.map(Base64Url.encode))
      const encodeActor = Schema.encodeEffect(Schema.fromJsonString(Actor))

      const phoneColumns = sql`p.id, p.model, p.system_version AS "systemVersion", p.app_version AS "appVersion",
        p.paired_at AS "pairedAt", s.at AS "seenAt", s.address, s.country, p.actor`

      const findPhones = SqlSchema.findAll({
        Request: Schema.Void,
        Result: PhoneRow,
        execute: () => sql`
          SELECT ${phoneColumns} FROM phones_phones p LEFT JOIN phones_seen s ON s.phone = p.id
          ORDER BY p.paired_at DESC, p.id DESC`,
      })

      const findKey = SqlSchema.findOneOption({
        Request: PhoneId,
        Result: Schema.Struct({ ...PhoneRow.fields, digest: Schema.String }),
        execute: (id) => sql`
          SELECT ${phoneColumns}, p.key_digest AS "digest"
          FROM phones_phones p LEFT JOIN phones_seen s ON s.phone = p.id WHERE p.id = ${id}`,
      })

      const findPairing = SqlSchema.findOneOption({
        Request: Schema.Struct({ digest: Schema.String, now: Schema.Int }),
        Result: Schema.Struct({ actor: Schema.fromJsonString(Actor) }),
        execute: (asked) => sql`
          SELECT actor FROM phones_pairings WHERE code_digest = ${asked.digest} AND expires_at > ${asked.now}`,
      })

      const recordSeen = (phone: PhoneId, at: number, caller: Caller) =>
        sql`INSERT INTO phones_seen ${sql.insert({ phone, at, address: caller.address ?? null, country: caller.country ?? null })}
          ON CONFLICT (phone) DO UPDATE SET at = excluded.at, address = excluded.address, country = excluded.country`

      const startPairing = Effect.fn("Phones.startPairing")(function* (actor: Actor, deployment: string) {
        const now = DateTime.toEpochMillis(yield* DateTime.now)
        const code = PairingCode.make(yield* secret)
        const digest = yield* digestOf(code)
        const encoded = yield* encodeActor(actor).pipe(Effect.orDie)
        const expiresAt = now + pairingLasts
        yield* sql
          .withTransaction(
            Effect.gen(function* () {
              yield* sql`DELETE FROM phones_pairings WHERE expires_at <= ${now}`
              yield* sql`DELETE FROM phones_pairings WHERE code_digest IN (
                SELECT code_digest FROM phones_pairings ORDER BY expires_at DESC LIMIT -1 OFFSET ${openPairings - 1})`
              yield* sql`INSERT INTO phones_pairings ${sql.insert({ code_digest: digest, actor: encoded, expires_at: expiresAt })}`
            }),
          )
          .pipe(Effect.orDie)
        const pairing: Pairing = {
          link: `cluenori://pair?url=${encodeURIComponent(deployment)}&code=${code}`,
          expiresAt: DateTime.makeUnsafe(expiresAt),
        }
        return pairing
      })

      // A new phone for `actor`, with its key, made before the commit, whose write holds only SQL;
      // `alsoWrite` commits with it, as using up a code.
      const newPhone = Effect.fn("Phones.newPhone")(function* (
        actor: Actor,
        input: PhoneDetails,
        caller: Caller,
        alsoWrite: Effect.Effect<unknown, SqlError.SqlError>,
      ) {
        const now = yield* DateTime.now
        const millis = DateTime.toEpochMillis(now)
        const id = PhoneId.make(yield* crypto.randomUUIDv7().pipe(Effect.orDie))
        const key = PhoneKey.make(`${keyPrefix}${id}.${yield* secret}`)
        const keyDigest = yield* digestOf(key)
        const encoded = yield* encodeActor(actor).pipe(Effect.orDie)
        yield* log.commit({
          source,
          actor,
          write: Effect.gen(function* () {
            yield* alsoWrite
            yield* sql`INSERT INTO phones_phones ${sql.insert({
              id,
              model: input.model,
              system_version: input.systemVersion,
              app_version: input.appVersion,
              key_digest: keyDigest,
              actor: encoded,
              paired_at: DateTime.formatIso(now),
            })}`
            yield* recordSeen(id, millis, caller)
          }).pipe(Effect.orDie),
          activity: () => [{ payload: PhonePaired.make({ phone: id, model: input.model }) }],
        })
        const phone = phoneOf({
          id,
          model: input.model,
          systemVersion: input.systemVersion,
          appVersion: input.appVersion,
          pairedAt: now,
          seenAt: millis,
          address: caller.address ?? null,
          country: caller.country ?? null,
          actor,
        })
        return { phone, key: Redacted.make(key) }
      })

      const pair = Effect.fn("Phones.pair")(function* (input: PairPhone, caller: Caller) {
        const codeDigest = yield* digestOf(input.code)
        const now = DateTime.toEpochMillis(yield* DateTime.now)
        const found = yield* findPairing({ digest: codeDigest, now }).pipe(Effect.orDie)
        if (Option.isNone(found)) {
          return yield* new PairingCodeRejected()
        }
        const usedUp = sql`DELETE FROM phones_pairings WHERE code_digest = ${codeDigest}`
        return yield* newPhone(found.value.actor, input, caller, usedUp)
      })

      const pairFor = Effect.fn("Phones.pairFor")(function* (actor: Actor, input: PhoneDetails, caller: Caller) {
        return yield* newPhone(actor, input, caller, Effect.void)
      })

      const findPushTargets = SqlSchema.findAll({
        Request: Schema.Void,
        Result: Schema.Struct({ ...PushTarget.fields, actor: Schema.fromJsonString(Actor) }),
        execute: () => sql`SELECT u.phone, u.token, u.environment, p.actor
          FROM phones_push u JOIN phones_phones p ON p.id = u.phone ORDER BY u.phone`,
      })

      // The phone whose key this is, and who it acts for.
      const phoneOfKey = Effect.fn("Phones.phoneOfKey")(function* (key: Redacted.Redacted<PhoneKey>, caller: Caller) {
        const presented = Redacted.value(key)
        const id = PhoneId.make(presented.slice(keyPrefix.length, keyPrefix.length + 36))
        const found = yield* findKey(id).pipe(Effect.orDie)
        const digest = yield* digestOf(presented)
        // Both sides are digests, so comparing them in ordinary time reveals nothing about a key.
        if (Option.isNone(found) || found.value.digest !== digest) {
          return yield* new PhoneKeyRejected()
        }
        const phone = found.value
        const now = DateTime.toEpochMillis(yield* DateTime.now)
        const versions = versionsOf(caller.userAgent)
        if (
          Option.isSome(versions) &&
          (versions.value.systemVersion !== phone.systemVersion || versions.value.appVersion !== phone.appVersion)
        ) {
          const { systemVersion, appVersion } = versions.value
          yield* log.commit({
            source,
            actor: phone.actor,
            write: Effect.gen(function* () {
              yield* sql`UPDATE phones_phones SET system_version = ${systemVersion}, app_version = ${appVersion}
                WHERE id = ${id}`
              yield* recordSeen(id, now, caller)
            }).pipe(Effect.orDie),
            activity: () => [{ payload: PhoneUpdated.make({ phone: id, systemVersion, appVersion }) }],
          })
        } else if (
          phone.seenAt === null ||
          now - phone.seenAt >= seenEvery ||
          phone.address !== (caller.address ?? null)
        ) {
          yield* recordSeen(id, now, caller).pipe(Effect.orDie)
        }
        return { id, actor: phone.actor }
      })

      const authenticate = Effect.fn("Phones.authenticate")(function* (
        key: Redacted.Redacted<PhoneKey>,
        caller: Caller,
      ) {
        return (yield* phoneOfKey(key, caller)).actor
      })

      const registerPush = Effect.fn("Phones.registerPush")(function* (
        key: Redacted.Redacted<PhoneKey>,
        caller: Caller,
        push: RegisterPush,
      ) {
        const { id } = yield* phoneOfKey(key, caller)
        const now = DateTime.toEpochMillis(yield* DateTime.now)
        yield* sql
          .withTransaction(
            Effect.gen(function* () {
              yield* sql`DELETE FROM phones_push WHERE token = ${push.token} AND phone != ${id}`
              yield* sql`INSERT INTO phones_push ${sql.insert({ phone: id, token: push.token, environment: push.environment, registered_at: now })}
                ON CONFLICT (phone) DO UPDATE SET token = excluded.token, environment = excluded.environment,
                  registered_at = excluded.registered_at`
            }),
          )
          .pipe(Effect.orDie)
      })

      const pushTargets = findPushTargets(undefined).pipe(
        Effect.orDie,
        Effect.map((rows) => rows.map(({ actor, ...target }): PushTarget => ({ ...target, ...memberOf(actor) }))),
        Effect.withSpan("Phones.pushTargets"),
      )

      const removeAllOf = Effect.fn("Phones.removeAllOf")(function* (actor: Actor, member: MemberId) {
        const { phones: listed } = yield* phones
        for (const phone of listed.filter((each) => each.member === member)) {
          yield* remove(actor, phone.id).pipe(Effect.catchTag("PhoneNotFound", () => Effect.void))
        }
      })

      const forgetPushToken = Effect.fn("Phones.forgetPushToken")(function* (target: PushTarget) {
        yield* sql`DELETE FROM phones_push WHERE phone = ${target.phone} AND token = ${target.token}`.pipe(Effect.orDie)
      })

      const phones = findPhones(undefined).pipe(
        Effect.orDie,
        Effect.map((rows): PhoneList => ({ phones: rows.map(phoneOf) })),
        Effect.withSpan("Phones.phones"),
      )

      const remove = Effect.fn("Phones.remove")(function* (actor: Actor, phone: PhoneId) {
        yield* log.commit({
          source,
          actor,
          write: Effect.gen(function* () {
            const removed = yield* sql`DELETE FROM phones_phones WHERE id = ${phone} RETURNING id`.pipe(Effect.orDie)
            if (removed.length === 0) {
              return yield* new PhoneNotFound({ phone })
            }
            yield* sql`DELETE FROM phones_seen WHERE phone = ${phone}`.pipe(Effect.orDie)
            yield* sql`DELETE FROM phones_push WHERE phone = ${phone}`.pipe(Effect.orDie)
          }),
          activity: () => [{ payload: PhoneRemoved.make({ phone }) }],
        })
      })

      return Phones.of({
        startPairing,
        pair,
        pairFor,
        authenticate,
        phones,
        remove,
        removeAllOf,
        registerPush,
        pushTargets,
        forgetPushToken,
      })
    }),
  )
}
