import type { ApnsCredentials, ApnsPush, ApnsSigning } from "@bagatka/apns"
import { Apns } from "@bagatka/apns"
import type { Envelope, MemberId, ProjectKey } from "@cluenori/foundation"
import type { Access } from "@cluenori/members"
import { canSee, Members } from "@cluenori/members"
import type { PhoneId, PushTarget } from "@cluenori/phones"
import { Phones } from "@cluenori/phones"
import { ProjectIndex } from "@cluenori/projects"
import { Clock, Context, Crypto, DateTime, Duration, Effect, Layer, Option, Schema } from "effect"
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
  readonly signing: ApnsSigning
}

// Which entry reached which phone is kept this long: longer than the platform retries a delivery.
const sentKept = Duration.toMillis(Duration.days(7))

// APNs keeps a push for a phone that is off this long, then drops it.
const keptByApns = Duration.toSeconds(Duration.hours(1))

// Apple's reasons for a token that no longer reaches its phone.
const goneReasons = new Set(["BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic"])

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
     * activity among `activity`, at its level: an alarm when Down or Failing opens or gets worse; time sensitive when Stopped opens or
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
            return yield* make(Option.some({ apns, topic }))
          }),
        ).pipe(Layer.provide(Apns.layer(credentials, settings.signing))),
    })
}

/** APNs, and the app's bundle ID its pushes are for. */
interface Pushing {
  readonly apns: Apns["Service"]
  readonly topic: string
}

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

    // Sends one alert to one phone: APNs's answer, with a token it says is gone forgotten.
    const sendTo = Effect.fn("Notifications.sendTo")(function* (pushing: Pushing, target: PushTarget, alert: Alert) {
      const apnsPush: ApnsPush = {
        deviceToken: target.token,
        environment: target.environment,
        topic: pushing.topic,
        priority: alert.level === "quiet" ? 5 : 10,
        payload: payloadOf(alert),
        collapseId: alert.alert,
        expiresAt: Math.floor(DateTime.toEpochMillis(alert.at) / 1000) + keptByApns,
      }
      const answer = yield* pushing.apns
        .send(apnsPush)
        .pipe(Effect.mapError((unavailable) => new PushUnavailable({ reason: unavailable.reason })))
      if (answer._tag === "Rejected" && goneReasons.has(answer.reason)) {
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
          if (answer._tag === "Rejected" && !goneReasons.has(answer.reason)) {
            // Sending it again won't change Apple's answer, so it counts as sent.
            yield* Effect.logError("APNs refused an alert", { reason: answer.reason, status: answer.status })
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
      if (answer._tag === "Rejected") {
        return yield* new PushRejected({ reason: answer.reason })
      }
    })

    return Notifications.of({ notify, testAlert })
  })
