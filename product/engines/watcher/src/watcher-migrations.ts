import { Effect } from "effect"
import { Migrator, SqlClient } from "effect/sql"

/** Creates and updates the engine's tables in the workspace's database. */
export const migrateWatcher = Migrator.make({})({
  table: "watcher_migrations",
  loader: Migrator.fromRecord({
    // The watcher's repository, one row at most; the SHA-256 digests of what was last written to
    // each of its secrets, so each is written only when it changes; and how the last write went:
    // when it was (Unix ms), how many phones it held, and the problem since a failed one.
    "0001_watcher": Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`CREATE TABLE watcher (
        only INTEGER PRIMARY KEY CHECK (only = 1),
        repository TEXT NOT NULL,
        key_digest TEXT,
        phones_digest TEXT,
        phones INTEGER,
        written_at INTEGER,
        problem TEXT,
        failed_at INTEGER
      )`
    }),
  }),
})
