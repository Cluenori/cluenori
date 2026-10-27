import { Effect, Schema } from "effect"
import { Migrator, SqlClient, SqlSchema } from "effect/sql"

import type { MessageShape } from "./fingerprint.ts"
import { messageShapeOf } from "./fingerprint.ts"

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
    // Requests kept so they can be opened: of each endpoint, environment ('' when unknown) and hour,
    // the five slowest (`kept_for` 'slowest') and the five slowest that failed ('failed'), each in the
    // set it is kept for, so a slow failed request may be in both. Kept 14 days, as minutes are.
    "0004_kept_requests": Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`CREATE TABLE signals_kept_requests (
        id INTEGER PRIMARY KEY,
        endpoint INTEGER NOT NULL,
        environment TEXT NOT NULL,
        hour INTEGER NOT NULL,
        kept_for TEXT NOT NULL,
        trace TEXT NOT NULL,
        start INTEGER NOT NULL,
        duration_ms REAL NOT NULL,
        failed INTEGER NOT NULL,
        status INTEGER
      )`
      yield* sql`CREATE INDEX signals_kept_requests_endpoint ON signals_kept_requests (endpoint, kept_for, hour)`
      yield* sql`CREATE INDEX signals_kept_requests_hour ON signals_kept_requests (hour)`
    }),
    // A request is now a run, and an endpoint an operation, since jobs and messages are counted
    // too. Renaming changes only the schema, not the rows; SQLite renames a column in its keys and
    // indexes, but an index keeps its name, so each is made again under the new one.
    "0005_operations_runs": Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`ALTER TABLE signals_endpoints RENAME TO signals_operations`
      yield* sql`UPDATE signals_operations SET name = '(other operations)' WHERE name = '(other endpoints)'`
      for (const table of ["signals_minute_counts", "signals_hour_counts"]) {
        yield* sql`ALTER TABLE ${sql(table)} RENAME COLUMN endpoint TO operation`
        yield* sql`ALTER TABLE ${sql(table)} RENAME COLUMN requests TO runs`
      }
      yield* sql`ALTER TABLE signals_kept_requests RENAME TO signals_kept_runs`
      yield* sql`ALTER TABLE signals_kept_runs RENAME COLUMN endpoint TO operation`
      yield* sql`DROP INDEX signals_kept_requests_endpoint`
      yield* sql`DROP INDEX signals_kept_requests_hour`
      yield* sql`CREATE INDEX signals_kept_runs_operation ON signals_kept_runs (operation, kept_for, hour)`
      yield* sql`CREATE INDEX signals_kept_runs_hour ON signals_kept_runs (hour)`
    }),
    // An operation is counted, without a word for each time it ran, and the slowest and failed are
    // kept as the traces they open: a run is no longer a concept. As in 0005, only the schema
    // changes, and each index is made again under its new name.
    "0006_counts_kept_traces": Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      for (const table of ["signals_minute_counts", "signals_hour_counts"]) {
        yield* sql`ALTER TABLE ${sql(table)} RENAME COLUMN runs TO count`
      }
      yield* sql`ALTER TABLE signals_kept_runs RENAME TO signals_kept_traces`
      yield* sql`DROP INDEX signals_kept_runs_operation`
      yield* sql`DROP INDEX signals_kept_runs_hour`
      yield* sql`CREATE INDEX signals_kept_traces_operation ON signals_kept_traces (operation, kept_for, hour)`
      yield* sql`CREATE INDEX signals_kept_traces_hour ON signals_kept_traces (hour)`
    }),
    // Operations are counted by release too, from `service.version`, so releases compare; '' is
    // unknown, as every count and kept trace from before this is. SQLite can't change a primary key,
    // so each count table is made again and its rows copied. Each release's first and last minute
    // is kept in a table of its own, so listing releases reads one row each; and an error group
    // keeps the release it was first seen in, '' for those from before.
    "0007_by_release": Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      for (const table of ["signals_minute_counts", "signals_hour_counts"]) {
        const rebuilt = `${table}_by_release`
        yield* sql`CREATE TABLE ${sql(rebuilt)} (
          bucket INTEGER NOT NULL,
          operation INTEGER NOT NULL,
          environment TEXT NOT NULL,
          release TEXT NOT NULL,
          count INTEGER NOT NULL,
          errors INTEGER NOT NULL,
          total_ms REAL NOT NULL,
          durations TEXT NOT NULL,
          PRIMARY KEY (bucket, operation, environment, release)
        ) WITHOUT ROWID`
        yield* sql`INSERT INTO ${sql(rebuilt)} (bucket, operation, environment, release, count, errors, total_ms, durations)
          SELECT bucket, operation, environment, '', count, errors, total_ms, durations FROM ${sql(table)}`
        yield* sql`DROP TABLE ${sql(table)}`
        yield* sql`ALTER TABLE ${sql(rebuilt)} RENAME TO ${sql(table)}`
      }
      yield* sql`ALTER TABLE signals_kept_traces ADD COLUMN release TEXT NOT NULL DEFAULT ''`
      yield* sql`CREATE TABLE signals_releases (
        component TEXT NOT NULL,
        environment TEXT NOT NULL,
        release TEXT NOT NULL,
        first_seen INTEGER NOT NULL,
        last_seen INTEGER NOT NULL,
        PRIMARY KEY (component, environment, release)
      ) WITHOUT ROWID`
      yield* sql`ALTER TABLE signals_error_groups ADD COLUMN first_release TEXT NOT NULL DEFAULT ''`
    }),
    // Each warning and error keeps its release in a column, so they filter by it; those kept before
    // take it from their record, which has it when their service said.
    "0008_log_release": Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`ALTER TABLE signals_logs ADD COLUMN release TEXT NOT NULL DEFAULT ''`
      yield* sql`UPDATE signals_logs SET release = coalesce(json_extract(entry, '$.release'), '')`
      yield* sql`CREATE INDEX signals_logs_release ON signals_logs (release, time) WHERE release <> ''`
    }),
    // Apps' signals. People and installations get row numbers, so the tables by day hold integers;
    // `person` is Cluenori's ID for a person, `user` the app's own user ID, linked to one person.
    // Times are Unix ms, days the days since 1970-01-01 in UTC, '' an absent feature. What is counted
    // by day is kept 15 months; a session 90 days; a person's timeline its latest 1,000 signals, 15
    // months; a signal's ID 14 days by its own time, so a batch sent again counts once.
    "0009_app_signals": Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`CREATE TABLE signals_people (
        id INTEGER PRIMARY KEY,
        person TEXT NOT NULL UNIQUE,
        first_seen INTEGER NOT NULL,
        last_seen INTEGER NOT NULL
      )`
      yield* sql`CREATE TABLE signals_person_users (
        user TEXT PRIMARY KEY,
        person INTEGER NOT NULL
      ) WITHOUT ROWID`
      yield* sql`CREATE INDEX signals_person_users_person ON signals_person_users (person)`
      yield* sql`CREATE TABLE signals_installations (
        id INTEGER PRIMARY KEY,
        installation TEXT NOT NULL UNIQUE,
        person INTEGER NOT NULL,
        component TEXT NOT NULL,
        environment TEXT NOT NULL,
        release TEXT NOT NULL,
        device TEXT NOT NULL,
        sdk TEXT NOT NULL,
        country TEXT,
        first_seen INTEGER NOT NULL,
        last_seen INTEGER NOT NULL
      )`
      yield* sql`CREATE INDEX signals_installations_person ON signals_installations (person)`
      yield* sql`CREATE TABLE signals_app_releases (
        component TEXT NOT NULL,
        environment TEXT NOT NULL,
        release TEXT NOT NULL,
        first_seen INTEGER NOT NULL,
        last_seen INTEGER NOT NULL,
        PRIMARY KEY (component, environment, release)
      ) WITHOUT ROWID`
      yield* sql`CREATE TABLE signals_app_first_days (
        component TEXT NOT NULL,
        environment TEXT NOT NULL,
        person INTEGER NOT NULL,
        day INTEGER NOT NULL,
        PRIMARY KEY (component, environment, person)
      ) WITHOUT ROWID`
      yield* sql`CREATE TABLE signals_app_days (
        day INTEGER NOT NULL,
        component TEXT NOT NULL,
        environment TEXT NOT NULL,
        release TEXT NOT NULL,
        installation INTEGER NOT NULL,
        person INTEGER NOT NULL,
        sessions INTEGER NOT NULL,
        foreground_ms REAL NOT NULL,
        PRIMARY KEY (day, component, environment, release, installation, person)
      ) WITHOUT ROWID`
      yield* sql`CREATE INDEX signals_app_days_person ON signals_app_days (person, day)`
      yield* sql`CREATE TABLE signals_app_feature_days (
        day INTEGER NOT NULL,
        component TEXT NOT NULL,
        environment TEXT NOT NULL,
        release TEXT NOT NULL,
        feature TEXT NOT NULL,
        person INTEGER NOT NULL,
        events INTEGER NOT NULL,
        screens INTEGER NOT NULL,
        PRIMARY KEY (day, component, environment, release, feature, person)
      ) WITHOUT ROWID`
      yield* sql`CREATE TABLE signals_app_measures (
        day INTEGER NOT NULL,
        component TEXT NOT NULL,
        environment TEXT NOT NULL,
        release TEXT NOT NULL,
        feature TEXT NOT NULL,
        measure TEXT NOT NULL,
        count INTEGER NOT NULL,
        sketch TEXT,
        PRIMARY KEY (day, component, environment, release, feature, measure)
      ) WITHOUT ROWID`
      yield* sql`CREATE INDEX signals_app_measures_release ON signals_app_measures (component, release)`
      yield* sql`CREATE TABLE signals_app_diagnostics (
        day INTEGER NOT NULL,
        component TEXT NOT NULL,
        environment TEXT NOT NULL,
        release TEXT NOT NULL,
        kind TEXT NOT NULL,
        count INTEGER NOT NULL,
        PRIMARY KEY (day, component, environment, release, kind)
      ) WITHOUT ROWID`
      yield* sql`CREATE INDEX signals_app_diagnostics_release ON signals_app_diagnostics (component, release)`
      yield* sql`CREATE TABLE signals_app_sessions (
        session TEXT PRIMARY KEY,
        installation INTEGER NOT NULL,
        person INTEGER NOT NULL,
        component TEXT NOT NULL,
        environment TEXT NOT NULL,
        release TEXT NOT NULL,
        started_at INTEGER,
        ended_at INTEGER,
        foreground_ms REAL,
        seen_at INTEGER NOT NULL
      ) WITHOUT ROWID`
      yield* sql`CREATE INDEX signals_app_sessions_seen ON signals_app_sessions (seen_at)`
      yield* sql`CREATE TABLE signals_app_seen (signal TEXT PRIMARY KEY) WITHOUT ROWID`
      yield* sql`CREATE TABLE signals_app_timeline (
        person INTEGER NOT NULL,
        at INTEGER NOT NULL,
        signal TEXT NOT NULL,
        entry TEXT NOT NULL,
        PRIMARY KEY (person, at, signal)
      ) WITHOUT ROWID`
      yield* sql`CREATE INDEX signals_app_timeline_at ON signals_app_timeline (at)`
    }),
    // Each stored sketch names its accuracy, as @bagatka/quantile-sketch reads them. Every sketch
    // until now was made at 2%, with that accuracy's buckets, so naming it changes no value.
    "0010_sketch_accuracy": Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      for (const table of ["signals_minute_counts", "signals_hour_counts"]) {
        yield* sql`UPDATE ${sql(table)} SET durations = json_set(durations, '$.relativeAccuracy', 0.02)`
      }
      yield* sql`UPDATE signals_app_measures SET sketch = json_set(sketch, '$.relativeAccuracy', 0.02)
        WHERE sketch IS NOT NULL`
    }),
    // Services' signals carry the feature they were for in `cluenori.feature` (concept/Foundation.md,
    // "Features"): each warning and error keeps it in a column ('' for none), those kept before
    // taking it from their record's attributes; and operations are counted by feature, day,
    // component, operation and environment ('' when unknown), kept 15 months as hourly counts are,
    // read by feature.
    "0011_features": Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`ALTER TABLE signals_logs ADD COLUMN feature TEXT NOT NULL DEFAULT ''`
      yield* sql`UPDATE signals_logs SET feature = coalesce(json_extract(entry, '$.attributes."cluenori.feature"'), '')
        WHERE json_type(entry, '$.attributes."cluenori.feature"') = 'text'`
      yield* sql`CREATE INDEX signals_logs_feature ON signals_logs (feature, time) WHERE feature <> ''`
      yield* sql`CREATE TABLE signals_feature_days (
        day INTEGER NOT NULL,
        feature TEXT NOT NULL,
        component TEXT NOT NULL,
        operation TEXT NOT NULL,
        environment TEXT NOT NULL,
        count INTEGER NOT NULL,
        errors INTEGER NOT NULL,
        PRIMARY KEY (feature, day, component, operation, environment)
      ) WITHOUT ROWID`
      yield* sql`CREATE INDEX signals_feature_days_day ON signals_feature_days (day)`
      // Apps' feature use is read by feature, for a feature's whole life, and by person, for the
      // features one person uses, so neither reads every day of every feature.
      yield* sql`CREATE INDEX signals_app_feature_days_feature ON signals_app_feature_days (feature, day)`
      yield* sql`CREATE INDEX signals_app_feature_days_person ON signals_app_feature_days (person, feature)`
    }),
    // Each operation keeps when it last ran, the end of the last minute it was counted in, so a
    // period without it can say when that was. Operations counted before take the end of their
    // newest hour, then of their newest minute, which the 14 days of minutes still know.
    "0012_operations_last_seen": Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`ALTER TABLE signals_operations ADD COLUMN last_seen INTEGER`
      for (const [table, width] of [
        ["signals_hour_counts", 3_600_000],
        ["signals_minute_counts", 60_000],
      ] as const) {
        yield* sql`UPDATE signals_operations SET last_seen = newest.last_seen
          FROM (SELECT operation, max(bucket) + ${width} AS last_seen FROM ${sql(table)} GROUP BY operation) AS newest
          WHERE newest.operation = signals_operations.id`
      }
    }),
    // Log messages: warnings and errors that are the same message, numbered from 1 as the project
    // first sees each, by their key (`messageShapeOf`), kept 15 months after they were last seen.
    // Each line kept names its message; those kept before are numbered here, oldest first, with
    // the same key ingest makes, so a message seen before and after has one ID.
    "0013_log_messages": Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`CREATE TABLE signals_log_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT NOT NULL UNIQUE,
        level TEXT NOT NULL,
        title TEXT NOT NULL,
        category TEXT NOT NULL,
        first_seen INTEGER NOT NULL,
        first_release TEXT NOT NULL,
        last_seen INTEGER NOT NULL,
        last_component TEXT NOT NULL,
        last_environment TEXT NOT NULL,
        last_release TEXT NOT NULL
      )`
      yield* sql`ALTER TABLE signals_logs ADD COLUMN message INTEGER NOT NULL DEFAULT 0`
      const Row = Schema.Struct({
        id: Schema.Int,
        time: Schema.Int,
        component: Schema.String,
        environment: Schema.String,
        release: Schema.String,
        level: Schema.Literals(["warn", "error", "fatal"]),
        category: Schema.String,
        message: Schema.String,
        template: Schema.NullOr(Schema.String),
      })
      // One line at a time: a line's message, template, and logger may each be long, so a page of
      // many may not fit the Durable Object's memory. They are read whole, as ingest reads them.
      const page = SqlSchema.findAll({
        Request: Schema.Int,
        Result: Row,
        execute: (after) => sql`
          SELECT id, time, component, environment, release, level, category,
            coalesce(json_extract(entry, '$.message'), '') AS message,
            json_extract(entry, '$.template') AS template
          FROM signals_logs WHERE id > ${after} ORDER BY id LIMIT 1`,
      })
      let after = 0
      for (;;) {
        const rows = yield* page(after)
        const last = rows.at(-1)
        if (last === undefined) {
          break
        }
        for (const row of rows) {
          const { template, ...said } = row
          const shape = messageShapeOf({ ...said, ...(template === null ? {} : { template }) })
          yield* upsertMessage(sql, shape, row)
          yield* sql`UPDATE signals_logs SET message = (SELECT id FROM signals_log_messages WHERE key = ${shape.fingerprint})
            WHERE id = ${row.id}`
        }
        after = last.id
      }
      yield* sql`CREATE INDEX signals_logs_message ON signals_logs (message, time)`
    }),
    // Each event in the people's timelines, found by its name and time without reading the rest:
    // a monitor counts one event over a window every minute (`AppSignals.eventCount`).
    "0014_timeline_events": Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`CREATE INDEX signals_app_timeline_events
        ON signals_app_timeline (json_extract(entry, '$.signal.name'), at)
        WHERE json_extract(entry, '$.signal._tag') = 'event'`
      // When each event last arrived, by its own time, in each component and environment: a person's
      // timeline keeps only their latest signals, so this says one came even after it is trimmed.
      yield* sql`CREATE TABLE signals_app_event_last (
        component TEXT NOT NULL,
        environment TEXT NOT NULL,
        name TEXT NOT NULL,
        at INTEGER NOT NULL,
        PRIMARY KEY (component, environment, name)
      ) WITHOUT ROWID`
      // Those the timelines hold now, so a trimmed one still counts.
      yield* sql`INSERT INTO signals_app_event_last (component, environment, name, at)
        SELECT json_extract(entry, '$.component'), json_extract(entry, '$.environment'),
          json_extract(entry, '$.signal.name'), max(at)
        FROM signals_app_timeline WHERE json_extract(entry, '$.signal._tag') = 'event'
        GROUP BY 1, 2, 3`
    }),
    // What apps measure of their screens and timings, by UTC day and subject (the screen, or the
    // timing's name): screens' readiness from what the device kept and from the network, their
    // visits' time in sight, CPU time, scrolling and hitches, the hangs on each, and timings; each
    // with its count, its values' sum, and their quantile sketch. Kept 15 months, as app measures are.
    // And operations counted by the client that asked for them, by the hour, as their baggage names
    // it (`cluenori.origin.component`), '' for none; kept 15 months, as hourly counts are.
    "0015_screens_and_origins": Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`CREATE TABLE signals_app_subject_measures (
        day INTEGER NOT NULL,
        component TEXT NOT NULL,
        environment TEXT NOT NULL,
        release TEXT NOT NULL,
        subject TEXT NOT NULL,
        measure TEXT NOT NULL,
        count INTEGER NOT NULL,
        total REAL NOT NULL,
        sketch TEXT NOT NULL,
        PRIMARY KEY (day, component, environment, release, subject, measure)
      ) WITHOUT ROWID`
      yield* sql`CREATE TABLE signals_origin_hours (
        hour INTEGER NOT NULL,
        component TEXT NOT NULL,
        operation TEXT NOT NULL,
        environment TEXT NOT NULL,
        origin TEXT NOT NULL,
        count INTEGER NOT NULL,
        errors INTEGER NOT NULL,
        total_ms REAL NOT NULL,
        PRIMARY KEY (hour, component, operation, environment, origin)
      ) WITHOUT ROWID`
    }),
    // The files a reset deletes in the background, one row a store while it does: those stored before
    // `before` (Unix ms), listed by key after `after`, the last key reached (null at the start).
    "0016_purges": Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`CREATE TABLE signals_purges (
        store TEXT PRIMARY KEY,
        before INTEGER NOT NULL,
        after TEXT
      ) WITHOUT ROWID`
    }),
  }),
})

/**
 * Creates the log message of `shape`, or updates it with a line: its first and last seen, and what
 * follows its latest line (its level, title, and where it was last seen). Lines may arrive out of
 * order, so each is compared with what is kept.
 */
export const upsertMessage = (
  sql: SqlClient.SqlClient,
  shape: MessageShape,
  line: {
    readonly time: number
    readonly level: string
    readonly category: string
    readonly component: string
    readonly environment: string
    readonly release: string
  },
) => sql`
  INSERT INTO signals_log_messages ${sql.insert({
    key: shape.fingerprint,
    level: line.level,
    title: shape.title,
    category: line.category,
    first_seen: line.time,
    first_release: line.release,
    last_seen: line.time,
    last_component: line.component,
    last_environment: line.environment,
    last_release: line.release,
  })}
  ON CONFLICT (key) DO UPDATE SET
    first_release = CASE WHEN excluded.first_seen < first_seen THEN excluded.first_release ELSE first_release END,
    first_seen = min(first_seen, excluded.first_seen),
    level = CASE WHEN excluded.last_seen >= last_seen THEN excluded.level ELSE level END,
    title = CASE WHEN excluded.last_seen >= last_seen THEN excluded.title ELSE title END,
    last_component = CASE WHEN excluded.last_seen >= last_seen THEN excluded.last_component ELSE last_component END,
    last_environment = CASE WHEN excluded.last_seen >= last_seen THEN excluded.last_environment ELSE last_environment END,
    last_release = CASE WHEN excluded.last_seen >= last_seen THEN excluded.last_release ELSE last_release END,
    last_seen = max(last_seen, excluded.last_seen)`
