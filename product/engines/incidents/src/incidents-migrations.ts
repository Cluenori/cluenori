import { Effect } from "effect"
import { Migrator, SqlClient } from "effect/sql"

/** Creates and updates the engine's tables in a project's database. */
export const migrateIncidents = Migrator.make({})({
  table: "incidents_migrations",
  loader: Migrator.fromRecord({
    // Incidents, at most one open for each detector, component, environment ('' when unknown) and
    // subject, with their evidence as JSON and `level`, how bad it was when last told: the failure
    // rate of a failing operation, else 0. When a detector last saw each open one's problem is
    // kept apart, in `incidents_firing`: checks change it every minute, without activity.
    // Monitors, with their last check apart in `incidents_monitor_checks`. What the detectors learn
    // hourly from the counts, in `incidents_baselines`: each operation's usual error rate, and its
    // schedule (`gap_ms`, `last_ran_at` in Unix ms) when it runs on one. When they last learned and
    // looked, in `incidents_state`, one row.
    "0001_incidents": Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`CREATE TABLE incidents_incidents (
        id TEXT PRIMARY KEY,
        detector TEXT NOT NULL,
        component TEXT NOT NULL,
        environment TEXT NOT NULL,
        subject TEXT NOT NULL,
        title TEXT NOT NULL,
        evidence TEXT NOT NULL,
        level REAL NOT NULL,
        opened_at TEXT NOT NULL,
        resolved_at TEXT,
        acknowledged_at TEXT
      )`
      yield* sql`CREATE UNIQUE INDEX incidents_open ON incidents_incidents (detector, component, environment, subject)
        WHERE resolved_at IS NULL`
      yield* sql`CREATE INDEX incidents_resolved ON incidents_incidents (resolved_at) WHERE resolved_at IS NOT NULL`
      yield* sql`CREATE TABLE incidents_firing (
        incident TEXT PRIMARY KEY,
        last_firing_at INTEGER NOT NULL
      ) WITHOUT ROWID`
      yield* sql`CREATE TABLE incidents_monitors (
        id TEXT PRIMARY KEY,
        component TEXT NOT NULL,
        url TEXT NOT NULL,
        added_at TEXT NOT NULL,
        UNIQUE (component, url)
      )`
      yield* sql`CREATE TABLE incidents_monitor_checks (
        monitor TEXT PRIMARY KEY,
        failures INTEGER NOT NULL,
        problem TEXT,
        checked_at INTEGER NOT NULL
      ) WITHOUT ROWID`
      yield* sql`CREATE TABLE incidents_baselines (
        component TEXT NOT NULL,
        environment TEXT NOT NULL,
        operation TEXT NOT NULL,
        usual_rate REAL NOT NULL,
        gap_ms REAL,
        last_ran_at INTEGER,
        PRIMARY KEY (component, environment, operation)
      ) WITHOUT ROWID`
      yield* sql`CREATE TABLE incidents_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        learned_at INTEGER,
        checked_at INTEGER
      )`
    }),
    // Schedules are no longer learned (detectors.ts, "Stopped"): what was learned goes.
    "0002_no_learned_schedules": Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`ALTER TABLE incidents_baselines DROP COLUMN gap_ms`
      yield* sql`ALTER TABLE incidents_baselines DROP COLUMN last_ran_at`
    }),
  }),
})
