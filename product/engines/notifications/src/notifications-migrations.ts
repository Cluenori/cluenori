import { Effect } from "effect"
import { Migrator, SqlClient } from "effect/sql"

/** Creates and updates the engine's tables in the workspace's database. */
export const migrateNotifications = Migrator.make({})({
  table: "notifications_migrations",
  loader: Migrator.fromRecord({
    // Each activity entry that reached each phone, kept 7 days (Unix ms), so delivering an entry
    // again pushes it to no phone twice.
    "0001_sent": Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`CREATE TABLE notifications_sent (
        envelope TEXT NOT NULL,
        phone TEXT NOT NULL,
        at INTEGER NOT NULL,
        PRIMARY KEY (envelope, phone)
      ) WITHOUT ROWID`
      yield* sql`CREATE INDEX notifications_sent_at ON notifications_sent (at)`
    }),
  }),
})
