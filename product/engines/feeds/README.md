# @cluenori/feeds

Feeds: named live lists of the events an owner chose across projects, each project naming the same
moment its own way (`user.registered` in Notes, `signup_completed` in Folio), with alerts on members'
phones.

## Use it

```ts
// In the workspace's object: an owner makes a feed; the host tells each project's object what to
// watch from `watches`.
const feeds = yield* Feeds
const { result: feed, watches } = yield* feeds.save(actor, access, undefined, {
  name: "Registrations",
  level: "timeSensitive",
  sources: [
    { project: notes, event: EnvelopeName.make("user.registered") },
    { project: folio, event: EnvelopeName.make("signup_completed") },
  ],
})
// A member: NotAllowed. A source in a project the workspace doesn't have: ProjectNotFound.

// In each project's object, after the apps' signals took a batch:
yield* feedWatch.forward(component, country, batch)
// Each watched event from production becomes `feed_event.seen` activity, once per signal.

// In the workspace's object, for each batch the activity queue delivers:
const due = yield* feeds.record(activity)
// Entries made, alerts sent; `due` says when an alert held back is due, for the object's alarm.
```

## Owns

- **Data:** in the workspace's object, the feeds, their sources and their entries, kept 90 days
  (`feeds_feeds`, `feeds_sources`, `feeds_entries`); in each project's object, the event names its
  feeds watch, and which signals it forwarded in the last 14 days (`feed_watch_events`,
  `feed_watch_forwarded`).
- **Rules:**
  - **What becomes an entry:** an event an app sends from an environment its project calls
    production, whose name one of the project's sources names; once per signal, however often its
    batch is sent.
  - **Who sees what:** a member sees a feed's sources and entries of the projects they see; a feed
    with none of those isn't listed. Only an owner makes, changes and deletes feeds.
  - **Alerts:** at most one a minute a feed, holding the entries not alerted yet; none at level
    `none`, and entries that arrive at `none` never alert later. An alert APNs didn't take is sent
    again as it was, with the same entries and key, and what arrived meanwhile waits for the next;
    one alert goes at a time, so two deliveries at once don't send it twice.

## Does not own

- **The events themselves:** Signals keeps them, and Analytics counts them; deleting a feed loses
  none.
- **Pushing:** Notifications words each alert for each phone and sends it (`notifyFeed`).
- **Delivery:** each project's object delivers its activity to the queue on its alarm; the Worker's
  consumer hands each batch to `record`, and the workspace's object's alarm calls `alert` for an alert
  held back (`apps/worker`).

## Contract

`src/index.ts`. `Feeds` serves the workspace's side: listing, entries, saving and deleting, and
recording what projects forward; `FeedWatch` the project's side. `FeedsGroup` is the public API's
part.

## Depends on

`@cluenori/projects` for production environments, the workspace's index and `ProjectNotFound`;
`@cluenori/signals` for apps' batches and their IDs; `@cluenori/members` for what a member sees;
`@cluenori/notifications` to push alerts; Foundation's `ActivityLog`.

## Activity

Emits `feed.saved`, `feed.removed` and `feed_watch.changed` for what owners change, and
`feed_event.seen` in a project's object for each watched event. Reacts to `feed_event.seen`, from the
activity queue, by making entries.

## Background work

None of its own: the host's alarms run `record`'s and `alert`'s work (above).

## Decisions and constraints

- **What it trusts:** its caller, the host, which passes who is asking and what they see from
  verified credentials. Apps' batches are untrusted, and reach it only after Signals validated them;
  their device clocks are corrected by the batch's `sentAt`, and a time is never in the future.
- **Entries arrive within about a minute:** a project's object delivers its activity on its
  one-minute alarm. Live enough to watch, and the cost stays one queue message per batch of activity.
- **An alert's key is a UUID,** the feed's ID with its last part the newest entry's: the same entries
  make the same alert, which reaches each phone once, and phones take it as an alert's ID.
- **The host tells projects what to watch** after a change, from `watches`. One it fails to tell
  keeps watching what it did; saving the feed again tells them all.
- Not handled: more than 100 entries between two of a phone's asks leave a gap in what it shows
  until the screen opens again.
