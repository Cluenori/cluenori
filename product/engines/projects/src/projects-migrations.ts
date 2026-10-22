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
  }),
})
