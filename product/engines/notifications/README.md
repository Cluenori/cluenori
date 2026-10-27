# @cluenori/notifications

Alerts about the workspace's incidents and feeds on its paired phones, through APNs: an alarm that
rings through silent mode, a time-sensitive notification, or a quiet one, by what happened.

## Use it

```ts
const notifications = yield* Notifications

// In the workspace's object, for each batch of activity the queue delivers:
yield* notifications.notify(activity)
// "Notes · Failing" rings every phone with a push token; delivering the batch again rings none twice.
// When APNs may take it later, PushUnavailable: deliver the whole batch again later.

// Feeds hands over a feed's entries not alerted yet; each phone hears of its member's projects':
yield* notifications.notifyFeed(alert)
// "Folio · Registrations", "Germany, folio-ios 2.4.0+12"; or "12 Registrations", "Notes 9, Folio 3".

// Its owner checks that alerts reach a phone:
yield* notifications.testAlert(phone)
// NoPushToken until the phone's app registers one; PushNotSetUp until push is set up.
```

## Owns

- **Data:** which activity entry, or feed alert by its key, reached which phone, kept 7 days
  (`notifications_sent`).
- **Rules:**
  - **Each change's level:** an alarm when Down or Failing opens or gets worse; time sensitive
    when Stopped opens or any incident reopens; quiet when one recovers or someone acknowledges it.
    Time sensitive when an ingest key expires in 7 days and again in 1 day (`ingest_key.expiring`).
    Nothing about an incident someone is on, one in an environment its project doesn't call
    production, nor for other activity. An alarm more than 10 minutes
    late comes as time sensitive.
  - **Who is told:** the phones whose member sees the incident's project; an owner sees every one.
    Of an ingest key that expires, only owners' phones, since only owners manage keys.
  - **What a push says:** "<project> · <what happened>", and the incident's title. A feed's: one
    entry names its project and feed, "Folio · Registrations", and where it came from, "Germany,
    folio-ios 2.4.0+12"; more say how many from each project the phone's member sees, "12
    Registrations", "Notes 9, Folio 3", naming the three with most and counting the rest, "… and 4
    more", so it fits APNs's 4 KB. Never personal data: the person stays on the feed's page.
  - **Who hears of a feed:** each phone, of the entries in projects its member sees; none at all
    when they see none of them.
  - **Tokens that are gone:** a token APNs says is inactive (410), or calls `BadDeviceToken` or
    `DeviceTokenNotForTopic`, is forgotten, through Phones.
- **Integrations:** APNs, through `@bagatka/apns`.

## Does not own

- **Push tokens:** Phones keeps each phone's, which the app registers.
- **Delivery:** the project's object delivers its activity to the queue, and the Worker's consumer
  hands each batch to `notify` (`apps/worker`).
- **The alarm itself:** the app's notification extension starts it, from the push.

## Contract

`src/index.ts`. The host calls `notify` with the activity the queue delivers, and serves a test
alarm through `NotificationsGroup`.

## Depends on

`@cluenori/phones` for push targets, `@cluenori/members` for what each phone's member sees,
`@cluenori/projects`' index for project names,
`@cluenori/incidents` for the activity it reads, `@bagatka/apns`, and an `HttpClient` the host
provides.

## Activity

Reacts to `incident.opened`, `incident.reopened`, `incident.worsened`, `incident.resolved` and
`incident.acknowledged`, and `ingest_key.expiring`. Emits none: a push isn't a change to a record.

## Settings

APNs's key, its key ID and team ID, and the app's bundle ID, which differ per deployment and come
from `./cluenori push setup`; and the platform's Web Crypto, which signs APNs's tokens. Without the
key, nothing is pushed.

## Decisions and constraints

- **Every push wakes the app's notification extension** (`mutable-content`), and carries the
  incident's ID, which the alarm rings under: a later push about the incident, recovered or
  acknowledged, stops it on every phone. Pushes about one incident share an `apns-collapse-id`, so
  each phone shows its latest.
- **Quiet is passive:** shown without a sound or lighting the screen.
- **One push at a time.** A batch's pushes go in order, up to 10 seconds each; one that fails
  interrupts nothing in flight, and what was sent before stays sent.
- **Late pushes:** APNs keeps a push for a phone that is off for an hour. The app rings only for an
  alarm less than 10 minutes old.
- Not handled: telling anyone that alerts couldn't be delivered after the queue's last try; that
  takes a dead-letter queue and an item on Today.
