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
      yield* sql`CREATE TABLE foundation_activity (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        ts TEXT NOT NULL,
        envelope TEXT NOT NULL
      )`
    }),
    // How far activity was delivered: the `seq` of the last entry sent. It starts at the newest
    // entry there is, so activity from before delivery began is never sent.
    "0002_delivery": Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`CREATE TABLE foundation_delivery (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        delivered_seq INTEGER NOT NULL
      )`
      yield* sql`INSERT INTO foundation_delivery (id, delivered_seq)
        SELECT 1, COALESCE(MAX(seq), 0) FROM foundation_activity`
    }),
  }),
})
