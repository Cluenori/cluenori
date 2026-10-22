import { Effect } from "effect"
import { Migrator, SqlClient } from "effect/sql"

/** Creates and updates the engine's tables in the workspace's database. */
export const migrateGitHub = Migrator.make({})({
  table: "github_migrations",
  loader: Migrator.fromRecord({
    // The workspace's app, one row at most, with the private key and webhook secret GitHub gave it;
    // and connects started, by their state's SHA-256 digest, with who started each and for which
    // organization, until used or expired (Unix ms).
    "0001_github": Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`CREATE TABLE github_app (
        only INTEGER PRIMARY KEY CHECK (only = 1),
        app_id INTEGER NOT NULL,
        slug TEXT NOT NULL,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        organization TEXT,
        private_key TEXT NOT NULL,
        webhook_secret TEXT,
        connected_at TEXT NOT NULL
      )`
      yield* sql`CREATE TABLE github_connects (
        state_digest TEXT PRIMARY KEY,
        actor TEXT NOT NULL,
        organization TEXT,
        expires_at INTEGER NOT NULL
      )`
    }),
  }),
})
