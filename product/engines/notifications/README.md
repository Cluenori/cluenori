# @cluenori/notifications

Alerts about the workspace's incidents on its paired phones, through APNs: an alarm that rings
through silent mode, a time-sensitive notification, or a quiet one, by what happened.

## Use it

```ts
const notifications = yield* Notifications

// In the workspace's object, for each batch of activity the queue delivers:
yield* notifications.notify(activity)
// "Notes · Failing" rings every phone with a push token; delivering the batch again rings none twice.
// When APNs may take it later, PushUnavailable: deliver the whole batch again later.

// Its owner checks that alerts reach a phone:
yield* notifications.testAlert(phone)
// NoPushToken until the phone's app registers one; PushNotSetUp until push is set up.
```

## Owns

- **Data:** which activity entry reached which phone, kept 7 days (`notifications_sent`).
- **Rules:**
  - **Each change's level:** an alarm when Down or Failing opens or gets worse; time sensitive
    when Stopped opens or any incident reopens; quiet when one recovers or someone acknowledges it.
    Nothing about an incident someone is on, nor for other activity. An alarm more than 10 minutes
    late comes as time sensitive.
  - **What a push says:** "<project> · <what happened>", and the incident's title.
  - **Tokens that are gone:** a token APNs calls `BadDeviceToken`, `Unregistered` or
    `DeviceTokenNotForTopic` is forgotten, through Phones.
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

`@cluenori/phones` for push targets, `@cluenori/projects`' index for project names,
`@cluenori/incidents` for the activity it reads, `@bagatka/apns`, and an `HttpClient` the host
provides.

## Activity

Reacts to `incident.opened`, `incident.reopened`, `incident.worsened`, `incident.resolved` and
`incident.acknowledged`. Emits none: a push isn't a change to a record.

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
