import { Effect } from "effect"
import { Migrator, SqlClient } from "effect/sql"

/** Creates and updates the engine's tables in a project's database. */
export const migrateSignals = Migrator.make({})({
  table: "signals_migrations",
  loader: Migrator.fromRecord({
    // Requests are counted per endpoint, environment ('' when unknown) and bucket (its start, Unix
    // milliseconds), with their durations as a quantile sketch in JSON: by the minute, kept 14
    // days, and by the hour, kept 15 months. An export's digest is kept for an hour, so a retry
    // isn't counted twice.
    "0001_requests": Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`CREATE TABLE signals_endpoints (
        id INTEGER PRIMARY KEY,
        component TEXT NOT NULL,
        name TEXT NOT NULL,
        UNIQUE (component, name)
      )`
      for (const table of ["signals_minute_counts", "signals_hour_counts"]) {
        yield* sql`CREATE TABLE ${sql(table)} (
          bucket INTEGER NOT NULL,
          endpoint INTEGER NOT NULL,
          environment TEXT NOT NULL,
          requests INTEGER NOT NULL,
          errors INTEGER NOT NULL,
          total_ms REAL NOT NULL,
          durations TEXT NOT NULL,
          PRIMARY KEY (bucket, endpoint, environment)
        ) WITHOUT ROWID`
      }
      yield* sql`CREATE TABLE signals_batches (
        digest TEXT PRIMARY KEY,
        received_at INTEGER NOT NULL
      ) WITHOUT ROWID`
    }),
  }),
})
