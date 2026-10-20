import { Context, DateTime, Effect, Layer, Schema } from "effect"
import { Migrator, SqlClient, SqlSchema } from "effect/sql"

import { Project } from "./project.ts"

/** Creates and updates the index's table in the workspace's database. */
const migrateProjectIndex = Migrator.make({})({
  table: "projects_index_migrations",
  loader: Migrator.fromRecord({
    "0001_project_index": Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`CREATE TABLE projects_index (
        key TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) WITHOUT ROWID`
    }),
  }),
})

/**
 * The workspace's projects: an index of those that exist, kept in the workspace's own Durable
 * Object. Each project's own object is where it is created and what it is; the index only lists
 * them, so it emits no activity of its own. The host records a project when it creates one.
 */
export class ProjectIndex extends Context.Service<
  ProjectIndex,
  {
    /** Lists `project`, or updates its entry. Recording a project again changes nothing else. */
    readonly record: (project: Project) => Effect.Effect<void>
    /** Every project in the index, by key. */
    readonly all: Effect.Effect<ReadonlyArray<Project>>
  }
>()("@cluenori/projects/project-index/ProjectIndex") {
  /** Builds the index on the workspace object's database, first creating or updating its table. */
  static readonly layer = Layer.effect(
    ProjectIndex,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* migrateProjectIndex.pipe(Effect.orDie)

      const findAll = SqlSchema.findAll({
        Request: Schema.Void,
        Result: Project,
        execute: () => sql`SELECT key, name, created_at AS "createdAt" FROM projects_index ORDER BY key`,
      })

      const record = Effect.fn("ProjectIndex.record")(function* (project: Project) {
        const row = { key: project.key, name: project.name, created_at: DateTime.formatIso(project.createdAt) }
        yield* sql`INSERT INTO projects_index ${sql.insert(row)}
          ON CONFLICT (key) DO UPDATE SET name = excluded.name, created_at = excluded.created_at`.pipe(Effect.orDie)
      })

      const all = findAll(undefined).pipe(Effect.orDie, Effect.withSpan("ProjectIndex.all"))

      return ProjectIndex.of({ record, all })
    }),
  )
}
