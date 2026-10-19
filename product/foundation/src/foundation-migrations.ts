import { Effect } from "effect"
import { Migrator, SqlClient } from "effect/sql"

/**
 * Creates and updates Foundation's tables in one project's or the workspace's database. Each
 * package tracks its migrations in a table of its own, so their numbers never collide.
 */
export const migrateFoundation = Migrator.make({})({
  table: "foundation_migrations",
  loader: Migrator.fromRecord({
    // `seq` is the commit order; AUTOINCREMENT never reuses one, even after rows are deleted.
    "0001_activity": Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`CREATE TABLE activity (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        ts TEXT NOT NULL,
        envelope TEXT NOT NULL
      )`
    }),
  }),
})
