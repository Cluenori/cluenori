import type { Actor } from "@cluenori/foundation"
import { ActivityLog, ComponentKey, Source } from "@cluenori/foundation"
import type { ProjectKey } from "@cluenori/foundation"
import { Context, Crypto, DateTime, Effect, Layer, Option, Redacted, Schema } from "effect"
import { Base64Url, Hex } from "effect/encoding"
import { SqlClient, SqlSchema } from "effect/sql"

import type { AddComponent } from "./component.ts"
import { Component, ComponentExists } from "./component.ts"
import { IngestKey, IngestKeyRejected, ingestKeyScope } from "./ingest-key.ts"
import type { ProjectName } from "./project.ts"
import { Project, ProjectExists, ProjectNotFound } from "./project.ts"
import { ComponentAdded, ProjectCreated } from "./projects-activity.ts"
import { migrateProjects } from "./projects-migrations.ts"

/** Which project the object holds: the key the host routed by. */
export interface ProjectsSettings {
  readonly project: ProjectKey
}

/** A component just added, with its ingest key: the only time the key is shown. */
export interface AddedComponent {
  readonly component: Component
  readonly ingestKey: Redacted.Redacted<IngestKey>
}

const source = Source.make("engine:projects")

/**
 * The project of one Durable Object, its components, and their ingest keys. Runs inside the object
 * that holds the project's database.
 */
export class Projects extends Context.Service<
  Projects,
  {
    /** Creates the project, with `project.created`. Fails with `ProjectExists` when it exists already. */
    readonly create: (actor: Actor, name: ProjectName) => Effect.Effect<Project, ProjectExists>
    /** The project. */
    readonly project: Effect.Effect<Project, ProjectNotFound>
    /** The project's components, by key. */
    readonly components: Effect.Effect<ReadonlyArray<Component>, ProjectNotFound>
    /**
     * Adds a component, with `component.added`, and makes its ingest key. The key is returned here
     * only, once: the project keeps only its SHA-256 digest. Fails with `ComponentExists` when the
     * project has a component with that key.
     */
    readonly addComponent: (
      actor: Actor,
      input: AddComponent,
    ) => Effect.Effect<AddedComponent, ComponentExists | ProjectNotFound>
    /**
     * The component `key` belongs to. Fails with `IngestKeyRejected`, the same way whatever is wrong,
     * for any key that isn't one of the project's. Reads one row.
     */
    readonly authenticate: (key: Redacted.Redacted<IngestKey>) => Effect.Effect<ComponentKey, IngestKeyRejected>
  }
>()("@cluenori/projects/projects") {
  /** Builds the engine on the object's database, first creating or updating its tables. */
  static readonly layer = (settings: ProjectsSettings) =>
    Layer.effect(
      Projects,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const crypto = yield* Crypto.Crypto
        const log = yield* ActivityLog
        yield* migrateProjects.pipe(Effect.orDie)

        const findProject = SqlSchema.findOneOption({
          Request: Schema.Void,
          Result: Project,
          execute: () => sql`SELECT key, name, created_at AS "createdAt" FROM projects_project`,
        })

        const findComponents = SqlSchema.findAll({
          Request: Schema.Void,
          Result: Component,
          execute: () => sql`SELECT key, name, created_at AS "createdAt" FROM projects_components ORDER BY key`,
        })

        const findComponent = SqlSchema.findOneOption({
          Request: ComponentKey,
          Result: Schema.Struct({ key: ComponentKey, digest: Schema.String }),
          execute: (key) => sql`SELECT key, ingest_key_digest AS "digest" FROM projects_components WHERE key = ${key}`,
        })

        // Ingest keys are ASCII, so their characters are their bytes.
        const digestOf = Effect.fn("Projects.digestOf")(function* (key: IngestKey) {
          const bytes = Uint8Array.from(key, (character) => character.charCodeAt(0))
          const digest = yield* crypto.digest("SHA-256", bytes).pipe(Effect.orDie)
          return Hex.encode(digest)
        })

        const project = findProject(undefined).pipe(
          Effect.orDie,
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.fail(new ProjectNotFound({ project: settings.project })),
              onSome: Effect.succeed,
            }),
          ),
          Effect.withSpan("Projects.project"),
        )

        const insertProject = Effect.fn("Projects.insertProject")(function* (name: ProjectName) {
          const existing = yield* findProject(undefined).pipe(Effect.orDie)
          if (existing._tag === "Some") {
            return yield* new ProjectExists({ project: settings.project })
          }
          const createdAt = yield* DateTime.now
          yield* sql`INSERT INTO projects_project ${sql.insert({ key: settings.project, name, created_at: DateTime.formatIso(createdAt) })}`.pipe(
            Effect.orDie,
          )
          return new Project({ key: settings.project, name, createdAt })
        })

        const create = Effect.fn("Projects.create")(function* (actor: Actor, name: ProjectName) {
          return yield* log.commit({
            source,
            actor,
            write: insertProject(name),
            activity: (created) => [{ payload: ProjectCreated.make({ project: created.key, name: created.name }) }],
          })
        })

        const insertComponent = Effect.fn("Projects.insertComponent")(function* (input: AddComponent, digest: string) {
          yield* project
          const existing = yield* findComponent(input.key).pipe(Effect.orDie)
          if (existing._tag === "Some") {
            return yield* new ComponentExists({ component: input.key })
          }
          const createdAt = yield* DateTime.now
          yield* sql`INSERT INTO projects_components ${sql.insert({ key: input.key, name: input.name, ingest_key_digest: digest, created_at: DateTime.formatIso(createdAt) })}`.pipe(
            Effect.orDie,
          )
          return new Component({ key: input.key, name: input.name, createdAt })
        })

        // The key and its digest are made before the transaction, which holds only SQL.
        const addComponent = Effect.fn("Projects.addComponent")(function* (actor: Actor, input: AddComponent) {
          const secret = yield* crypto.randomBytes(32).pipe(Effect.orDie)
          const ingestKey = IngestKey.make(`cluenori.${settings.project}.${input.key}.${Base64Url.encode(secret)}`)
          const digest = yield* digestOf(ingestKey)
          const component = yield* log.commit({
            source,
            actor,
            write: insertComponent(input, digest),
            activity: (added) => [
              { payload: ComponentAdded.make({ component: added.key, name: added.name }), component: added.key },
            ],
          })
          return { component, ingestKey: Redacted.make(ingestKey) }
        })

        const authenticate = Effect.fn("Projects.authenticate")(function* (key: Redacted.Redacted<IngestKey>) {
          const presented = Redacted.value(key)
          const scope = ingestKeyScope(presented)
          if (scope.project !== settings.project) {
            return yield* new IngestKeyRejected()
          }
          const digest = yield* digestOf(presented)
          const found = yield* findComponent(scope.component).pipe(Effect.orDie)
          // Both sides are digests, so comparing them in ordinary time reveals nothing about a key.
          const keyMatches = found._tag === "Some" && found.value.digest === digest
          if (!keyMatches) {
            return yield* new IngestKeyRejected()
          }
          return scope.component
        })

        const components = project.pipe(
          Effect.andThen(findComponents(undefined).pipe(Effect.orDie)),
          Effect.withSpan("Projects.components"),
        )

        return Projects.of({ create, project, components, addComponent, authenticate })
      }),
    )
}
