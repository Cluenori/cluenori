import { Effect } from "effect"
import { Migrator, SqlClient } from "effect/sql"

/** Creates and updates the engine's tables in the workspace's database. */
export const migrateFeeds = Migrator.make({})({
  table: "feeds_migrations",
  loader: Migrator.fromRecord({
    // Feeds, with when each last alerted (Unix ms, 0 before it did) and the newest entry of the
    // alert it is sending (0 when none is under way: until every phone has it, it stays the same
    // alert, and what arrives meanwhile waits for the next); their sources, each a project
    // and the event its apps track; and their entries, each signal once a feed, with when it
    // happened (Unix ms), the entry as JSON, and whether its alert went out (1) or is still due (0).
    "0001_feeds": Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`CREATE TABLE feeds_feeds (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        level TEXT NOT NULL,
        last_alert_at INTEGER NOT NULL,
        alerting INTEGER NOT NULL
      ) WITHOUT ROWID`
      yield* sql`CREATE TABLE feeds_sources (
        feed TEXT NOT NULL,
        project TEXT NOT NULL,
        event TEXT NOT NULL,
        PRIMARY KEY (feed, project, event)
      ) WITHOUT ROWID`
      yield* sql`CREATE INDEX feeds_sources_event ON feeds_sources (project, event)`
      yield* sql`CREATE TABLE feeds_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        feed TEXT NOT NULL,
        project TEXT NOT NULL,
        signal TEXT NOT NULL,
        at INTEGER NOT NULL,
        entry TEXT NOT NULL,
        alerted INTEGER NOT NULL,
        UNIQUE (feed, project, signal)
      )`
      yield* sql`CREATE INDEX feeds_entries_feed ON feeds_entries (feed, id)`
      yield* sql`CREATE INDEX feeds_entries_due ON feeds_entries (feed) WHERE alerted = 0`
      yield* sql`CREATE INDEX feeds_entries_at ON feeds_entries (at)`
    }),
    // Projects whose data was reset, with when (Unix ms): their events from activity committed
    // before then, delivered late, make no entries.
    "0002_forgotten": Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`CREATE TABLE feeds_forgotten (
        project TEXT PRIMARY KEY,
        before INTEGER NOT NULL
      ) WITHOUT ROWID`
    }),
  }),
})

/** Creates and updates the engine's tables in a project's database. */
export const migrateFeedWatch = Migrator.make({})({
  table: "feed_watch_migrations",
  loader: Migrator.fromRecord({
    // The event names the project's feeds watch, and each signal already forwarded, by when it
    // was (Unix ms), kept 14 days, as the apps' own duplicate window.
    "0001_feed_watch": Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`CREATE TABLE feed_watch_events (event TEXT PRIMARY KEY) WITHOUT ROWID`
      yield* sql`CREATE TABLE feed_watch_forwarded (signal TEXT PRIMARY KEY, at INTEGER NOT NULL) WITHOUT ROWID`
      yield* sql`CREATE INDEX feed_watch_forwarded_at ON feed_watch_forwarded (at)`
    }),
  }),
})
