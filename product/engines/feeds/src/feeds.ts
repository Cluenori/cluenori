import type { Actor, Envelope } from "@cluenori/foundation"
import { ActivityLog, EnvelopeName, NotAllowed, ProjectKey, Source } from "@cluenori/foundation"
import type { Access } from "@cluenori/members"
import { canSee } from "@cluenori/members"
import type { PushUnavailable } from "@cluenori/notifications"
import { Notifications } from "@cluenori/notifications"
import { ProjectIndex, ProjectNotFound } from "@cluenori/projects"
import { Clock, Context, Crypto, DateTime, Duration, Effect, Layer, Option, Schema, Semaphore } from "effect"
import { SqlClient, SqlSchema } from "effect/sql"

import type { Feed, FeedEntries, FeedInput, FeedList, FeedSummary } from "./feed.ts"
import { FeedEntry, FeedId, FeedLevel, FeedName, FeedNotFound } from "./feed.ts"
import { FeedEventSeen, FeedRemoved, FeedSaved } from "./feeds-activity.ts"
import { migrateFeeds } from "./feeds-migrations.ts"

const source = Source.make("engine:feeds")

// Entries are kept this long.
const entriesKept = Duration.toMillis(Duration.days(90))
// A feed alerts at most this often; what arrives in between comes in its next alert.
const alertEvery = Duration.toMillis(Duration.minutes(1))
const pageSize = 100
const hour = 3_600_000
const day = 24 * hour

/** The event names one project's feeds watch now: what its object must forward. */
export interface ProjectWatch {
  readonly project: ProjectKey
  readonly events: ReadonlyArray<EnvelopeName>
}

/** What a save or a delete changed: the feed, and what each project it touched must watch now. */
export interface FeedChange<A> {
  readonly result: A
  readonly watches: ReadonlyArray<ProjectWatch>
}

const FeedRow = Schema.Struct({
  id: FeedId,
  name: FeedName,
  level: FeedLevel,
  lastAlertAt: Schema.Int,
  alerting: Schema.Int,
})
const SourceRow = Schema.Struct({ feed: FeedId, project: ProjectKey, event: EnvelopeName })
const CountRow = Schema.Struct({
  project: ProjectKey,
  lastDay: Schema.Int,
  lastWeek: Schema.Int,
  latest: Schema.Int,
})
// An entry as stored: its ID is the row's own.
const { id: _rowId, ...storedFields } = FeedEntry.fields
const StoredEntry = Schema.fromJsonString(Schema.Struct(storedFields))
const EntryRow = Schema.Struct({ id: Schema.Int, entry: StoredEntry })
const DueRow = Schema.Struct({ project: ProjectKey, count: Schema.Int, last: Schema.Int })

const decodeSeen = Schema.decodeUnknownOption(FeedEventSeen)

/**
 * The workspace's feeds: live lists of the events the owner chose across projects, each project
 * naming them its own way, and the alerts they send. Runs in the workspace's Durable Object, beside
 * Notifications, which pushes its alerts.
 */
export class Feeds extends Context.Service<
  Feeds,
  {
    /** The feeds `access` sees, by name: each with only the sources of projects it sees. Reads only. */
    readonly list: (access: Access) => Effect.Effect<FeedList>
    /**
     * A page of one feed's entries that `access` sees, newest first, 100 at a time, `before` an
     * earlier page's `next`. Fails with `FeedNotFound` for a feed it doesn't see. Reads only.
     */
    readonly entries: (
      feed: FeedId,
      access: Access,
      before: number | undefined,
    ) => Effect.Effect<FeedEntries, FeedNotFound>
    /**
     * Makes a feed, or changes feed `id`, for an owner: its entries stay. Answers the feed, and what
     * each project it touched must watch now, which the host tells their objects. Fails with
     * `NotAllowed` for anyone else, `FeedNotFound` for an `id` there is no feed for, and
     * `ProjectNotFound` for a source in a project the workspace doesn't have.
     */
    readonly save: (
      actor: Actor,
      access: Access,
      id: FeedId | undefined,
      input: FeedInput,
    ) => Effect.Effect<FeedChange<Feed>, NotAllowed | FeedNotFound | ProjectNotFound>
    /** Deletes a feed and its entries, for an owner; as `save` does, answers what projects watch now. */
    readonly remove: (
      actor: Actor,
      access: Access,
      id: FeedId,
    ) => Effect.Effect<FeedChange<void>, NotAllowed | FeedNotFound>
    /** The event names `project`'s feeds watch. Reads only. */
    readonly watchedBy: (project: ProjectKey) => Effect.Effect<ProjectWatch>
    /**
     * Makes each `feed_event.seen` among `activity` an entry of every feed that watches its project
     * and event, once however often it is delivered, then sends the alerts that are due. Returns when
     * an alert held back will be due, for the host's alarm. Fails with `PushUnavailable` when APNs may
     * take the rest later: the entries stay, and their alert stays due.
     */
    readonly record: (activity: ReadonlyArray<Envelope>) => Effect.Effect<Option.Option<number>, PushUnavailable>
    /**
     * Sends each feed's due alert: its entries not alerted yet, in one alert, at most one a minute a
     * feed. Returns when an alert held back will be due (Unix ms). Fails with `PushUnavailable`, as
     * `record` does.
     */
    readonly alert: Effect.Effect<Option.Option<number>, PushUnavailable>
  }
>()("@cluenori/feeds/feeds") {
  /** Builds the engine on the workspace's database, first creating or updating its tables. */
  static readonly layer = Layer.effect(
    Feeds,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const log = yield* ActivityLog
      const crypto = yield* Crypto.Crypto
      const notifications = yield* Notifications
      const index = yield* ProjectIndex
      yield* migrateFeeds.pipe(Effect.orDie)
      const encodeEntry = Schema.encodeEffect(StoredEntry)
      const encodeSaved = Schema.encodeEffect(FeedSaved)

      const findFeeds = SqlSchema.findAll({
        Request: Schema.Void,
        Result: FeedRow,
        execute: () =>
          sql`SELECT id, name, level, last_alert_at AS "lastAlertAt", alerting FROM feeds_feeds ORDER BY name, id`,
      })
      const findSources = SqlSchema.findAll({
        Request: Schema.Void,
        Result: SourceRow,
        execute: () => sql`SELECT feed, project, event FROM feeds_sources ORDER BY project, event`,
      })

      // Every feed, with the sources `access` sees; those it sees none of are left out.
      const feedsSeen = Effect.fn("Feeds.feedsSeen")(function* (access: Access) {
        const rows = yield* findFeeds(undefined)
        const sources = yield* findSources(undefined)
        return rows.flatMap((row): ReadonlyArray<Feed> => {
          const seen = sources
            .filter((each) => each.feed === row.id && canSee(access, each.project))
            .map((each) => ({ project: each.project, event: each.event }))
          return seen.length === 0 ? [] : [{ id: row.id, name: row.name, level: row.level, sources: seen }]
        })
      }, Effect.orDie)

      const findCounts = SqlSchema.findAll({
        Request: Schema.Struct({ feed: FeedId, dayAgo: Schema.Int, weekAgo: Schema.Int }),
        Result: CountRow,
        execute: ({ feed, dayAgo, weekAgo }) => sql`
          SELECT project, sum(at >= ${dayAgo}) AS "lastDay", sum(at >= ${weekAgo}) AS "lastWeek", max(at) AS latest
          FROM feeds_entries WHERE feed = ${feed} GROUP BY project`,
      })

      const summaryOf = Effect.fn("Feeds.summaryOf")(function* (feed: Feed, now: number) {
        const projects = new Set(feed.sources.map((each) => each.project))
        const rows = (yield* findCounts({ feed: feed.id, dayAgo: now - day, weekAgo: now - 7 * day }).pipe(
          Effect.orDie,
        )).filter((row) => projects.has(row.project))
        const latest = Math.max(...rows.map((row) => row.latest))
        const summary: FeedSummary = {
          feed,
          lastDay: rows.reduce((sum, row) => sum + row.lastDay, 0),
          lastWeek: rows.reduce((sum, row) => sum + row.lastWeek, 0),
          byProject: rows
            .filter((row) => row.lastWeek > 0)
            .map((row) => ({ project: row.project, lastWeek: row.lastWeek }))
            .toSorted((left, right) => right.lastWeek - left.lastWeek || (left.project < right.project ? -1 : 1)),
          ...(rows.length === 0 ? {} : { latest: DateTime.makeUnsafe(latest) }),
        }
        return summary
      })

      const list = Effect.fn("Feeds.list")(function* (access: Access) {
        const now = yield* Clock.currentTimeMillis
        const feeds = yield* feedsSeen(access)
        const answer: FeedList = { feeds: yield* Effect.forEach(feeds, (feed) => summaryOf(feed, now)) }
        return answer
      })

      const findEntries = SqlSchema.findAll({
        Request: Schema.Struct({
          feed: FeedId,
          projects: Schema.Array(ProjectKey),
          before: Schema.Int,
        }),
        Result: EntryRow,
        execute: ({ feed, projects, before }) => sql`
          SELECT id, entry FROM feeds_entries
          WHERE feed = ${feed} AND id < ${before} AND ${sql.in("project", projects)}
          ORDER BY id DESC LIMIT ${pageSize + 1}`,
      })

      const entries = Effect.fn("Feeds.entries")(function* (id: FeedId, access: Access, before: number | undefined) {
        const feed = (yield* feedsSeen(access)).find((each) => each.id === id)
        if (feed === undefined) {
          return yield* new FeedNotFound({ feed: id })
        }
        const now = yield* Clock.currentTimeMillis
        const rows = yield* findEntries({
          feed: id,
          projects: [...new Set(feed.sources.map((each) => each.project))],
          before: before ?? Number.MAX_SAFE_INTEGER,
        }).pipe(Effect.orDie)
        const page = rows.slice(0, pageSize).map((row): FeedEntry => ({ id: row.id, ...row.entry }))
        const last = page.at(-1)
        const answer: FeedEntries = {
          summary: yield* summaryOf(feed, now),
          entries: page,
          ...(rows.length > pageSize && last !== undefined ? { next: last.id } : {}),
        }
        return answer
      })

      const findWatched = SqlSchema.findAll({
        Request: ProjectKey,
        Result: Schema.Struct({ event: EnvelopeName }),
        execute: (project) => sql`SELECT DISTINCT event FROM feeds_sources WHERE project = ${project} ORDER BY event`,
      })
      const watchedBy = Effect.fn("Feeds.watchedBy")(function* (project: ProjectKey) {
        const rows = yield* findWatched(project).pipe(Effect.orDie)
        const watch: ProjectWatch = { project, events: rows.map((row) => row.event) }
        return watch
      })
      const watchesOf = (projects: Iterable<ProjectKey>) =>
        Effect.forEach([...new Set(projects)].toSorted(), (project) => watchedBy(project))

      const projectsOf = SqlSchema.findAll({
        Request: FeedId,
        Result: Schema.Struct({ project: ProjectKey }),
        execute: (feed) => sql`SELECT DISTINCT project FROM feeds_sources WHERE feed = ${feed}`,
      })
      const exists = (id: FeedId) =>
        sql`SELECT id FROM feeds_feeds WHERE id = ${id}`.pipe(
          Effect.orDie,
          Effect.map((rows) => rows.length > 0),
        )

      const save = Effect.fn("Feeds.save")(function* (
        actor: Actor,
        access: Access,
        given: FeedId | undefined,
        input: FeedInput,
      ) {
        if (access._tag !== "Everything") {
          return yield* new NotAllowed()
        }
        const id = given ?? FeedId.make(yield* crypto.randomUUIDv7().pipe(Effect.orDie))
        if (given !== undefined && !(yield* exists(given))) {
          return yield* new FeedNotFound({ feed: given })
        }
        const known = new Set((yield* index.all).map((project) => project.key))
        const unknown = input.sources.find((each) => !known.has(each.project))
        if (unknown !== undefined) {
          return yield* new ProjectNotFound({ project: unknown.project })
        }
        const before = (yield* projectsOf(id).pipe(Effect.orDie)).map((row) => row.project)
        const feed: Feed = { id, ...input }
        const payload = yield* encodeSaved(FeedSaved.make({ feed: id, ...input })).pipe(Effect.orDie)
        yield* log.commit({
          source,
          actor,
          write: Effect.gen(function* () {
            yield* sql`INSERT INTO feeds_feeds ${sql.insert({ id, name: input.name, level: input.level, last_alert_at: 0, alerting: 0 })}
              ON CONFLICT (id) DO UPDATE SET name = excluded.name, level = excluded.level`
            yield* sql`DELETE FROM feeds_sources WHERE feed = ${id}`
            for (const each of input.sources) {
              yield* sql`INSERT INTO feeds_sources ${sql.insert({ feed: id, project: each.project, event: each.event })}`
            }
            // Entries that arrived while it alerted nobody don't alert now.
            if (input.level === "none") {
              yield* sql`UPDATE feeds_entries SET alerted = 1 WHERE feed = ${id} AND alerted = 0`
            }
          }).pipe(Effect.orDie),
          activity: () => [{ payload }],
        })
        const change: FeedChange<Feed> = {
          result: feed,
          watches: yield* watchesOf([...before, ...input.sources.map((each) => each.project)]),
        }
        return change
      })

      const remove = Effect.fn("Feeds.remove")(function* (actor: Actor, access: Access, id: FeedId) {
        if (access._tag !== "Everything") {
          return yield* new NotAllowed()
        }
        if (!(yield* exists(id))) {
          return yield* new FeedNotFound({ feed: id })
        }
        const before = (yield* projectsOf(id).pipe(Effect.orDie)).map((row) => row.project)
        yield* log.commit({
          source,
          actor,
          write: Effect.gen(function* () {
            yield* sql`DELETE FROM feeds_entries WHERE feed = ${id}`
            yield* sql`DELETE FROM feeds_sources WHERE feed = ${id}`
            yield* sql`DELETE FROM feeds_feeds WHERE id = ${id}`
          }).pipe(Effect.orDie),
          activity: () => [{ payload: FeedRemoved.make({ feed: id }) }],
        })
        const change: FeedChange<void> = { result: undefined, watches: yield* watchesOf(before) }
        return change
      })

      const findWatchers = SqlSchema.findAll({
        Request: Schema.Struct({ project: ProjectKey, event: EnvelopeName }),
        Result: Schema.Struct({ feed: FeedId, level: FeedLevel }),
        execute: ({ project, event }) => sql`
          SELECT s.feed, f.level FROM feeds_sources s JOIN feeds_feeds f ON f.id = s.feed
          WHERE s.project = ${project} AND s.event = ${event}`,
      })

      const findDue = SqlSchema.findAll({
        Request: Schema.Struct({ feed: FeedId, upTo: Schema.Int }),
        Result: DueRow,
        execute: ({ feed, upTo }) => sql`
          SELECT project, count(*) AS count, max(id) AS last FROM feeds_entries
          WHERE feed = ${feed} AND alerted = 0 AND id <= ${upTo} GROUP BY project ORDER BY count DESC, project`,
      })
      const findOne = SqlSchema.findAll({
        Request: Schema.Int,
        Result: EntryRow,
        execute: (id) => sql`SELECT id, entry FROM feeds_entries WHERE id = ${id}`,
      })

      // One alert at a time across the object's calls and its alarm: two at once would each read
      // the same entries as due and send them twice.
      const sending = yield* Semaphore.make(1)

      const alert = Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        let next: number | undefined
        for (const feed of yield* findFeeds(undefined).pipe(Effect.orDie)) {
          if (feed.level === "none") {
            continue
          }
          // An alert under way is finished as it began, with its entries and its key; it was due
          // already, so it isn't held back. One whose entries are gone (the feed went quiet) is over.
          let due = feed.alerting === 0 ? [] : yield* findDue({ feed: feed.id, upTo: feed.alerting }).pipe(Effect.orDie)
          if (due.length === 0) {
            if (now - feed.lastAlertAt < alertEvery) {
              const waiting = yield* findDue({ feed: feed.id, upTo: Number.MAX_SAFE_INTEGER }).pipe(Effect.orDie)
              if (waiting.length > 0) {
                next = Math.min(next ?? Number.MAX_SAFE_INTEGER, feed.lastAlertAt + alertEvery)
              }
              continue
            }
            due = yield* findDue({ feed: feed.id, upTo: Number.MAX_SAFE_INTEGER }).pipe(Effect.orDie)
          }
          if (due.length === 0) {
            continue
          }
          const last = Math.max(...due.map((row) => row.last))
          // A new alert's minute starts when it is first tried, so it holds even if the alert is
          // dropped (the feed goes quiet) before every phone has it.
          const startedAt = feed.alerting === 0 || last !== feed.alerting ? now : feed.lastAlertAt
          yield* sql`UPDATE feeds_feeds SET alerting = ${last}, last_alert_at = ${startedAt} WHERE id = ${feed.id}`.pipe(
            Effect.orDie,
          )
          const [newest] = yield* findOne(last).pipe(Effect.orDie)
          if (newest === undefined) {
            continue
          }
          yield* notifications.notifyFeed({
            // The same entries make the same alert, so delivering it again reaches each phone once:
            // the feed's ID, its last part the newest entry's, a UUID as phones take an alert's.
            key: `${feed.id.slice(0, 24)}${last.toString(16).padStart(12, "0")}`,
            feed: feed.id,
            name: feed.name,
            level: feed.level,
            at: newest.entry.at,
            counts: due.map((row) => ({ project: row.project, count: row.count })),
            newest: {
              project: newest.entry.project,
              component: newest.entry.component,
              release: newest.entry.release,
              ...(newest.entry.country === undefined ? {} : { country: newest.entry.country }),
            },
          })
          yield* sql`UPDATE feeds_entries SET alerted = 1 WHERE feed = ${feed.id} AND alerted = 0 AND id <= ${last}`.pipe(
            Effect.orDie,
          )
          yield* sql`UPDATE feeds_feeds SET last_alert_at = ${now}, alerting = 0 WHERE id = ${feed.id}`.pipe(
            Effect.orDie,
          )
          // Entries that came while it went wait for the next alert.
          const waiting = yield* findDue({ feed: feed.id, upTo: Number.MAX_SAFE_INTEGER }).pipe(Effect.orDie)
          if (waiting.length > 0) {
            next = Math.min(next ?? Number.MAX_SAFE_INTEGER, now + alertEvery)
          }
        }
        return Option.fromUndefinedOr(next)
      }).pipe(sending.withPermits(1), Effect.withSpan("Feeds.alert"))

      const record = Effect.fn("Feeds.record")(function* (activity: ReadonlyArray<Envelope>) {
        const now = yield* Clock.currentTimeMillis
        for (const entry of activity) {
          if (entry.kind !== "activity" || entry.project === undefined || entry.name !== "feed_event.seen") {
            continue
          }
          const seen = decodeSeen({ ...entry.attrs, _tag: entry.name })
          if (Option.isNone(seen)) {
            yield* Effect.logError("A feed_event.seen entry that isn't one", { id: entry.id })
            continue
          }
          const { signal, event, at, component, environment, release, country, user } = seen.value
          const project = entry.project
          const stored = yield* encodeEntry({
            project,
            event,
            at,
            component,
            environment,
            release,
            ...(country === undefined ? {} : { country }),
            ...(user === undefined ? {} : { user }),
          }).pipe(Effect.orDie)
          for (const watcher of yield* findWatchers({ project, event }).pipe(Effect.orDie)) {
            yield* sql`INSERT OR IGNORE INTO feeds_entries ${sql.insert({
              feed: watcher.feed,
              project,
              signal,
              at: DateTime.toEpochMillis(at),
              entry: stored,
              alerted: watcher.level === "none" ? 1 : 0,
            })}`.pipe(Effect.orDie)
          }
        }
        yield* sql`DELETE FROM feeds_entries WHERE at < ${now - entriesKept}`.pipe(Effect.orDie)
        return yield* alert
      })

      return Feeds.of({ list, entries, save, remove, watchedBy, record, alert })
    }),
  )
}
