import { softwareAuthenticator } from "@bagatka/webauthn"
import type { ActivityPayload, Actor } from "@cluenori/foundation"
import {
  ComponentKey,
  Envelope,
  EnvironmentKey,
  EnvelopeId,
  EnvelopeName,
  ProcessName,
  ProjectKey,
  Source,
  WorkspaceKey,
} from "@cluenori/foundation"
import type { Caller } from "@cluenori/foundation"
import {
  IncidentAcknowledged,
  IncidentId,
  IncidentOpened,
  IncidentReopened,
  IncidentResolved,
  IncidentWorsened,
} from "@cluenori/incidents"
import type { Detector } from "@cluenori/incidents"
import { Email, InviteCode, Members } from "@cluenori/members"
import type { PushEnvironment } from "@cluenori/phones"
import { AppVersion, ModelIdentifier, PairingCode, Phones, PushToken, SystemVersion } from "@cluenori/phones"
import { ProjectIndex, ProjectName } from "@cluenori/projects"
import { assert, describe, it } from "@effect/vitest"
import { DateTime, Effect, Option, Redacted, Schema } from "effect"
import { Base64 } from "effect/encoding"
import { TestClock } from "effect/testing"

import type { FeedAlert, NotificationsSettings } from "../src/index.ts"
import { Notifications } from "../src/index.ts"
import type { ApnsReply } from "./in-workspace.ts"
import { fakeApns, inWorkspace, owner } from "./in-workspace.ts"

// 2026-10-21T10:00:00Z.
const start = 1792576800000
const minute = 60_000

const notes = ProjectKey.make("notes")
const atlas = ProjectKey.make("atlas")
const member: Actor = { _tag: "Member", id: owner }
const home: Caller = { address: "203.0.113.7", country: "PL", userAgent: "Cluenori/1.0 (1) iOS/27.0" }
const incident = IncidentId.make("0199f7a2-6000-7000-8000-000000000001")
const down: Detector = "down"
const fields = {
  incident,
  detector: down,
  component: ComponentKey.make("notes-api"),
  subject: "https://notes.example/health",
  title: "https://notes.example/health is down: HTTP 503",
}

// A key of the tests' own, as Apple's `.p8` file holds one, with push set up for it.
const settingsWithKey = Effect.gen(function* () {
  const pair = yield* Effect.promise(() =>
    crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]),
  )
  if (!("privateKey" in pair)) {
    return yield* Effect.die("Web Crypto made one key, not a pair")
  }
  const exported = yield* Effect.promise(() => crypto.subtle.exportKey("pkcs8", pair.privateKey))
  if (!(exported instanceof ArrayBuffer)) {
    return yield* Effect.die("Web Crypto exported no PKCS #8 bytes")
  }
  const pem = `-----BEGIN PRIVATE KEY-----\n${Base64.encode(new Uint8Array(exported))}\n-----END PRIVATE KEY-----\n`
  const settings: NotificationsSettings = {
    push: Option.some({
      credentials: { key: Redacted.make(pem), keyId: "ABCDE12345", teamId: "TEAM123456" },
      topic: "com.example.cluenori",
    }),
    signing: crypto.subtle,
  }
  return settings
})

const notSetUp: NotificationsSettings = { push: Option.none(), signing: crypto.subtle }

let entries = 0

// One entry of `payload`'s activity in `project`, which happened at `at`.
const activityOf = (
  payload: ActivityPayload,
  at = start,
  scope: { readonly project?: ProjectKey } = { project: notes },
) => {
  entries += 1
  const { _tag, ...attrs } = payload
  return new Envelope({
    id: EnvelopeId.make(`0199f7a2-7000-7000-8000-${entries.toString(16).padStart(12, "0")}`),
    ts: DateTime.makeUnsafe(at),
    kind: "activity",
    name: EnvelopeName.make(_tag),
    workspace: WorkspaceKey.make("main"),
    ...scope,
    actor: { _tag: "System", process: ProcessName.make("incidents.check") },
    source: Source.make("engine:incidents"),
    attrs,
  })
}

// Pairs a phone, which registers `token` for `environment`; returns its ID.
const phoneWith = (token: string, environment: PushEnvironment = "production", pairedBy: Actor = member) =>
  Effect.gen(function* () {
    const phones = yield* Phones
    const pairing = yield* phones.startPairing(pairedBy, "https://cluenori.example")
    const { phone, key } = yield* phones.pair(
      {
        code: PairingCode.make(new URL(pairing.link).searchParams.get("code") ?? ""),
        model: ModelIdentifier.make("iPhone19,3"),
        systemVersion: SystemVersion.make("27.0"),
        appVersion: AppVersion.make("1.0 (1)"),
      },
      home,
    )
    yield* phones.registerPush(key, home, { token: PushToken.make(token), environment })
    return phone.id
  })

const withProjects = Effect.gen(function* () {
  const index = yield* ProjectIndex
  for (const [key, name] of [
    [notes, "Notes"],
    [atlas, "Atlas"],
  ] as const) {
    yield* index.record({ key, name: ProjectName.make(name), createdAt: DateTime.makeUnsafe(start - 7 * 86_400_000) })
  }
})

// Ada joins, seeing Atlas alone, and pairs a phone, which registers `otherToken`.
const adaSeesAtlas = Effect.gen(function* () {
  const members = yield* Members
  const site = { origin: "https://cluenori.example", rpId: "cluenori.example" }
  const invite = yield* members.invite(member, { email: Email.make("ada@example.com"), projects: [atlas] }, site)
  const code = InviteCode.make(new URL(invite.link).hash.slice(1))
  const options = yield* members.startJoining(code, site)
  const device = yield* softwareAuthenticator(crypto)
  const joined = yield* members.join(
    code,
    yield* device.register({ ...site, challenge: options.challenge }, { userHandle: options.user.id }),
    site,
    home,
  )
  yield* TestClock.adjust(minute)
  yield* phoneWith(otherToken, "production", { _tag: "Member", id: joined.member.id })
})

// What the tests read of a push's payload.
const decodePayload = Schema.decodeUnknownEffect(
  Schema.Struct({
    aps: Schema.Struct({
      alert: Schema.Struct({ title: Schema.String, body: Schema.optionalKey(Schema.String) }),
      sound: Schema.optionalKey(Schema.String),
    }),
    cluenori: Schema.Struct({
      level: Schema.String,
      incident: Schema.optionalKey(Schema.String),
      feed: Schema.optionalKey(Schema.String),
    }),
  }),
)

const accepts: ApnsReply = () => ({ status: 200 })
const phoneToken = "a1".repeat(32)
const otherToken = "b2".repeat(32)

const notify = (activity: ReadonlyArray<Envelope>) =>
  Effect.gen(function* () {
    const notifications = yield* Notifications
    yield* notifications.notify(activity)
  })

describe("Notifications", () => {
  it.effect("rings every phone once when a project goes down, however often the activity arrives", () =>
    Effect.gen(function* () {
      const settings = yield* settingsWithKey
      const apns = fakeApns(accepts)
      yield* inWorkspace(
        "rings",
        start,
        settings,
        apns.layer,
        Effect.gen(function* () {
          yield* withProjects
          yield* phoneWith(phoneToken, "development")
          // A minute on, so phones are told in the order they paired.
          yield* TestClock.adjust(minute)
          yield* phoneWith(otherToken)
          const opened = activityOf(IncidentOpened.make(fields))
          yield* notify([opened])
          yield* notify([opened])
        }),
      )
      assert.deepStrictEqual(
        apns.accepted.map((push) => [push.host, push.deviceToken]),
        [
          ["api.sandbox.push.apple.com", phoneToken],
          ["api.push.apple.com", otherToken],
        ],
      )
      const [first] = apns.accepted
      assert.strictEqual(first?.headers["apns-topic"], "com.example.cluenori")
      assert.strictEqual(first?.headers["apns-priority"], "10")
      assert.strictEqual(first?.headers["apns-collapse-id"], incident)
      assert.deepStrictEqual(first?.payload, {
        aps: {
          alert: { title: "Notes · Down", body: "https://notes.example/health is down: HTTP 503" },
          "interruption-level": "time-sensitive",
          category: "incident",
          "thread-id": "notes",
          "mutable-content": 1,
        },
        cluenori: {
          level: "alarm",
          at: "2026-10-21T10:00:00.000Z",
          alert: incident,
          project: "notes",
          incident,
        },
      })
    }),
  )

  it.effect(
    "tells each change at its level, and nothing about an incident someone is on, outside production, or stopped",
    () =>
      Effect.gen(function* () {
        const settings = yield* settingsWithKey
        const apns = fakeApns(accepts)
        yield* inWorkspace(
          "levels",
          start + 20 * minute,
          settings,
          apns.layer,
          Effect.gen(function* () {
            yield* withProjects
            yield* phoneWith(phoneToken)
            yield* notify([
              activityOf(
                IncidentOpened.make({ ...fields, detector: "failing", title: "POST /api/export: 18% failed" }),
                start + 19 * minute,
              ),
              activityOf(
                IncidentOpened.make({ ...fields, detector: "stopped", title: "cleanup.run stopped" }),
                start + 19 * minute,
              ),
              // Down 11 minutes ago: too late to ring.
              activityOf(IncidentOpened.make(fields), start + 9 * minute),
              activityOf(IncidentReopened.make({ ...fields, detector: "failing" })),
              activityOf(IncidentWorsened.make({ ...fields, detector: "failing" }), start + 19 * minute),
              activityOf(IncidentWorsened.make({ ...fields, acknowledged: true })),
              activityOf(IncidentResolved.make(fields)),
              activityOf(IncidentResolved.make({ ...fields, acknowledged: true })),
              // A stopped incident from when schedules were guessed ends: no one hears of it.
              activityOf(IncidentResolved.make({ ...fields, detector: "stopped", title: "cleanup.run stopped" })),
              activityOf(IncidentAcknowledged.make({ incident, title: fields.title })),
              // An incident in an environment the project doesn't call production, and one in one it does.
              activityOf(
                IncidentOpened.make({ ...fields, environment: EnvironmentKey.make("dev"), production: false }),
                start + 19 * minute,
              ),
              activityOf(
                IncidentOpened.make({
                  ...fields,
                  detector: "stopped",
                  title: "billing.run stopped",
                  environment: EnvironmentKey.make("prod"),
                  production: true,
                }),
                start + 19 * minute,
              ),
              // A project's other activity, and activity without a project.
              activityOf({ _tag: "project.created", project: "notes" }),
              activityOf(IncidentOpened.make(fields), start + 19 * minute, {}),
            ])
          }),
        )
        const told = yield* Effect.forEach(apns.accepted, (push) =>
          decodePayload(push.payload).pipe(
            Effect.map((payload) => [
              payload.aps.alert.title,
              payload.cluenori.level,
              payload.aps.sound ?? "",
              push.headers["apns-priority"],
            ]),
          ),
        )
        assert.deepStrictEqual(told, [
          ["Notes · Failing", "alarm", "", "10"],
          ["Notes · Down", "timeSensitive", "default", "10"],
          ["Notes · Failing again", "timeSensitive", "default", "10"],
          ["Notes · Failing, worse", "alarm", "", "10"],
          ["Notes · Recovered", "quiet", "", "5"],
          ["Notes · Acknowledged", "quiet", "", "5"],
        ])
      }),
  )

  it.effect(
    "tells a monitor's incidents at the monitor's level, titled with its subject and numbers, never a stopped one",
    () =>
      Effect.gen(function* () {
        const settings = yield* settingsWithKey
        const apns = fakeApns(accepts)
        yield* inWorkspace(
          "monitor-levels",
          start + 20 * minute,
          settings,
          apns.layer,
          Effect.gen(function* () {
            yield* withProjects
            yield* phoneWith(phoneToken)
            const job = { ...fields, detector: "monitor" as const, subject: "cleanup.run" }
            yield* notify([
              activityOf(
                IncidentOpened.make({ ...job, title: "cleanup.run hasn't run for 30 minutes", level: "timeSensitive" }),
                start + 19 * minute,
              ),
              activityOf(
                IncidentOpened.make({ ...job, title: "GET /api/card p95 820 ms, above 500 ms", level: "alarm" }),
                start + 19 * minute,
              ),
              activityOf(
                IncidentOpened.make({ ...job, title: "POST /api/sync: 12% failed, above 5%", level: "quiet" }),
                start + 19 * minute,
              ),
              activityOf(
                IncidentReopened.make({ ...job, title: "POST /api/sync: 12% failed, above 5%", level: "quiet" }),
              ),
              // A URL's monitor someone made quiet.
              activityOf(IncidentOpened.make({ ...fields, level: "quiet" }), start + 19 * minute),
              // A guessed stopped incident says nothing, whatever level an entry claims.
              activityOf(
                IncidentOpened.make({ ...fields, detector: "stopped", title: "cleanup.run stopped", level: "alarm" }),
                start + 19 * minute,
              ),
            ])
          }),
        )
        const told = yield* Effect.forEach(apns.accepted, (push) =>
          decodePayload(push.payload).pipe(
            Effect.map((payload) => [payload.aps.alert.title, payload.cluenori.level, payload.aps.alert.body ?? ""]),
          ),
        )
        assert.deepStrictEqual(told, [
          ["Notes · cleanup.run hasn't run for 30 minutes", "timeSensitive", ""],
          ["Notes · GET /api/card p95 820 ms, above 500 ms", "alarm", ""],
          ["Notes · POST /api/sync: 12% failed, above 5%", "quiet", ""],
          ["Notes · POST /api/sync: 12% failed, above 5% again", "quiet", ""],
          ["Notes · Down", "quiet", fields.title],
        ])
      }),
  )

  it.effect("forgets a token APNs says is gone, and leaves what it couldn't send for the next delivery", () =>
    Effect.gen(function* () {
      const settings = yield* settingsWithKey
      let available = false
      const apns = fakeApns((deviceToken) => {
        if (deviceToken === phoneToken) {
          return { status: 410, reason: "Unregistered" }
        }
        return available ? { status: 200 } : { status: 503, reason: "ServiceUnavailable" }
      })
      yield* inWorkspace(
        "retries",
        start,
        settings,
        apns.layer,
        Effect.gen(function* () {
          const phones = yield* Phones
          yield* withProjects
          yield* phoneWith(phoneToken)
          // A minute on, so phones are told in the order they paired.
          yield* TestClock.adjust(minute)
          yield* phoneWith(otherToken)
          const opened = activityOf(IncidentOpened.make(fields))

          const failed = yield* notify([opened]).pipe(Effect.flip)
          assert.strictEqual(failed._tag, "PushUnavailable")
          assert.deepStrictEqual(
            (yield* phones.pushTargets).map((target) => target.token),
            [otherToken],
          )

          available = true
          yield* notify([opened])
          yield* notify([opened])
        }),
      )
      assert.deepStrictEqual(
        apns.accepted.map((push) => push.deviceToken),
        [otherToken],
      )
    }),
  )

  it.effect("rings one phone with a test alarm, and says why it can't", () =>
    Effect.gen(function* () {
      const settings = yield* settingsWithKey
      const apns = fakeApns((deviceToken) =>
        deviceToken === otherToken ? { status: 400, reason: "BadDeviceToken" } : { status: 200 },
      )
      yield* inWorkspace(
        "tests",
        start,
        settings,
        apns.layer,
        Effect.gen(function* () {
          const notifications = yield* Notifications
          const phone = yield* phoneWith(phoneToken)
          yield* TestClock.adjust(minute)
          const other = yield* phoneWith(otherToken)
          yield* notifications.testAlert(phone)

          const rejected = yield* notifications.testAlert(other).pipe(Effect.flip)
          assert.deepStrictEqual(rejected._tag === "PushRejected" ? rejected.reason : rejected._tag, "BadDeviceToken")
          // Its token is gone now.
          assert.strictEqual((yield* notifications.testAlert(other).pipe(Effect.flip))._tag, "NoPushToken")
        }),
      )
      const [test] = apns.accepted
      const payload = yield* decodePayload(test?.payload)
      assert.strictEqual(apns.accepted.length, 1)
      assert.strictEqual(payload.aps.alert.title, "Cluenori · Test alarm")
      assert.strictEqual(payload.cluenori.level, "alarm")
      assert.isUndefined(payload.cluenori.incident)
    }),
  )

  it.effect("says why a test alarm can't ring when APNs refuses the key, or the key can't sign", () =>
    Effect.gen(function* () {
      const settings = yield* settingsWithKey
      const unsignable: NotificationsSettings = {
        ...settings,
        push: Option.map(settings.push, (push) => ({
          ...push,
          credentials: { ...push.credentials, key: Redacted.make("not a key") },
        })),
      }
      const refusing = fakeApns(() => ({ status: 403, reason: "InvalidProviderToken" }))
      const accepting = fakeApns(accepts)
      // Each test alarm twice: the phone's token is fine, so it is kept.
      const twice = Effect.gen(function* () {
        const notifications = yield* Notifications
        const phone = yield* phoneWith(phoneToken)
        const first = yield* notifications.testAlert(phone).pipe(Effect.flip)
        const second = yield* notifications.testAlert(phone).pipe(Effect.flip)
        return [first, second].map((failure) => (failure._tag === "PushRejected" ? failure.reason : failure._tag))
      })
      const refused = yield* inWorkspace("key-refused", start, settings, refusing.layer, twice)
      const invalid = yield* inWorkspace("key-invalid", start, unsignable, accepting.layer, twice)

      assert.deepStrictEqual(refused, ["InvalidProviderToken", "InvalidProviderToken"])
      assert.strictEqual(invalid[0], invalid[1])
      assert.include(invalid[0], "base64")
      assert.strictEqual(accepting.accepted.length, 0)
    }),
  )

  it.effect("pushes nothing until push is set up", () =>
    Effect.gen(function* () {
      const apns = fakeApns(accepts)
      yield* inWorkspace(
        "not-set-up",
        start,
        notSetUp,
        apns.layer,
        Effect.gen(function* () {
          const notifications = yield* Notifications
          const phone = yield* phoneWith(phoneToken)
          yield* notify([activityOf(IncidentOpened.make(fields))])
          assert.strictEqual((yield* notifications.testAlert(phone).pipe(Effect.flip))._tag, "PushNotSetUp")
        }),
      )
      assert.deepStrictEqual(apns.accepted, [])
    }),
  )

  it.effect("tells a member's phone only about the projects they see, and an owner's about every one", () =>
    Effect.gen(function* () {
      const settings = yield* settingsWithKey
      const apns = fakeApns(accepts)
      yield* inWorkspace(
        "members",
        start,
        settings,
        apns.layer,
        Effect.gen(function* () {
          yield* withProjects
          yield* phoneWith(phoneToken)
          yield* adaSeesAtlas

          yield* notify([
            activityOf(IncidentOpened.make(fields)),
            activityOf(
              IncidentOpened.make({ ...fields, incident: IncidentId.make("0199f7a2-6000-7000-8000-000000000009") }),
              start,
              {
                project: atlas,
              },
            ),
          ])
        }),
      )
      const told = yield* Effect.forEach(apns.accepted, (push) =>
        decodePayload(push.payload).pipe(Effect.map((payload) => [push.deviceToken, payload.aps.alert.title])),
      )
      assert.deepStrictEqual(told, [
        [phoneToken, "Notes · Down"],
        [phoneToken, "Atlas · Down"],
        [otherToken, "Atlas · Down"],
      ])
    }),
  )

  it.effect("tells each phone about a feed's entries in the projects its member sees, once", () =>
    Effect.gen(function* () {
      const settings = yield* settingsWithKey
      const apns = fakeApns(accepts)
      const feed: FeedAlert = {
        key: "0199f7a2-8000-7000-8000-000000000029",
        feed: "0199f7a2-8000-7000-8000-000000000001",
        name: "Registrations",
        level: "timeSensitive",
        at: DateTime.makeUnsafe(start),
        counts: [
          { project: notes, count: 2 },
          { project: atlas, count: 1 },
        ],
        newest: { project: atlas, component: "atlas-ios", release: "2.4.0+12", country: "DE" },
      }
      yield* inWorkspace(
        "feeds",
        start,
        settings,
        apns.layer,
        Effect.gen(function* () {
          yield* withProjects
          yield* phoneWith(phoneToken)
          yield* adaSeesAtlas
          const notifications = yield* Notifications
          yield* notifications.notifyFeed(feed)
          // Feeds hands the same entries over again, as after a retry.
          yield* notifications.notifyFeed(feed)
        }),
      )
      const told = yield* Effect.forEach(apns.accepted, (push) =>
        decodePayload(push.payload).pipe(
          Effect.map((payload) => [
            push.deviceToken,
            payload.aps.alert.title,
            payload.aps.alert.body,
            payload.cluenori.feed,
            payload.aps.sound,
          ]),
        ),
      )
      assert.deepStrictEqual(told, [
        [phoneToken, "3 Registrations", "Notes 2, Atlas 1", feed.feed, "default"],
        [otherToken, "Atlas · Registrations", "Germany, atlas-ios 2.4.0+12", feed.feed, "default"],
      ])
    }),
  )

  it.effect("names a feed's three busiest projects in its alert and counts the rest, however many it has", () =>
    Effect.gen(function* () {
      const settings = yield* settingsWithKey
      const apns = fakeApns(accepts)
      const projects = Array.from({ length: 50 }, (_, n) => ProjectKey.make(`project-${n + 1}`))
      yield* inWorkspace(
        "feeds-many",
        start,
        settings,
        apns.layer,
        Effect.gen(function* () {
          yield* phoneWith(phoneToken)
          const notifications = yield* Notifications
          yield* notifications.notifyFeed({
            key: "0199f7a2-8000-7000-8000-000000000031",
            feed: "0199f7a2-8000-7000-8000-000000000002",
            name: "Purchases",
            level: "quiet",
            at: DateTime.makeUnsafe(start),
            counts: projects.map((project, n) => ({ project, count: 60 - n })),
            newest: { project: notes, component: "notes-ios", release: "2.4.0+12" },
          })
        }),
      )
      const told = yield* Effect.forEach(apns.accepted, (push) =>
        decodePayload(push.payload).pipe(Effect.map((payload) => [payload.aps.alert.title, payload.aps.alert.body])),
      )
      assert.deepStrictEqual(told, [["1775 Purchases", "project-1 60, project-2 59, project-3 58 and 47 more"]])
    }),
  )
})
