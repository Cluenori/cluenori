import { Effect } from "effect"
import { Migrator, SqlClient } from "effect/sql"

/** Creates and updates the engine's tables in the workspace's database. */
export const migratePhones = Migrator.make({})({
  table: "phones_migrations",
  loader: Migrator.fromRecord({
    // Phones, each with its key's SHA-256 digest and the actor it acts for, as JSON; when and where
    // each last called, kept apart, in `phones_seen` (Unix ms): calls change it, without activity.
    // Pairings by their code's digest, with who started them, until used or expired (Unix ms).
    "0001_phones": Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`CREATE TABLE phones_phones (
        id TEXT PRIMARY KEY,
        model TEXT NOT NULL,
        system_version TEXT NOT NULL,
        app_version TEXT NOT NULL,
        key_digest TEXT NOT NULL,
        actor TEXT NOT NULL,
        paired_at TEXT NOT NULL
      )`
      yield* sql`CREATE TABLE phones_seen (
        phone TEXT PRIMARY KEY,
        at INTEGER NOT NULL,
        address TEXT,
        country TEXT
      ) WITHOUT ROWID`
      yield* sql`CREATE TABLE phones_pairings (
        code_digest TEXT PRIMARY KEY,
        actor TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      ) WITHOUT ROWID`
    }),
    // The push token each phone last registered, at most one per phone, and each token on one
    // phone only; registered when (Unix ms).
    "0002_push": Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`CREATE TABLE phones_push (
        phone TEXT PRIMARY KEY,
        token TEXT NOT NULL UNIQUE,
        environment TEXT NOT NULL,
        registered_at INTEGER NOT NULL
      ) WITHOUT ROWID`
    }),
  }),
})
