import type { Actor } from "@cluenori/foundation"
import { ActivityLog, MemberId } from "@cluenori/foundation"
import { assert, describe, it } from "@effect/vitest"
import { DateTime, Effect, Exit, Redacted } from "effect"
import { TestClock } from "effect/testing"

import type { Caller, PairPhone } from "../src/index.ts"
import { AppVersion, ModelIdentifier, PairingCode, PhoneKey, Phones, SystemVersion } from "../src/index.ts"
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
      }),
    ),
  )
})
