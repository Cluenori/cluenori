import type { Actor } from "@cluenori/foundation"
import {
  ActivityLog,
  ComponentKey,
  Envelope,
  EnvelopeId,
  EnvelopeName,
  EnvironmentKey,
  InstallationId,
  MemberId,
  NotAllowed,
  ProcessName,
  ProjectKey,
  ReleaseVersion,
  SessionId,
  Source,
  WorkspaceKey,
} from "@cluenori/foundation"
import type { Access } from "@cluenori/members"
import { ProjectName, ProjectNotFound, Projects } from "@cluenori/projects"
import type { AppBatch } from "@cluenori/signals"
import { AppSignalId, AppUserId, CountryCode } from "@cluenori/signals"
import { assert, describe, it } from "@effect/vitest"
import { DateTime, Effect, Option, Schema } from "effect"
import { TestClock } from "effect/testing"

import type { FeedId, FeedInput } from "../src/index.ts"
import { FeedEventSeen, FeedNotFound, Feeds, FeedWatch } from "../src/index.ts"
import { inProject, inWorkspace, keptAlerts } from "./in-objects.ts"

// 2026-10-21T10:00:00Z.
const now = 1792576800000
const minute = 60_000
const day = 86_400_000

const notes = ProjectKey.make("notes")
const folio = ProjectKey.make("folio")
const atlas = ProjectKey.make("atlas")
const owner: Actor = { _tag: "Member", id: MemberId.make("0199f7a2-5c1e-7d3a-9b2f-4e8a1c6d0f53") }
const everything: Access = { _tag: "Everything" }
const onlyNotes: Access = { _tag: "Projects", projects: [notes] }
const registered = EnvelopeName.make("user.registered")
const signedUp = EnvelopeName.make("signup_completed")

// One project names a registration `user.registered`, the other `signup_completed`.
const registrations: FeedInput = {
  name: "Registrations",
  level: "timeSensitive",
  sources: [
    { project: notes, event: registered },
    { project: folio, event: signedUp },
  ],
}

let envelopes = 0
const idOf = () => {
  envelopes += 1
  return `0199f7a2-8000-7000-8000-${envelopes.toString(16).padStart(12, "0")}`
}

// A feed_event.seen entry of `project`'s activity, as its object commits it, for signal `signal`.
// Encoded as activity stores it: plain JSON, its time as ISO 8601 text.
const encodeSeen = Schema.encodeUnknownOption(FeedEventSeen)

const seen = (project: ProjectKey, event: EnvelopeName, signal: string, at: number) => {
  const encoded = encodeSeen(
    FeedEventSeen.make({
      signal: AppSignalId.make(signal),
      event,
      at: DateTime.makeUnsafe(at),
      component: ComponentKey.make(`${project}-ios`),
      environment: EnvironmentKey.make("production"),
      release: ReleaseVersion.make("2.4.0+12"),
      country: CountryCode.make("DE"),
      user: AppUserId.make("u-1"),
    }),
  )
  if (Option.isNone(encoded)) {
    throw new Error("A feed_event.seen the schema can't encode")
  }
  const { _tag, ...rest } = encoded.value
  return new Envelope({
    id: EnvelopeId.make(idOf()),
    ts: DateTime.makeUnsafe(at),
    kind: "activity",
    name: EnvelopeName.make(_tag),
    workspace: WorkspaceKey.make("main"),
    project,
    actor: { _tag: "System", process: ProcessName.make("feeds.watch") },
    source: Source.make("engine:feeds"),
    attrs: rest,
  })
}

const signal = (n: number) => `0199f7a2-9000-7000-8000-${n.toString(16).padStart(12, "0")}`

const save = (input: FeedInput, id?: FeedId) =>
  Effect.gen(function* () {
    const feeds = yield* Feeds
    return yield* feeds.save(owner, everything, id, input)
  })

describe("Feeds", () => {
  it.effect("makes each project's own name for an event an entry of the feed, once however often it arrives", () => {
    const { layer } = keptAlerts()
    return inWorkspace(
      "feeds-entries",
      now,
      layer,
      Effect.gen(function* () {
        const feeds = yield* Feeds
        const { result: feed } = yield* save(registrations)
        const notesSignup = seen(notes, registered, signal(1), now - 3 * minute)
        yield* feeds.record([
          notesSignup,
          seen(folio, signedUp, signal(2), now - 2 * minute),
          // Notes calls something else `signup_completed`; Folio, `user.registered`.
          seen(notes, signedUp, signal(3), now - minute),
          seen(folio, registered, signal(4), now - minute),
        ])
        // Delivered again, as the queue may.
        yield* feeds.record([notesSignup])
        const page = yield* feeds.entries(feed.id, everything, undefined)

        assert.deepStrictEqual(
          page.entries.map((entry): ReadonlyArray<string | undefined> => [
            entry.project,
            entry.event,
            entry.country,
            entry.user,
          ]),
          [
            [folio, signedUp, "DE", "u-1"],
            [notes, registered, "DE", "u-1"],
          ],
        )
        assert.deepStrictEqual([page.summary.lastDay, page.summary.lastWeek, page.summary.byProject.length], [2, 2, 2])
        assert.strictEqual(DateTime.toEpochMillis(page.summary.latest ?? DateTime.makeUnsafe(0)), now - 2 * minute)
      }),
    )
  })

  it.effect("alerts at most once a minute a feed, the entries in between in its next alert, and never at none", () => {
    const { alerts, layer } = keptAlerts()
    return inWorkspace(
      "feeds-alerts",
      now,
      layer,
      Effect.gen(function* () {
        const feeds = yield* Feeds
        yield* save(registrations)
        yield* save({ name: "Quiet", level: "none", sources: [{ project: notes, event: registered }] })
        const first = yield* feeds.record([seen(notes, registered, signal(11), now)])
        yield* TestClock.setTime(now + 20_000)
        const held = yield* feeds.record([
          seen(notes, registered, signal(12), now + 10_000),
          seen(folio, signedUp, signal(13), now + 15_000),
          seen(folio, signedUp, signal(14), now + 18_000),
        ])
        yield* TestClock.setTime(now + minute)
        const due = yield* feeds.alert
        const nothingLeft = yield* feeds.alert

        assert.deepStrictEqual(
          [first, held, due, nothingLeft],
          [Option.none(), Option.some(now + minute), Option.none(), Option.none()],
        )
        assert.deepStrictEqual(
          alerts.map((alert) => [alert.name, alert.level, alert.counts]),
          [
            ["Registrations", "timeSensitive", [{ project: notes, count: 1 }]],
            [
              "Registrations",
              "timeSensitive",
              [
                { project: folio, count: 2 },
                { project: notes, count: 1 },
              ],
            ],
          ],
        )
        assert.strictEqual(alerts[1]?.newest.project, folio)
        assert.notStrictEqual(alerts[0]?.key, alerts[1]?.key)
        // Phones know an alert by a UUID.
        for (const alert of alerts) {
          assert.match(alert.key, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
        }
      }),
    )
  })

  it.effect("finishes an alert APNs didn't take as it began, whatever arrives before it goes", () => {
    const { alerts, handed, layer } = keptAlerts(1)
    return inWorkspace(
      "feeds-alert-retried",
      now,
      layer,
      Effect.gen(function* () {
        const feeds = yield* Feeds
        yield* save(registrations)
        const refused = yield* Effect.flip(feeds.record([seen(notes, registered, signal(21), now)]))
        yield* TestClock.setTime(now + 1_000)
        const retried = yield* feeds.record([seen(folio, signedUp, signal(22), now + 1_000)])
        yield* TestClock.setTime(now + 1_000 + minute)
        const next = yield* feeds.alert

        assert.strictEqual(refused._tag, "PushUnavailable")
        assert.deepStrictEqual([retried, next], [Option.some(now + 1_000 + minute), Option.none()])
        // The alert handed over again is the same one; the entry that came meanwhile has its own.
        assert.deepStrictEqual(
          alerts.map((alert) => alert.counts),
          [[{ project: notes, count: 1 }], [{ project: folio, count: 1 }]],
        )
        assert.strictEqual(alerts[0]?.key, handed[0]?.key)
        assert.notStrictEqual(alerts[0]?.key, alerts[1]?.key)
      }),
    )
  })

  it.effect("keeps a minute between alerts when the owner silences a feed during one APNs didn't take", () => {
    const { alerts, layer } = keptAlerts(1)
    return inWorkspace(
      "feeds-alert-silenced",
      now,
      layer,
      Effect.gen(function* () {
        const feeds = yield* Feeds
        const { result: feed } = yield* save(registrations)
        yield* Effect.flip(feeds.record([seen(notes, registered, signal(41), now)]))
        yield* TestClock.setTime(now + 1_000)
        yield* save({ ...registrations, level: "none" }, feed.id)
        yield* save(registrations, feed.id)
        const held = yield* feeds.record([seen(folio, signedUp, signal(42), now + 1_000)])

        assert.deepStrictEqual([held, alerts.length], [Option.some(now + minute), 0])
      }),
    )
  })

  it.effect("sends an entry's alert once when the same entry arrives in two calls at once", () => {
    const { alerts, layer } = keptAlerts()
    return inWorkspace(
      "feeds-alert-concurrent",
      now,
      layer,
      Effect.gen(function* () {
        const feeds = yield* Feeds
        yield* save(registrations)
        const signup = seen(notes, registered, signal(31), now)
        yield* Effect.all([feeds.record([signup]), feeds.record([signup])], { concurrency: 2 })

        assert.deepStrictEqual(
          alerts.map((alert) => alert.counts),
          [[{ project: notes, count: 1 }]],
        )
      }),
    )
  })

  it.effect("shows a member only the sources and entries of the projects they see", () => {
    const { layer } = keptAlerts()
    return inWorkspace(
      "feeds-access",
      now,
      layer,
      Effect.gen(function* () {
        const feeds = yield* Feeds
        const { result: shared } = yield* save(registrations)
        const { result: hidden } = yield* save({
          name: "Atlas purchases",
          level: "quiet",
          sources: [{ project: atlas, event: EnvelopeName.make("purchase") }],
        })
        yield* feeds.record([
          seen(notes, registered, signal(21), now - minute),
          seen(folio, signedUp, signal(22), now - minute),
        ])
        const listed = yield* feeds.list(onlyNotes)
        const page = yield* feeds.entries(shared.id, onlyNotes, undefined)
        const refused = yield* feeds.entries(hidden.id, onlyNotes, undefined).pipe(Effect.flip)

        assert.deepStrictEqual(
          listed.feeds.map((each) => [each.feed.name, each.feed.sources, each.lastDay]),
          [["Registrations", [{ project: notes, event: registered }], 1]],
        )
        assert.deepStrictEqual(
          page.entries.map((entry) => entry.project),
          [notes],
        )
        assert.deepStrictEqual(refused, new FeedNotFound({ feed: hidden.id }))
      }),
    )
  })

  it.effect("lets only an owner change feeds, and says what each project must watch after", () => {
    const { layer } = keptAlerts()
    return inWorkspace(
      "feeds-changes",
      now,
      layer,
      Effect.gen(function* () {
        const feeds = yield* Feeds
        const member: Actor = { _tag: "Member", id: MemberId.make("0199f7a2-5c1e-7d3a-9b2f-4e8a1c6d0f54") }
        const refused = yield* feeds.save(member, onlyNotes, undefined, registrations).pipe(Effect.flip)
        const nowhere = yield* save({
          ...registrations,
          sources: [{ project: ProjectKey.make("ghost"), event: registered }],
        }).pipe(Effect.flip)
        const made = yield* save(registrations)
        // Folio leaves the feed: its object must stop forwarding.
        const changed = yield* save(
          { ...registrations, sources: [{ project: notes, event: registered }] },
          made.result.id,
        )
        const removed = yield* feeds.remove(owner, everything, made.result.id)
        const unknown = yield* feeds.remove(owner, everything, made.result.id).pipe(Effect.flip)

        assert.deepStrictEqual(refused, new NotAllowed())
        assert.deepStrictEqual(nowhere, new ProjectNotFound({ project: ProjectKey.make("ghost") }))
        assert.deepStrictEqual(made.watches, [
          { project: folio, events: [signedUp] },
          { project: notes, events: [registered] },
        ])
        assert.deepStrictEqual(changed.watches, [
          { project: folio, events: [] },
          { project: notes, events: [registered] },
        ])
        assert.deepStrictEqual(removed.watches, [{ project: notes, events: [] }])
        assert.deepStrictEqual(unknown, new FeedNotFound({ feed: made.result.id }))
      }),
    )
  })

  it.effect("forgets entries after 90 days", () => {
    const { layer } = keptAlerts()
    return inWorkspace(
      "feeds-kept",
      now,
      layer,
      Effect.gen(function* () {
        const feeds = yield* Feeds
        const { result: feed } = yield* save({ ...registrations, level: "none" })
        yield* feeds.record([seen(notes, registered, signal(31), now - 91 * day)])
        yield* feeds.record([seen(notes, registered, signal(32), now - 89 * day)])
        const page = yield* feeds.entries(feed.id, everything, undefined)
        assert.deepStrictEqual(
          page.entries.map((entry) => DateTime.toEpochMillis(entry.at)),
          [now - 89 * day],
        )
      }),
    )
  })
})

const installation = InstallationId.make("0199f7a2-a000-7000-8000-000000000001")
const session = SessionId.make("0199f7a2-a000-7000-8000-000000000002")

const batchOf = (environment: string, names: ReadonlyArray<[number, string]>, sentAt = now): AppBatch => ({
  installation,
  environment: EnvironmentKey.make(environment),
  release: ReleaseVersion.make("2.4.0+12"),
  device: { model: "iPhone17,2", platform: "iOS", osVersion: "27.2", locale: "de-DE", timeZone: "Europe/Berlin" },
  sdk: { name: "cluenori-swift", version: "0.1.0" },
  sentAt: DateTime.makeUnsafe(sentAt),
  signals: names.map(([n, name]) => ({
    _tag: "event" as const,
    id: AppSignalId.make(signal(n)),
    at: DateTime.makeUnsafe(now - minute),
    session,
    name: EnvelopeName.make(name),
  })),
})

const ios = ComponentKey.make("notes-ios")
const germany = CountryCode.make("DE")

describe("FeedWatch", () => {
  it.effect("forwards the watched events of production once, and none of staging or others", () =>
    inProject(
      "notes",
      now,
      Effect.gen(function* () {
        const projects = yield* Projects
        const watch = yield* FeedWatch
        const log = yield* ActivityLog
        yield* projects.create(owner, ProjectName.make("Notes"))
        const before = yield* watch.forward(ios, germany, batchOf("production", [[41, "user.registered"]]))
        yield* watch.watch([registered, registered])
        const forwarded = yield* watch.forward(
          ios,
          germany,
          batchOf("production", [
            [42, "user.registered"],
            [43, "note.created"],
            [42, "user.registered"],
          ]),
        )
        const again = yield* watch.forward(ios, germany, batchOf("production", [[42, "user.registered"]]))
        const staging = yield* watch.forward(ios, germany, batchOf("staging", [[44, "user.registered"]]))
        const latest = yield* log.latest
        const sent = latest.filter((entry) => entry.name === "feed_event.seen")

        assert.deepStrictEqual([before, forwarded, again, staging], [0, 1, 0, 0])
        assert.deepStrictEqual(
          sent.map((entry) => [entry.attrs["signal"], entry.attrs["event"], entry.attrs["country"], entry.component]),
          [[signal(42), "user.registered", "DE", ios]],
        )
        assert.deepStrictEqual(yield* watch.events, [registered])
      }),
    ),
  )

  it.effect("records a change of what it watches only when there is one, and corrects a device clock that is off", () =>
    inProject(
      "folio",
      now,
      Effect.gen(function* () {
        const projects = yield* Projects
        const watch = yield* FeedWatch
        const log = yield* ActivityLog
        yield* projects.create(owner, ProjectName.make("Folio"))
        yield* watch.watch([signedUp])
        yield* watch.watch([signedUp])
        // A device whose clock is an hour ahead.
        yield* watch.forward(ios, undefined, batchOf("production", [[51, "signup_completed"]], now + 3_600_000))
        const latest = yield* log.latest
        const changes = latest.filter((entry) => entry.name === "feed_watch.changed")
        const forwarded = latest.find((entry) => entry.name === "feed_event.seen")

        assert.strictEqual(changes.length, 1)
        assert.strictEqual(forwarded?.attrs["at"], DateTime.formatIso(DateTime.makeUnsafe(now - 61 * minute)))
        assert.isUndefined(forwarded?.attrs["country"])
      }),
    ),
  )
})
