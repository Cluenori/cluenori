import { Effect } from "effect"
import { Migrator, SqlClient } from "effect/sql"

/** Creates and updates the engine's tables in a project's database. */
export const migrateProjects = Migrator.make({})({
  table: "projects_migrations",
  loader: Migrator.fromRecord({
    // One row: the project this database belongs to. A component's key is kept only as a SHA-256
    // digest, so the database never holds a usable credential.
    "0001_projects": Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`CREATE TABLE projects_project (
        key TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`
      yield* sql`CREATE TABLE projects_components (
        key TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        ingest_key_digest TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`
    }),
    // A component's links: its repository on GitHub and its App Store bundle ID, null until linked.
    "0002_component_links": Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`ALTER TABLE projects_components ADD COLUMN repository TEXT`
      yield* sql`ALTER TABLE projects_components ADD COLUMN app_store_bundle_id TEXT`
    }),
    // The project's settings, as JSON, null until it chooses.
    "0003_project_settings": Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`ALTER TABLE projects_project ADD COLUMN settings TEXT`
    }),
    // A component's deploy targets, as JSON, null until linked. An App Store app linked before
    // becomes the target of production, through to the App Store; its old column is no longer read.
    "0004_deploy_targets": Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`ALTER TABLE projects_components ADD COLUMN deploy_targets TEXT`
      yield* sql`UPDATE projects_components SET deploy_targets = json_array(json_object(
          'environment', 'production',
          'appStore', json_object('bundleId', app_store_bundle_id, 'distribution', 'appStore')))
        WHERE app_store_bundle_id IS NOT NULL`
    }),
    // The component a component ships with, null for one that ships on its own.
    "0005_ships_with": Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`ALTER TABLE projects_components ADD COLUMN ships_with TEXT`
    }),
    // Components' SDK keys, revoked ones too, revoked_at null while active. Unlike an ingest key, an
    // SDK key is kept as it is, not as a digest: it is public, shipped inside every build, and the
    // founder must be able to list it again to put it in a new build. It is unguessable, so it is
    // still looked up by exact match.
    "0006_sdk_keys": Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`CREATE TABLE projects_sdk_keys (
        key TEXT PRIMARY KEY,
        component TEXT NOT NULL,
        issued_at TEXT NOT NULL,
        revoked_at TEXT
      )`
      yield* sql`CREATE INDEX projects_sdk_keys_by_component ON projects_sdk_keys (component)`
    }),
    // Several ingest keys a component, so one can replace another without a gap: each kept as its
    // SHA-256 digest, by an ID of its own. Each component's one key so far becomes its key "first",
    // which never expires; its ID is made here, from the component's creation and random bits.
    "0007_ingest_keys": Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`CREATE TABLE projects_ingest_keys (
        id TEXT PRIMARY KEY,
        component TEXT NOT NULL,
        name TEXT NOT NULL,
        digest TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        last_used_at INTEGER,
        expires_at INTEGER,
        revoked_at INTEGER,
        warned_within INTEGER
      )`
      yield* sql`CREATE INDEX projects_ingest_keys_by_component ON projects_ingest_keys (component)`
      // The whole UUIDv7 in one statement: its time, then version, variant and random bits, each
      // row's own, so components made in the same millisecond never share an ID.
      yield* sql`INSERT INTO projects_ingest_keys (id, component, name, digest, created_at)
        SELECT
          substr(t, 1, 8) || '-' || substr(t, 9, 4) || '-7' || lower(substr(hex(randomblob(2)), 1, 3)) || '-' ||
            substr('89ab', 1 + (abs(random()) % 4), 1) || lower(substr(hex(randomblob(2)), 1, 3)) || '-' ||
            lower(hex(randomblob(6))),
          key, 'first', ingest_key_digest, created_at
        FROM (
          SELECT
            lower(printf('%012x', CAST(strftime('%s', created_at) AS INTEGER) * 1000 + CAST(substr(created_at, 21, 3) AS INTEGER))) AS t,
            key, ingest_key_digest, created_at
          FROM projects_components
        )`
      yield* sql`ALTER TABLE projects_components DROP COLUMN ingest_key_digest`
    }),
    // When the project's data was last reset, ISO 8601 as `created_at`; null until it is.
    "0008_reset_at": Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`ALTER TABLE projects_project ADD COLUMN reset_at TEXT`
    }),
  }),
})
