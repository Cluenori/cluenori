import type { ApnsAnswer, ApnsCredentials, ApnsCredentialsInvalid, ApnsCrypto, ApnsPush } from "@bagatka/apns"
import { Apns, DeviceToken } from "@bagatka/apns"
import type { Envelope, MemberId, ProjectKey } from "@cluenori/foundation"
import type { Access } from "@cluenori/members"
import { canSee, Members } from "@cluenori/members"
import type { PhoneId, PushTarget } from "@cluenori/phones"
import { Phones } from "@cluenori/phones"
import { ProjectIndex } from "@cluenori/projects"
import { Clock, Context, Crypto, DateTime, Duration, Effect, Layer, Option, Result, Schema } from "effect"
import type { HttpClient } from "effect/http"
import { SqlClient, SqlSchema } from "effect/sql"

import type { Alert } from "./alert.ts"
import { alertOf, NoPushToken, payloadOf, PushNotSetUp, PushRejected, PushUnavailable } from "./alert.ts"
import { migrateNotifications } from "./notifications-migrations.ts"

/**
 * What the engine needs to push: APNs's key and the app's bundle ID, absent until push is set up,
 * and the platform's Web Crypto, which signs APNs's tokens.
 */
export interface NotificationsSettings {
  readonly push: Option.Option<{ readonly credentials: ApnsCredentials; readonly topic: string }>
  readonly signing: ApnsCrypto
}

// Which entry reached which phone is kept this long: longer than the platform retries a delivery.
const sentKept = Duration.toMillis(Duration.days(7))

// APNs keeps a push for a phone that is off this long, then drops it.
const keptByApns = Duration.hours(1)

// Apple's reasons for refusing a token that, besides Inactive, no longer reaches its phone: the
// phone says its environment, and the topic is the deployment's one app.
const goneReasons = new Set(["BadDeviceToken", "DeviceTokenNotForTopic"])

const SentKey = Schema.Struct({ envelope: Schema.String, phone: Schema.String })

/**
 * Tells the workspace's phones about its projects' incidents, through APNs. Runs inside the
 * workspace's Durable Object, beside Phones and the project index, which it asks.
 */
export class Notifications extends Context.Service<
  Notifications,
  {
    /**
     * Alerts every phone with a push token whose member sees the project about the incident
     * activity among `activity` in its project's production environments, at its level: an alarm when Down or Failing opens or gets worse; time sensitive when Stopped opens or
     * any incident reopens; quiet when one recovers or someone acknowledges it, which also stops its
     * alarm. Nothing about an incident someone is on, nor for other activity. An alarm more than 10
     * minutes late comes as time sensitive.
     *
     * Each entry reaches each phone once, however often it is delivered; a token APNs says is gone is
     * forgotten. Fails with `PushUnavailable` when APNs may take the rest later: what was sent stays
     * sent, so delivering all of it again is safe. Does nothing until push is set up. One push at a
     * time, each up to 10 seconds.
     */
    readonly notify: (activity: ReadonlyArray<Envelope>) => Effect.Effect<void, PushUnavailable>
    /**
     * Rings `phone` with a test alarm, as an incident's would, so its owner knows alerts reach it.
     * Fails with `PushNotSetUp`, with `NoPushToken` for a phone without one, with `PushRejected` when
     * APNs refuses it, such as for a wrong key, and with `PushUnavailable`.
     */
    readonly testAlert: (
      phone: PhoneId,
    ) => Effect.Effect<void, PushNotSetUp | NoPushToken | PushRejected | PushUnavailable>
  }
>()("@cluenori/notifications/notifications") {
  /** Builds the engine on the workspace's database, first creating or updating its tables. */
  static readonly layer = (
    settings: NotificationsSettings,
  ): Layer.Layer<
    Notifications,
    never,
    SqlClient.SqlClient | Phones | ProjectIndex | Members | Crypto.Crypto | HttpClient.HttpClient
  > =>
    Option.match(settings.push, {
      onNone: () => Layer.effect(Notifications, make(Option.none())),
      onSome: ({ credentials, topic }) =>
        Layer.effect(
          Notifications,
          Effect.gen(function* () {
            const apns = yield* Apns
            return yield* make(Option.some({ apns: Result.succeed(apns), bundleId: topic }))
          }),
        ).pipe(
          Layer.provide(Apns.layer(credentials, settings.signing)),
          // A key that can't sign leaves the workspace working: every alert is refused, and logged,
          // and a test alarm says why, until `./cluenori push setup` gives a key that can.
          Layer.catchTag("ApnsCredentialsInvalid", (invalid) =>
            Layer.effect(
              Notifications,
              Effect.logError("APNs's key can't sign", { reason: invalid.reason }).pipe(
                Effect.andThen(make(Option.some({ apns: Result.fail(invalid), bundleId: topic }))),
              ),
            ),
          ),
        ),
    })
}

/** APNs, or why its key can't sign, and the app's bundle ID its pushes are for. */
interface Pushing {
  readonly apns: Result.Result<Apns["Service"], ApnsCredentialsInvalid>
  readonly bundleId: string
}

/** What came of one alert to one phone: APNs's answer, or its refusal of the deployment's key. */
type Sent = ApnsAnswer | { readonly _tag: "KeyRefused"; readonly reason: string }

const make = (push: Option.Option<Pushing>) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const phones = yield* Phones
    const index = yield* ProjectIndex
    const members = yield* Members
    const crypto = yield* Crypto.Crypto
    yield* migrateNotifications.pipe(Effect.orDie)

    const findSent = SqlSchema.findAll({
      Request: Schema.Array(Schema.String),
      Result: SentKey,
      execute: (envelopes) =>
        sql`SELECT envelope, phone FROM notifications_sent WHERE ${sql.in("envelope", envelopes)}`,
    })

    // Sends one alert to one phone, forgetting a token APNs says is gone.
    const sendTo = Effect.fn("Notifications.sendTo")(function* (
      pushing: Pushing,
      target: PushTarget,
      alert: Alert,
    ): Effect.fn.Return<Sent, PushUnavailable> {
      if (Result.isFailure(pushing.apns)) {
        return { _tag: "KeyRefused", reason: pushing.apns.failure.reason }
      }
      const apnsPush: ApnsPush = {
        deviceToken: DeviceToken.make(target.token),
        environment: target.environment,
        bundleId: pushing.bundleId,
        pushType: "alert",
        priority: alert.level === "quiet" ? 5 : 10,
        payload: payloadOf(alert),
        collapseId: alert.alert,
        expiresAt: DateTime.addDuration(alert.at, keptByApns),
      }
      const answer: Sent = yield* pushing.apns.success.send(apnsPush).pipe(
        Effect.catchTag("ApnsCredentialsRefused", (refused) =>
          Effect.succeed({ _tag: "KeyRefused" as const, reason: refused.reason }),
        ),
        Effect.mapError((unavailable) => new PushUnavailable({ reason: unavailable.reason })),
      )
      if (answer._tag === "Inactive" || (answer._tag === "Rejected" && goneReasons.has(answer.reason))) {
        yield* phones.forgetPushToken(target)
      }
      return answer
    })

    const notify = Effect.fn("Notifications.notify")(function* (activity: ReadonlyArray<Envelope>) {
      if (Option.isNone(push)) {
        return
      }
      const now = yield* Clock.currentTimeMillis
      const names = new Map<string, string>((yield* index.all).map((project) => [project.key, project.name]))
      const alerts = activity.flatMap((entry) => {
        const projectName = entry.project === undefined ? "" : (names.get(entry.project) ?? entry.project)
        return Option.toArray(Option.map(alertOf(entry, projectName, now), (alert) => ({ entry: entry.id, alert })))
      })
      const targets = alerts.length === 0 ? [] : yield* phones.pushTargets
      if (targets.length === 0) {
        return
      }
      yield* sql`DELETE FROM notifications_sent WHERE at < ${now - sentKept}`.pipe(Effect.orDie)
      const sent = yield* findSent(alerts.map((each) => each.entry)).pipe(
        Effect.orDie,
        Effect.map((rows) => new Set(rows.map((row) => `${row.envelope} ${row.phone}`))),
      )
      // What each phone's member sees, asked once per notify; a removed member's phones see nothing.
      const accesses = new Map<MemberId, Access>()
      const sees = Effect.fn("Notifications.sees")(function* (member: MemberId | undefined, project: ProjectKey) {
        if (member === undefined) {
          return false
        }
        const known = accesses.get(member)
        const access =
          known ??
          (yield* members
            .accessOf(member)
            .pipe(Effect.orElseSucceed((): Access => ({ _tag: "Projects", projects: [] }))))
        accesses.set(member, access)
        return canSee(access, project)
      })
      for (const { entry, alert } of alerts) {
        for (const target of targets) {
          if (sent.has(`${entry} ${target.phone}`)) {
            continue
          }
          if (alert.incident === undefined || !(yield* sees(target.member, alert.incident.project))) {
            continue
          }
          const answer = yield* sendTo(push.value, target, alert)
          if (answer._tag === "KeyRefused" || (answer._tag === "Rejected" && !goneReasons.has(answer.reason))) {
            // Sending it again won't change Apple's answer, so it counts as sent.
            yield* Effect.logError("APNs refused an alert", { answer: answer._tag, reason: answer.reason })
          }
          yield* sql`INSERT OR IGNORE INTO notifications_sent ${sql.insert({ envelope: entry, phone: target.phone, at: now })}`.pipe(
            Effect.orDie,
          )
        }
      }
    })

    const testAlert = Effect.fn("Notifications.testAlert")(function* (phone: PhoneId) {
      if (Option.isNone(push)) {
        return yield* new PushNotSetUp()
      }
      const target = (yield* phones.pushTargets).find((each) => each.phone === phone)
      if (target === undefined) {
        return yield* new NoPushToken({ phone })
      }
      const alert: Alert = {
        level: "alarm",
        title: "Cluenori · Test alarm",
        body: "This is how a project that is down rings. Acknowledge stops it.",
        at: yield* DateTime.now,
        alert: yield* crypto.randomUUIDv7().pipe(Effect.orDie),
        incident: undefined,
      }
      const answer = yield* sendTo(push.value, target, alert)
      if (answer._tag === "Rejected" || answer._tag === "KeyRefused") {
        return yield* new PushRejected({ reason: answer.reason })
      }
    })

    return Notifications.of({ notify, testAlert })
  })
