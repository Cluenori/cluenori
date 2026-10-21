import type { ActivityPayload, Actor } from "@cluenori/foundation"
import {
  ComponentKey,
  Envelope,
  EnvelopeId,
  EnvelopeName,
  MemberId,
  ProcessName,
  ProjectKey,
  Source,
  WorkspaceKey,
} from "@cluenori/foundation"
import {
  IncidentAcknowledged,
  IncidentId,
  IncidentOpened,
  IncidentReopened,
  IncidentResolved,
  IncidentWorsened,
} from "@cluenori/incidents"
import type { Detector } from "@cluenori/incidents"
import type { Caller, PushEnvironment } from "@cluenori/phones"
import { AppVersion, ModelIdentifier, PairingCode, Phones, PushToken, SystemVersion } from "@cluenori/phones"
import { ProjectIndex, ProjectName } from "@cluenori/projects"
import { assert, describe, it } from "@effect/vitest"
import { DateTime, Effect, Option, Redacted, Schema } from "effect"
import { Base64 } from "effect/encoding"
import { TestClock } from "effect/testing"

import type { NotificationsSettings } from "../src/index.ts"
import { Notifications } from "../src/index.ts"
import type { ApnsReply } from "./in-workspace.ts"
import { fakeApns, inWorkspace } from "./in-workspace.ts"

// 2026-10-21T10:00:00Z.
const start = 1792576800000
const minute = 60_000

const notes = ProjectKey.make("notes")
const member: Actor = { _tag: "Member", id: MemberId.make("0199f7a2-5c1e-7d3a-9b2f-4e8a1c6d0f53") }
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
const phoneWith = (token: string, environment: PushEnvironment = "production") =>
  Effect.gen(function* () {
    const phones = yield* Phones
    const pairing = yield* phones.startPairing(member, "https://cluenori.example")
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

const notesProject = Effect.gen(function* () {
  const index = yield* ProjectIndex
  yield* index.record({
    key: notes,
    name: ProjectName.make("Notes"),
    createdAt: DateTime.makeUnsafe(start - 7 * 86_400_000),
  })
})

// What the tests read of a push's payload.
const decodePayload = Schema.decodeUnknownEffect(
  Schema.Struct({
    aps: Schema.Struct({
      alert: Schema.Struct({ title: Schema.String }),
      sound: Schema.optionalKey(Schema.String),
    }),
    cluenori: Schema.Struct({ level: Schema.String, incident: Schema.optionalKey(Schema.String) }),
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
          yield* notesProject
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

  it.effect("tells each change at its level, and nothing about an incident someone is on", () =>
    Effect.gen(function* () {
      const settings = yield* settingsWithKey
      const apns = fakeApns(accepts)
      yield* inWorkspace(
        "levels",
        start + 20 * minute,
        settings,
        apns.layer,
        Effect.gen(function* () {
          yield* notesProject
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
            activityOf(IncidentAcknowledged.make({ incident, title: fields.title })),
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
        ["Notes · Stopped", "timeSensitive", "default", "10"],
        ["Notes · Down", "timeSensitive", "default", "10"],
        ["Notes · Failing again", "timeSensitive", "default", "10"],
        ["Notes · Failing, worse", "alarm", "", "10"],
        ["Notes · Recovered", "quiet", "", "5"],
        ["Notes · Acknowledged", "quiet", "", "5"],
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
          yield* notesProject
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
})
