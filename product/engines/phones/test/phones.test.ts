import type { Actor, Caller } from "@cluenori/foundation"
import { ActivityLog, MemberId } from "@cluenori/foundation"
import { assert, describe, it } from "@effect/vitest"
import { DateTime, Effect, Exit, Redacted } from "effect"
import { TestClock } from "effect/testing"

import type { PairPhone } from "../src/index.ts"
import { AppVersion, ModelIdentifier, PairingCode, PhoneKey, Phones, PushToken, SystemVersion } from "../src/index.ts"
import { inWorkspace } from "./in-workspace.ts"

// 2026-10-21T10:00:00Z.
const start = 1792576800000
const minute = 60_000

const member: Actor = { _tag: "Member", id: MemberId.make("0199f7a2-5c1e-7d3a-9b2f-4e8a1c6d0f53") }
const deployment = "https://cluenori.example"
const home: Caller = { address: "203.0.113.7", country: "PL", userAgent: "Cluenori/1.0 (1) iOS/27.0" }

// What the app sends to pair, with the code from a pairing's link.
const pairWith = (link: string, model = "iPhone19,3"): PairPhone => {
  const url = new URL(link)
  return {
    code: PairingCode.make(url.searchParams.get("code") ?? ""),
    model: ModelIdentifier.make(model),
    systemVersion: SystemVersion.make("27.0"),
    appVersion: AppVersion.make("1.0 (1)"),
  }
}

const startAndPair = (caller: Caller = home, model?: string) =>
  Effect.gen(function* () {
    const phones = yield* Phones
    const pairing = yield* phones.startPairing(member, deployment)
    return yield* phones.pair(pairWith(pairing.link, model), caller)
  })

const activityNames = Effect.gen(function* () {
  const log = yield* ActivityLog
  return (yield* log.latest).map((entry) => entry.name)
})

describe("Phones", () => {
  it.effect("pairs a phone once with the code of a pairing's link, for whoever started it", () =>
    inWorkspace(
      "pairs",
      start,
      Effect.gen(function* () {
        const phones = yield* Phones
        const pairing = yield* phones.startPairing(member, deployment)
        const link = new URL(pairing.link)
        assert.strictEqual(link.protocol, "cluenori:")
        assert.strictEqual(link.searchParams.get("url"), deployment)
        assert.strictEqual(DateTime.toEpochMillis(pairing.expiresAt), start + 10 * minute)

        const paired = yield* phones.pair(pairWith(pairing.link), home)
        assert.match(Redacted.value(paired.key), new RegExp(`^cluenori\\.phone\\.${paired.phone.id}\\.[\\w-]{43}$`))
        assert.strictEqual(
          yield* phones.authenticate(paired.key, home).pipe(Effect.map((actor) => actor._tag)),
          "Member",
        )

        const again = yield* phones.pair(pairWith(pairing.link), home).pipe(Effect.flip)
        assert.strictEqual(again._tag, "PairingCodeRejected")

        const { phones: listed } = yield* phones.phones
        assert.deepStrictEqual(
          listed.map((phone) => [phone.modelName, phone.systemVersion, phone.appVersion, phone.lastSeen?.address]),
          [["iPhone 18 Pro Max", "27.0", "1.0 (1)", "203.0.113.7"]],
        )
        assert.deepStrictEqual(yield* activityNames, ["phone.paired"])
      }),
    ),
  )

  it.effect("rejects a code 10 minutes on, and the oldest of 6 started", () =>
    inWorkspace(
      "codes",
      start,
      Effect.gen(function* () {
        const phones = yield* Phones
        const late = yield* phones.startPairing(member, deployment)
        yield* TestClock.setTime(start + 10 * minute)
        assert.strictEqual(
          (yield* phones.pair(pairWith(late.link), home).pipe(Effect.flip))._tag,
          "PairingCodeRejected",
        )

        const started = []
        for (let index = 0; index < 6; index++) {
          started.push(yield* phones.startPairing(member, deployment))
          yield* TestClock.adjust(1)
        }
        const [oldest, ...rest] = started
        assert.isTrue(Exit.isFailure(yield* phones.pair(pairWith(oldest?.link ?? ""), home).pipe(Effect.exit)))
        for (const pairing of rest) {
          yield* phones.pair(pairWith(pairing.link), home)
        }
        assert.strictEqual((yield* phones.phones).phones.length, 5)
      }),
    ),
  )

  it.effect("records a phone's calls at most once a minute from one address, and its new versions", () =>
    inWorkspace(
      "calls",
      start,
      Effect.gen(function* () {
        const phones = yield* Phones
        const { phone, key } = yield* startAndPair()
        const lastSeen = Effect.map(phones.phones, (list) => list.phones.find((each) => each.id === phone.id)?.lastSeen)

        yield* TestClock.setTime(start + 30_000)
        yield* phones.authenticate(key, home)
        assert.strictEqual(DateTime.toEpochMillis((yield* lastSeen)?.at ?? DateTime.makeUnsafe(0)), start)

        yield* phones.authenticate(key, { ...home, address: "198.51.100.4", country: "DE" })
        assert.deepStrictEqual(
          { ...(yield* lastSeen), at: undefined },
          { at: undefined, address: "198.51.100.4", country: "DE" },
        )

        yield* TestClock.setTime(start + 2 * minute)
        yield* phones.authenticate(key, { userAgent: "Cluenori/1.1 (7) iOS/27.1" })
        const updated = (yield* phones.phones).phones[0]
        assert.deepStrictEqual(
          [updated?.systemVersion, updated?.appVersion, updated?.lastSeen],
          ["27.1", "1.1 (7)", { at: DateTime.makeUnsafe(start + 2 * minute) }],
        )

        // Another app's User-Agent changes no version.
        yield* phones.authenticate(key, { ...home, userAgent: "curl/8.7.1" })
        assert.strictEqual((yield* phones.phones).phones[0]?.systemVersion, "27.1")
        assert.deepStrictEqual(yield* activityNames, ["phone.updated", "phone.paired"])
      }),
    ),
  )

  it.effect("stops a removed phone's key at once", () =>
    inWorkspace(
      "removes",
      start,
      Effect.gen(function* () {
        const phones = yield* Phones
        const { phone, key } = yield* startAndPair()
        yield* TestClock.adjust(minute)
        const other = yield* startAndPair(home, "iPhone99,1")
        assert.deepStrictEqual(
          (yield* phones.phones).phones.map((each) => each.modelName),
          ["iPhone99,1", "iPhone 18 Pro Max"],
        )

        yield* phones.remove(member, phone.id)
        assert.strictEqual((yield* phones.authenticate(key, home).pipe(Effect.flip))._tag, "PhoneKeyRejected")
        assert.strictEqual((yield* phones.remove(member, phone.id).pipe(Effect.flip))._tag, "PhoneNotFound")
        yield* phones.authenticate(other.key, home)

        // The other phone's ID with a made-up secret.
        const forged = Redacted.value(other.key).replace(/\.[\w-]{43}$/, `.${"A".repeat(43)}`)
        assert.strictEqual(
          (yield* phones.authenticate(Redacted.make(PhoneKey.make(forged)), home).pipe(Effect.flip))._tag,
          "PhoneKeyRejected",
        )
        assert.deepStrictEqual(yield* activityNames, ["phone.removed", "phone.paired", "phone.paired"])
        assert.isUndefined((yield* phones.phones).phones.find((each) => each.id === phone.id))

        // Each phone acts for the member who paired it; removing a member removes his phones.
        assert.deepStrictEqual(
          (yield* phones.phones).phones.map((each) => each.member),
          [member.id],
        )
        yield* phones.removeAllOf(member, member.id)
        assert.deepStrictEqual((yield* phones.phones).phones, [])
        assert.strictEqual((yield* phones.authenticate(other.key, home).pipe(Effect.flip))._tag, "PhoneKeyRejected")
      }),
    ),
  )

  it.effect("keeps each phone's latest push token, on one phone only, until APNs says it's gone", () =>
    inWorkspace(
      "pushes",
      start,
      Effect.gen(function* () {
        const phones = yield* Phones
        const first = yield* startAndPair()
        const second = yield* startAndPair(home, "iPhone18,2")
        const old = PushToken.make("a1".repeat(32))
        const fresh = PushToken.make("b2".repeat(32))
        const targetsOf = phones.pushTargets.pipe(
          Effect.map((targets) => targets.map((target) => [target.phone, target.token, target.environment])),
        )
        assert.deepStrictEqual(yield* phones.pushTargets, [])

        yield* phones.registerPush(first.key, home, { token: old, environment: "development" })
        yield* phones.registerPush(first.key, home, { token: fresh, environment: "production" })
        assert.deepStrictEqual(yield* targetsOf, [[first.phone.id, fresh, "production"]])

        // A token reaches one phone: the phone that registers it last.
        yield* phones.registerPush(second.key, home, { token: fresh, environment: "production" })
        assert.deepStrictEqual(yield* targetsOf, [[second.phone.id, fresh, "production"]])

        // A forget about a token since replaced removes nothing.
        yield* phones.registerPush(first.key, home, { token: old, environment: "production" })
        yield* phones.forgetPushToken({ phone: second.phone.id, token: old, environment: "production" })
        assert.strictEqual((yield* phones.pushTargets).length, 2)
        yield* phones.forgetPushToken({ phone: second.phone.id, token: fresh, environment: "production" })
        assert.deepStrictEqual(yield* targetsOf, [[first.phone.id, old, "production"]])

        // A removed phone's token goes with it, and its key registers none.
        yield* phones.remove(member, first.phone.id)
        assert.deepStrictEqual(yield* targetsOf, [])
        const rejected = yield* phones
          .registerPush(first.key, home, { token: old, environment: "production" })
          .pipe(Effect.flip)
        assert.strictEqual(rejected._tag, "PhoneKeyRejected")
        assert.deepStrictEqual(yield* activityNames, ["phone.removed", "phone.paired", "phone.paired"])
      }),
    ),
  )
})
