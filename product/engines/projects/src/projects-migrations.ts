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
  }),
})
