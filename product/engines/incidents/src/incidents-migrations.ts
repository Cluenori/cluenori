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
    // An incident's life, `incidents_updates`, one row a change in the order they happened, the title
    // it said then for those that changed it. A monitor's checks: every one 7 days
    // (`incidents_check_history`, Unix ms, the status and the time of an answer, NULL without one),
    // and each UTC day's counts 90 days (`incidents_check_days`, days since 1970); and since when
    // it has passed or failed as it does now (`since`, Unix ms) beside its last check.
    // Not handled: what happened before this migration is known only from the incidents' columns,
    // so their worsenings and reopenings are lost, and an opening is said with the latest title; a
    // monitor's checks before it, and since when it passed or failed, are unknown.
    "0003_updates_and_checks": Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`CREATE TABLE incidents_updates (
        id INTEGER PRIMARY KEY,
        incident TEXT NOT NULL,
        at TEXT NOT NULL,
        change TEXT NOT NULL,
        title TEXT
      )`
      yield* sql`CREATE INDEX incidents_updates_of ON incidents_updates (incident, id)`
      yield* sql`INSERT INTO incidents_updates (incident, at, change, title)
        SELECT incident, at, change, title FROM (
          SELECT id AS incident, opened_at AS at, 'opened' AS change, title, 0 AS rank FROM incidents_incidents
          UNION ALL
          SELECT id, acknowledged_at, 'acknowledged', NULL, 1 FROM incidents_incidents
            WHERE acknowledged_at IS NOT NULL
          UNION ALL
          SELECT id, resolved_at, 'resolved', NULL, 2 FROM incidents_incidents WHERE resolved_at IS NOT NULL
        ) ORDER BY at, rank`
      yield* sql`CREATE TABLE incidents_check_history (
        monitor TEXT NOT NULL,
        at INTEGER NOT NULL,
        status INTEGER,
        ms REAL,
        problem TEXT,
        PRIMARY KEY (monitor, at)
      ) WITHOUT ROWID`
      yield* sql`CREATE INDEX incidents_check_history_at ON incidents_check_history (at)`
      yield* sql`CREATE TABLE incidents_check_days (
        monitor TEXT NOT NULL,
        day INTEGER NOT NULL,
        checks INTEGER NOT NULL,
        failed INTEGER NOT NULL,
        answered INTEGER NOT NULL,
        total_ms REAL NOT NULL,
        PRIMARY KEY (monitor, day)
      ) WITHOUT ROWID`
      yield* sql`ALTER TABLE incidents_monitor_checks ADD COLUMN status INTEGER`
      yield* sql`ALTER TABLE incidents_monitor_checks ADD COLUMN ms REAL`
      yield* sql`ALTER TABLE incidents_monitor_checks ADD COLUMN since INTEGER`
    }),
    // How often operations usually run, guessed hourly from the minutes they ran in, with when each
    // last ran, Unix ms, and whether a check found it quiet (detectors.ts, "Quiet"): hints, never
    // incidents.
    "0004_rhythms": Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`CREATE TABLE incidents_rhythms (
        component TEXT NOT NULL,
        environment TEXT NOT NULL,
        operation TEXT NOT NULL,
        gap_ms REAL NOT NULL,
        last_ran_at INTEGER NOT NULL,
        quiet INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (component, environment, operation)
      ) WITHOUT ROWID`
    }),
  }),
})
