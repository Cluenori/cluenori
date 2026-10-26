import type { Envelope, ProjectKey } from "@cluenori/foundation"
import type { Detector, IncidentId } from "@cluenori/incidents"
import {
  AlertLevel,
  IncidentAcknowledged,
  IncidentOpened,
  IncidentReopened,
  IncidentResolved,
  IncidentWorsened,
} from "@cluenori/incidents"
import { PhoneId } from "@cluenori/phones"
import { DateTime, Duration, Option, Schema } from "effect"

/**
 * How an alert reaches a phone, Incidents' `AlertLevel`: `alarm` for Failing and as a monitor says;
 * `timeSensitive` for any reopened incident but a monitor's, and as a monitor says; `quiet` for an incident that
 * recovered, or that someone is on, and as a monitor says.
 */
export { AlertLevel }

/** What one push says, and how it reaches the phone. */
export interface Alert {
  readonly level: AlertLevel
  /** `notes · Failing`. */
  readonly title: string
  /** What is wrong, `POST /api/export: 18% failed, usually 0.1%`; absent when unknown. */
  readonly body: string | undefined
  /** When it happened. */
  readonly at: DateTime.Utc
  /**
   * The ID the phone's alarm for it rings under: the incident's, so a later push about the incident
   * stops it; a test's own.
   */
  readonly alert: string
  /** The incident it is about; absent for a test and a feed's. */
  readonly incident: { readonly project: ProjectKey; readonly id: IncidentId } | undefined
  /** The feed it is about, whose alerts a phone groups together; absent for others. */
  readonly feed?: string
}

/**
 * What a feed's alert says, as Feeds hands it over: the entries not alerted yet, by project, the
 * most first, and the newest of them. `key`, a UUID, is the same for the same entries, so it reaches
 * each phone once however often it is handed over; phones know the alert by it.
 */
export interface FeedAlert {
  readonly key: string
  readonly feed: string
  /** The feed's name: `Registrations`. */
  readonly name: string
  readonly level: "quiet" | "timeSensitive"
  /** When the newest entry happened. */
  readonly at: DateTime.Utc
  readonly counts: ReadonlyArray<{ readonly project: ProjectKey; readonly count: number }>
  readonly newest: {
    readonly project: ProjectKey
    readonly component: string
    readonly release: string
    readonly country?: string
  }
}

// Countries by their names in English, as alerts say them, whatever the machine's locale.
const countries = new Intl.DisplayNames(["en"], { type: "region" })
const countryName = (code: string) => countries.of(code) ?? code

// An alert names this many projects, those with the most entries; the rest are counted, so it
// stays within the 4 KB APNs takes however many sources the feed has.
const projectsNamed = 3
const byProject = (counts: FeedAlert["counts"], nameOf: (project: ProjectKey) => string) => {
  const named = counts.slice(0, projectsNamed).map((each) => `${nameOf(each.project)} ${each.count}`)
  const more = counts.length - projectsNamed
  return more > 0 ? `${named.join(", ")} and ${more} more` : named.join(", ")
}

/**
 * The alert a feed's entries are, for a member who sees `counts` of them (those of projects they
 * see), with projects named by `nameOf`: one entry names its project and where it came from, \`Folio
 * · Registrations\`, \`Germany, folio-ios 2.4.0+12\`; more say how many from each, \`12 Registrations\`,
 * \`Notes 9, Folio 3\`, the three with most named and the rest counted, \`… and 4 more\`. No personal data: the person stays on the feed's page.
 */
export const feedAlertOf = (
  feed: FeedAlert,
  counts: FeedAlert["counts"],
  nameOf: (project: ProjectKey) => string,
): Alert => {
  const total = counts.reduce((sum, each) => sum + each.count, 0)
  const [only] = counts
  const single = total === 1 && only !== undefined
  const newest = single && only.project === feed.newest.project ? feed.newest : undefined
  const where =
    newest === undefined
      ? undefined
      : [
          newest.country === undefined ? undefined : countryName(newest.country),
          `${newest.component} ${newest.release}`,
        ]
          .filter((part) => part !== undefined)
          .join(", ")
  return {
    level: feed.level,
    title: single ? `${nameOf(only.project)} · ${feed.name}` : `${total} ${feed.name}`,
    body: single ? where : byProject(counts, nameOf),
    at: feed.at,
    alert: feed.key,
    incident: undefined,
    feed: feed.feed,
  }
}

const IncidentActivity = Schema.Union([
  IncidentOpened,
  IncidentReopened,
  IncidentWorsened,
  IncidentResolved,
  IncidentAcknowledged,
])
const decodeIncidentActivity = Schema.decodeUnknownOption(IncidentActivity)

// An alarm this late comes as time sensitive: it would ring about the past.
const alarmsWithin = Duration.toMillis(Duration.minutes(10))

const detectorWords: Readonly<Record<Detector, string>> = {
  down: "Down",
  failing: "Failing",
  stopped: "Stopped",
  monitor: "Monitor",
}
// Each detector's own level, for activity that doesn't say its monitor's.
const detectorLevels: Readonly<Record<Detector, AlertLevel>> = {
  down: "alarm",
  failing: "alarm",
  stopped: "timeSensitive",
  monitor: "timeSensitive",
}

/**
 * The alert one activity entry is, at `now` (Unix ms), for the project named `projectName`: none for
 * activity that isn't about an incident, about one someone is on, about one in an environment its
 * project doesn't call production, or about a stopped one, which was guessed. An entry that doesn't
 * say, from before October 2026, counts as production. A monitor's incident comes at the monitor's
 * level, titled with its subject and numbers: `Graphit · cleanup.run hasn't run for 30 minutes`.
 */
export const alertOf = (entry: Envelope, projectName: string, now: number): Option.Option<Alert> => {
  const project = entry.project
  if (entry.kind !== "activity" || project === undefined) {
    return Option.none()
  }
  const decoded = decodeIncidentActivity({ ...entry.attrs, _tag: entry.name })
  if (Option.isNone(decoded)) {
    return Option.none()
  }
  const activity = decoded.value
  // Stopped incidents came from schedules guessed from how operations ran, and every alert must be
  // real: none opens now, and none from before tells anyone anything, however late it is delivered
  // or however it ends. A job someone declared is a monitor's, detector `monitor`.
  // Not handled: an acknowledgment of a stopped incident from before November 2026, which doesn't
  // say its detector, still comes as a quiet "Acknowledged"; any queued then was delivered long ago.
  if (activity.production === false || ("detector" in activity && activity.detector === "stopped")) {
    return Option.none()
  }
  const late = now - DateTime.toEpochMillis(entry.ts) > alarmsWithin
  const alertAs = (level: AlertLevel, what: string, body: string | undefined): Option.Option<Alert> =>
    Option.some({
      level: level === "alarm" && late ? "timeSensitive" : level,
      title: `${projectName} · ${what}`,
      body,
      at: entry.ts,
      alert: activity.incident,
      incident: { project, id: activity.incident },
    })
  // A detector's alert is named by its word, its title in the body; a monitor's says its subject and
  // numbers in the title.
  const fired = (detector: Detector, level: AlertLevel, title: string, what?: string) =>
    detector === "monitor"
      ? alertAs(level, what === undefined ? title : `${title}${what}`, undefined)
      : alertAs(level, what === undefined ? detectorWords[detector] : `${detectorWords[detector]}${what}`, title)
  switch (activity._tag) {
    case "incident.opened":
      return fired(activity.detector, activity.level ?? detectorLevels[activity.detector], activity.title)
    case "incident.worsened":
      return activity.acknowledged === true
        ? Option.none()
        : fired(activity.detector, activity.level ?? detectorLevels[activity.detector], activity.title, ", worse")
    case "incident.reopened":
      // A monitor's comes back at the level its owner chose. Any other detector's, back so soon, is
      // worth breaking through a Focus, as Down and Failing always came.
      return fired(
        activity.detector,
        activity.detector === "monitor" ? (activity.level ?? detectorLevels.monitor) : "timeSensitive",
        activity.title,
        " again",
      )
    case "incident.resolved":
      return activity.acknowledged === true ? Option.none() : alertAs("quiet", "Recovered", activity.title)
    case "incident.acknowledged":
      return alertAs("quiet", "Acknowledged", activity.title)
  }
}

/**
 * The APNs payload of `alert`. Every one wakes the app's notification extension (`mutable-content`),
 * which starts an alarm's ringing, and stops it when a later push says the incident recovered or
 * someone is on it. The app reads its own part from `cluenori`.
 */
export const payloadOf = (alert: Alert): Schema.JsonObject => ({
  aps: {
    alert: { title: alert.title, ...(alert.body === undefined ? {} : { body: alert.body }) },
    "interruption-level": alert.level === "quiet" ? "passive" : "time-sensitive",
    // An alarm rings on its own; its notification is silent.
    ...(alert.level === "timeSensitive" ? { sound: "default" } : {}),
    // The category whose actions the app registers: Acknowledge.
    ...(alert.level === "quiet" || alert.incident === undefined ? {} : { category: "incident" }),
    ...(alert.incident === undefined ? {} : { "thread-id": alert.incident.project }),
    ...(alert.feed === undefined ? {} : { "thread-id": `feed:${alert.feed}` }),
    "mutable-content": 1,
  },
  cluenori: {
    level: alert.level,
    at: DateTime.formatIso(alert.at),
    alert: alert.alert,
    ...(alert.incident === undefined ? {} : { project: alert.incident.project, incident: alert.incident.id }),
    ...(alert.feed === undefined ? {} : { feed: alert.feed }),
  },
})

/** Push isn't set up: `./cluenori push setup` gives the deployment APNs's key. */
export class PushNotSetUp extends Schema.TaggedError<PushNotSetUp>()("PushNotSetUp", {}) {}

/** The phone has no push token: it was removed, or its app hasn't registered one since pairing. */
export class NoPushToken extends Schema.TaggedError<NoPushToken>()("NoPushToken", { phone: PhoneId }) {}

/**
 * APNs refused the push for `reason`, Apple's word for it, such as `BadDeviceToken` or
 * `InvalidProviderToken`; sending it again won't change that.
 */
export class PushRejected extends Schema.TaggedError<PushRejected>()("PushRejected", { reason: Schema.String }) {}

/** APNs didn't take the push now, for `reason`; it may later. */
export class PushUnavailable extends Schema.TaggedError<PushUnavailable>()("PushUnavailable", {
  reason: Schema.String,
}) {}
