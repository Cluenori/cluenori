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
    // Warnings and errors, each with its entry as JSON and what it is filtered by; the error groups
    // they belong to; and which archive file holds each export, by the time its records span.
    "0002_logs_errors_archive": Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`CREATE TABLE signals_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        time INTEGER NOT NULL,
        component TEXT NOT NULL,
        environment TEXT NOT NULL,
        level TEXT NOT NULL,
        category TEXT NOT NULL,
        error TEXT,
        trace TEXT,
        text TEXT NOT NULL,
        entry TEXT NOT NULL
      )`
      yield* sql`CREATE INDEX signals_logs_time ON signals_logs (time)`
      yield* sql`CREATE INDEX signals_logs_trace ON signals_logs (trace) WHERE trace IS NOT NULL`
      yield* sql`CREATE INDEX signals_logs_error ON signals_logs (error, time) WHERE error IS NOT NULL`
      yield* sql`CREATE TABLE signals_error_groups (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        culprit TEXT NOT NULL,
        first_seen INTEGER NOT NULL,
        last_seen INTEGER NOT NULL,
        last_component TEXT NOT NULL,
        last_environment TEXT NOT NULL,
        last_release TEXT NOT NULL
      ) WITHOUT ROWID`
      yield* sql`CREATE TABLE signals_archive (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        signal TEXT NOT NULL,
        component TEXT NOT NULL,
        from_time INTEGER NOT NULL,
        to_time INTEGER NOT NULL,
        key TEXT NOT NULL UNIQUE,
        received_at INTEGER NOT NULL
      )`
      yield* sql`CREATE INDEX signals_archive_time ON signals_archive (from_time, to_time)`
    }),
    // Which archive files hold each trace's records, so a trace is read from its own files, however
    // many others arrived around then. A trace is kept by the first 52 bits of its ID, as an integer:
    // as good as unique, and 8 bytes; a file shared by two traces with the same first bits is read
    // for both, and each finds only its own records in it. Files are found by trace now, not by time.
    "0003_trace_index": Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`CREATE TABLE signals_trace_files (
        trace INTEGER NOT NULL,
        file INTEGER NOT NULL,
        PRIMARY KEY (trace, file)
      ) WITHOUT ROWID`
      yield* sql`CREATE INDEX signals_trace_files_file ON signals_trace_files (file)`
      yield* sql`DROP INDEX signals_archive_time`
    }),
  }),
})
