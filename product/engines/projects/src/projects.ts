import { Repository } from "@bagatka/github"
import type { Actor } from "@cluenori/foundation"
import { ActivityLog, ComponentKey, Instant, Source } from "@cluenori/foundation"
import type { ProjectKey } from "@cluenori/foundation"
import { Context, Crypto, DateTime, Effect, Layer, Option, Redacted, Schema } from "effect"
import { Base64Url, Hex } from "effect/encoding"
import { SqlClient, SqlSchema } from "effect/sql"

import type { AddComponent, ComponentLinks } from "./component.ts"
import { Component, ComponentExists, ComponentNotFound, ComponentName, DeployTarget } from "./component.ts"
import { IngestKey, IngestKeyRejected, ingestKeyScope } from "./ingest-key.ts"
import { IssuedSdkKey, SdkKeyNotFound } from "./issued-sdk-key.ts"
import type { SdkKeyList } from "./issued-sdk-key.ts"
import type { ProjectName } from "./project.ts"
import { defaultProjectSettings, Project, ProjectExists, ProjectNotFound, ProjectSettings } from "./project.ts"
import {
  ComponentAdded,
  ComponentLinked,
  ProjectCreated,
  ProjectSettingsChanged,
  SdkKeyIssued,
  SdkKeyRevoked,
} from "./projects-activity.ts"
import { migrateProjects } from "./projects-migrations.ts"
import { SdkKey, sdkKeyScope } from "./sdk-key.ts"

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

// A component as its row holds it: links are null until set.
const ComponentRow = Schema.Struct({
  key: ComponentKey,
  name: ComponentName,
  createdAt: Instant,
  repository: Schema.NullOr(Repository),
  deployTargets: Schema.NullOr(Schema.fromJsonString(Schema.Array(DeployTarget))),
  shipsWith: Schema.NullOr(ComponentKey),
})

const componentOf = (row: typeof ComponentRow.Type) =>
  new Component({
    key: row.key,
    name: row.name,
    createdAt: row.createdAt,
    ...(row.repository === null ? {} : { repository: row.repository }),
    ...(row.deployTargets === null ? {} : { deployTargets: row.deployTargets }),
    ...(row.shipsWith === null ? {} : { shipsWith: row.shipsWith }),
  })

// An SDK key as its row holds it: revoked_at is null while it is active.
const SdkKeyRow = Schema.Struct({
  key: SdkKey,
  component: ComponentKey,
  issuedAt: Instant,
  revokedAt: Schema.NullOr(Instant),
})

const issuedSdkKeyOf = (row: typeof SdkKeyRow.Type) =>
  new IssuedSdkKey({
    key: row.key,
    component: row.component,
    issuedAt: row.issuedAt,
    ...(row.revokedAt === null ? {} : { revokedAt: row.revokedAt }),
  })

/**
 * The project of one Durable Object, its components, and their ingest keys and SDK keys. Runs inside the object
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
    /**
     * Replaces a component's links, its repository, deploy targets and the component it ships with,
     * with `component.linked`; one left out is unlinked. Fails with `ComponentNotFound` for a
     * component the project lacks, or one it ships with that the project lacks or that is itself.
     */
    readonly linkComponent: (
      actor: Actor,
      component: ComponentKey,
      links: ComponentLinks,
    ) => Effect.Effect<Component, ComponentNotFound | ProjectNotFound>
    /** The project's settings: those it chose, or the defaults until it does. Reads one row. */
    readonly settings: Effect.Effect<ProjectSettings, ProjectNotFound>
    /** Replaces the project's settings, with `project.settings_changed`. */
    readonly updateSettings: (
      actor: Actor,
      settings: ProjectSettings,
    ) => Effect.Effect<ProjectSettings, ProjectNotFound>
    /**
     * Issues a new SDK key for `component`, with `sdk_key.issued`: the key its app's builds carry.
     * Its other keys stay active, so keys rotate. The key is public and kept as it is, so it can be
     * listed again. Fails with `ComponentNotFound` for a component the project lacks.
     */
    readonly issueSdkKey: (
      actor: Actor,
      component: ComponentKey,
    ) => Effect.Effect<IssuedSdkKey, ComponentNotFound | ProjectNotFound>
    /**
     * The component's SDK keys, newest first, revoked ones too. Fails with `ComponentNotFound` for a
     * component the project lacks.
     */
    readonly sdkKeys: (component: ComponentKey) => Effect.Effect<SdkKeyList, ComponentNotFound | ProjectNotFound>
    /**
     * Revokes `key`, with `sdk_key.revoked`: builds that carry it are refused from then on. A key
     * revoked before is returned as it is, without new activity. Fails with `SdkKeyNotFound` for a
     * key that isn't one of the component's, and for a component the project lacks.
     */
    readonly revokeSdkKey: (
      actor: Actor,
      component: ComponentKey,
      key: SdkKey,
    ) => Effect.Effect<IssuedSdkKey, SdkKeyNotFound | ProjectNotFound>
    /**
     * The component an active SDK key of this project belongs to. Fails with `SdkKeyNotFound`, the
     * same way whatever is wrong, for a key that is unknown, revoked, or another project's. Reads one
     * row.
     */
    readonly authenticateSdkKey: (key: SdkKey) => Effect.Effect<ComponentKey, SdkKeyNotFound>
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

        const findSettings = SqlSchema.findOneOption({
          Request: Schema.Void,
          Result: Schema.Struct({ settings: Schema.NullOr(Schema.fromJsonString(ProjectSettings)) }),
          execute: () => sql`SELECT settings FROM projects_project`,
        })
        const encodeSettings = Schema.encodeEffect(Schema.fromJsonString(ProjectSettings))

        const findProject = SqlSchema.findOneOption({
          Request: Schema.Void,
          Result: Project,
          execute: () => sql`SELECT key, name, created_at AS "createdAt" FROM projects_project`,
        })

        const findComponents = SqlSchema.findAll({
          Request: Schema.Void,
          Result: ComponentRow,
          execute: () =>
            sql`SELECT key, name, created_at AS "createdAt", repository, deploy_targets AS "deployTargets",
                ships_with AS "shipsWith"
              FROM projects_components ORDER BY key`,
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
          Effect.map((rows) => rows.map(componentOf)),
          Effect.withSpan("Projects.components"),
        )

        const encodeTargets = Schema.encodeEffect(Schema.fromJsonString(Schema.Array(DeployTarget)))

        const updateLinks = Effect.fn("Projects.updateLinks")(function* (key: ComponentKey, links: ComponentLinks) {
          const all = yield* components
          const current = all.find((component) => component.key === key)
          if (current === undefined) {
            return yield* new ComponentNotFound({ component: key })
          }
          // Not handled: a component that ships with itself, refused as if the project lacked it;
          // its own error would take a change to every caller's errors.
          const shipsWith = links.shipsWith
          if (shipsWith !== undefined && (shipsWith === key || !all.some((component) => component.key === shipsWith))) {
            return yield* new ComponentNotFound({ component: shipsWith })
          }
          const targets =
            links.deployTargets === undefined ? null : yield* encodeTargets(links.deployTargets).pipe(Effect.orDie)
          yield* sql`UPDATE projects_components SET repository = ${links.repository ?? null},
            deploy_targets = ${targets}, ships_with = ${links.shipsWith ?? null} WHERE key = ${key}`.pipe(Effect.orDie)
          return new Component({ key, name: current.name, createdAt: current.createdAt, ...links })
        })

        const linkComponent = Effect.fn("Projects.linkComponent")(function* (
          actor: Actor,
          component: ComponentKey,
          links: ComponentLinks,
        ) {
          return yield* log.commit({
            source,
            actor,
            write: updateLinks(component, links),
            activity: (linked) => [
              {
                payload: ComponentLinked.make({
                  component: linked.key,
                  ...(linked.repository === undefined ? {} : { repository: linked.repository }),
                  ...(linked.deployTargets === undefined ? {} : { deployTargets: linked.deployTargets }),
                  ...(linked.shipsWith === undefined ? {} : { shipsWith: linked.shipsWith }),
                }),
                component: linked.key,
              },
            ],
          })
        })

        const projectSettings = findSettings(undefined).pipe(
          Effect.orDie,
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.fail(new ProjectNotFound({ project: settings.project })),
              onSome: (row) => Effect.succeed(row.settings ?? defaultProjectSettings),
            }),
          ),
          Effect.withSpan("Projects.settings"),
        )

        const writeSettings = Effect.fn("Projects.writeSettings")(function* (chosen: ProjectSettings) {
          yield* project
          const json = yield* encodeSettings(chosen).pipe(Effect.orDie)
          yield* sql`UPDATE projects_project SET settings = ${json}`.pipe(Effect.orDie)
          return chosen
        })

        const updateSettings = Effect.fn("Projects.updateSettings")(function* (actor: Actor, chosen: ProjectSettings) {
          return yield* log.commit({
            source,
            actor,
            write: writeSettings(chosen),
            activity: (written) => [
              { payload: ProjectSettingsChanged.make({ productionEnvironments: written.productionEnvironments }) },
            ],
          })
        })

        const findSdkKey = SqlSchema.findOneOption({
          Request: SdkKey,
          Result: SdkKeyRow,
          execute: (key) =>
            sql`SELECT key, component, issued_at AS "issuedAt", revoked_at AS "revokedAt"
              FROM projects_sdk_keys WHERE key = ${key}`,
        })

        // Newest first; keys issued in the same millisecond in the order they were issued, newest first.
        const findSdkKeys = SqlSchema.findAll({
          Request: ComponentKey,
          Result: SdkKeyRow,
          execute: (component) =>
            sql`SELECT key, component, issued_at AS "issuedAt", revoked_at AS "revokedAt"
              FROM projects_sdk_keys WHERE component = ${component} ORDER BY issued_at DESC, rowid DESC`,
        })

        const componentExists = Effect.fn("Projects.componentExists")(function* (component: ComponentKey) {
          yield* project
          const found = yield* findComponent(component).pipe(Effect.orDie)
          if (found._tag === "None") {
            return yield* new ComponentNotFound({ component })
          }
        })

        const insertSdkKey = Effect.fn("Projects.insertSdkKey")(function* (component: ComponentKey, key: SdkKey) {
          yield* componentExists(component)
          const issuedAt = yield* DateTime.now
          yield* sql`INSERT INTO projects_sdk_keys ${sql.insert({ key, component, issued_at: DateTime.formatIso(issuedAt) })}`.pipe(
            Effect.orDie,
          )
          return new IssuedSdkKey({ key, component, issuedAt })
        })

        // The key is made before the write's transaction, which holds only SQL.
        const issueSdkKey = Effect.fn("Projects.issueSdkKey")(function* (actor: Actor, component: ComponentKey) {
          const id = yield* crypto.randomBytes(16).pipe(Effect.orDie)
          const key = SdkKey.make(`cluenori-sdk.${settings.project}.${component}.${Base64Url.encode(id)}`)
          return yield* log.commit({
            source,
            actor,
            write: insertSdkKey(component, key),
            activity: (issued) => [
              {
                payload: SdkKeyIssued.make({ component: issued.component, key: issued.key }),
                component: issued.component,
              },
            ],
          })
        })

        const sdkKeys = Effect.fn("Projects.sdkKeys")(function* (component: ComponentKey) {
          yield* componentExists(component)
          const rows = yield* findSdkKeys(component).pipe(Effect.orDie)
          return { keys: rows.map(issuedSdkKeyOf) }
        })

        // The component's key, as stored; a key of another component, or of a component the
        // project lacks, is not found.
        const componentSdkKey = Effect.fn("Projects.componentSdkKey")(function* (component: ComponentKey, key: SdkKey) {
          yield* project
          const found = yield* findSdkKey(key).pipe(Effect.orDie)
          if (found._tag === "None" || found.value.component !== component) {
            return yield* new SdkKeyNotFound({ key })
          }
          return found.value
        })

        const markRevoked = Effect.fn("Projects.markRevoked")(function* (component: ComponentKey, key: SdkKey) {
          const row = yield* componentSdkKey(component, key)
          const revokedAt = yield* DateTime.now
          yield* sql`UPDATE projects_sdk_keys SET revoked_at = ${DateTime.formatIso(revokedAt)}
            WHERE key = ${key}`.pipe(Effect.orDie)
          return issuedSdkKeyOf({ ...row, revokedAt })
        })

        // A key revoked before is answered from its row, with no commit: a commit emits activity.
        const revokeSdkKey = Effect.fn("Projects.revokeSdkKey")(function* (
          actor: Actor,
          component: ComponentKey,
          key: SdkKey,
        ) {
          const current = yield* componentSdkKey(component, key)
          if (current.revokedAt !== null) {
            return issuedSdkKeyOf(current)
          }
          return yield* log.commit({
            source,
            actor,
            write: markRevoked(component, key),
            activity: (revoked) => [
              {
                payload: SdkKeyRevoked.make({ component: revoked.component, key: revoked.key }),
                component: revoked.component,
              },
            ],
          })
        })

        const authenticateSdkKey = Effect.fn("Projects.authenticateSdkKey")(function* (key: SdkKey) {
          const scope = sdkKeyScope(key)
          if (scope.project !== settings.project) {
            return yield* new SdkKeyNotFound({ key })
          }
          const found = yield* findSdkKey(key).pipe(Effect.orDie)
          const active = found._tag === "Some" && found.value.revokedAt === null
          if (!active) {
            return yield* new SdkKeyNotFound({ key })
          }
          return found.value.component
        })

        return Projects.of({
          create,
          project,
          components,
          addComponent,
          authenticate,
          linkComponent,
          settings: projectSettings,
          updateSettings,
          issueSdkKey,
          sdkKeys,
          revokeSdkKey,
          authenticateSdkKey,
        })
      }),
    )
}
