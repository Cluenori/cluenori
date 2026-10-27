import type { Actor } from "@cluenori/foundation"
import { ActivityLog, ComponentKey, Instant, ProcessName, Source } from "@cluenori/foundation"
import type { ProjectKey } from "@cluenori/foundation"
import { Repository } from "@cluenori/github"
import { Context, Crypto, DateTime, Duration, Effect, Layer, Option, Redacted, Schema } from "effect"
import { Base64Url, Hex } from "effect/encoding"
import { SqlClient, SqlSchema } from "effect/sql"

import type { AddComponent, ComponentLinks } from "./component.ts"
import { Component, ComponentExists, ComponentNotFound, ComponentName, DeployTarget } from "./component.ts"
import { IngestKey, IngestKeyRejected, ingestKeyScope } from "./ingest-key.ts"
import type { AddIngestKey, IngestKeyList } from "./issued-ingest-key.ts"
import {
  endedIngestKeysKept,
  IngestKeyId,
  IngestKeyInfo,
  IngestKeyName,
  IngestKeyNotFound,
  IngestKeyRefused,
  ingestKeysPerComponent,
  ingestKeyWarnings,
} from "./issued-ingest-key.ts"
import { IssuedSdkKey, SdkKeyNotFound, sdkKeysPerComponent, TooManySdkKeys } from "./issued-sdk-key.ts"
import type { SdkKeyList } from "./issued-sdk-key.ts"
import type { ProjectName } from "./project.ts"
import { defaultProjectSettings, Project, ProjectExists, ProjectNotFound, ProjectSettings } from "./project.ts"
import {
  ComponentAdded,
  ComponentLinked,
  IngestKeyAdded,
  IngestKeyExpiring,
  IngestKeyRevoked,
  ProjectCreated,
  ProjectReset,
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
const checker = { _tag: "System" as const, process: ProcessName.make("projects.check") }
const hourMillis = 3_600_000

/** A key just added, with the key itself: the only time it is shown. */
export interface AddedIngestKeyOf {
  readonly key: IngestKeyInfo
  readonly ingestKey: Redacted.Redacted<IngestKey>
}

// An ingest key as its row holds it: times in Unix ms, null when absent.
const IngestKeyRow = Schema.Struct({
  id: IngestKeyId,
  component: ComponentKey,
  name: IngestKeyName,
  createdAt: Instant,
  lastUsedAt: Schema.NullOr(Schema.Finite),
  expiresAt: Schema.NullOr(Schema.Finite),
  revokedAt: Schema.NullOr(Schema.Finite),
  // The shortest warning said of it, in ms before its expiry: a week, then a day.
  warnedWithin: Schema.NullOr(Schema.Finite),
})
type IngestKeyRow = typeof IngestKeyRow.Type

const ingestKeyInfoOf = (row: IngestKeyRow) =>
  new IngestKeyInfo({
    id: row.id,
    component: row.component,
    name: row.name,
    createdAt: row.createdAt,
    ...(row.lastUsedAt === null ? {} : { lastUsedAt: DateTime.makeUnsafe(row.lastUsedAt) }),
    ...(row.expiresAt === null ? {} : { expiresAt: DateTime.makeUnsafe(row.expiresAt) }),
    ...(row.revokedAt === null ? {} : { revokedAt: DateTime.makeUnsafe(row.revokedAt) }),
  })

interface MadeKey {
  readonly ingestKey: Redacted.Redacted<IngestKey>
  readonly digest: string
  readonly id: IngestKeyId
}

// When a key stops working: its expiry or its revocation, whichever comes first; never, without either.
const endOf = (row: IngestKeyRow) => Math.min(row.expiresAt ?? Infinity, row.revokedAt ?? Infinity)

// The project as its row holds it: `resetAt` is null until its data is reset.
const ProjectRow = Schema.Struct({
  key: Project.fields.key,
  name: Project.fields.name,
  createdAt: Instant,
  resetAt: Schema.NullOr(Instant),
})

const projectOf = ({ resetAt, ...row }: typeof ProjectRow.Type) =>
  new Project({ ...row, ...(resetAt === null ? {} : { resetAt }) })

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
    /**
     * Marks the project's data reset now, with `project.reset`, and returns it and `resetAt`. Only
     * the mark: each engine and module deletes its own data, which the host has them do after
     * this, before the time `resetAt` names. Running it again moves `resetAt` to the later time.
     * Its configuration (components, keys, settings) is kept. Writes one row.
     */
    readonly reset: (
      actor: Actor,
    ) => Effect.Effect<{ readonly project: Project; readonly resetAt: DateTime.Utc }, ProjectNotFound>
    /** The project's components, by key. */
    readonly components: Effect.Effect<ReadonlyArray<Component>, ProjectNotFound>
    /**
     * Adds a component, with `component.added`, and makes its first ingest key, named `first`,
     * which never expires. The key is returned here only, once: the project keeps only its SHA-256
     * digest. Fails with `ComponentExists` when the
     * project has a component with that key.
     */
    readonly addComponent: (
      actor: Actor,
      input: AddComponent,
    ) => Effect.Effect<AddedComponent, ComponentExists | ProjectNotFound>
    /**
     * The component `key` belongs to, when it is one of the component's keys that work now. Fails
     * with `IngestKeyRejected`, the same way whatever is wrong, for any key that isn't, expired and
     * revoked ones too. Reads one row, and writes it at most once an hour, when the key's last use
     * moves to a new hour.
     */
    readonly authenticate: (key: Redacted.Redacted<IngestKey>) => Effect.Effect<ComponentKey, IngestKeyRejected>
    /**
     * The component's ingest keys, the newest first: those that work, and those that ended in the
     * last 30 days, never the keys themselves. Fails with `ComponentNotFound` for a component the
     * project lacks.
     */
    readonly ingestKeys: (component: ComponentKey) => Effect.Effect<IngestKeyList, ComponentNotFound | ProjectNotFound>
    /**
     * Adds an ingest key to `component`, with `ingest_key.added`; its other keys keep working, so
     * one can replace another without a gap. The key is returned here only, once: the project keeps
     * its SHA-256 digest. Fails with `IngestKeyRefused`: `tooMany` when 10 of the component's keys
     * work, `expiryPast` when `expiresAt` isn't after now.
     */
    readonly addIngestKey: (
      actor: Actor,
      component: ComponentKey,
      input: AddIngestKey,
    ) => Effect.Effect<AddedIngestKeyOf, IngestKeyRefused | ComponentNotFound | ProjectNotFound>
    /**
     * Revokes one of the component's ingest keys, with `ingest_key.revoked`: it stops working `at`,
     * or now when `at` is absent or past. A revocation moves only earlier: one later than the key's
     * end, or of a key that ended, returns the key as it is, without new activity. Fails with
     * `IngestKeyNotFound` for a key that isn't one of the component's listed keys.
     */
    readonly revokeIngestKey: (
      actor: Actor,
      component: ComponentKey,
      key: IngestKeyId,
      at: DateTime.Utc | undefined,
    ) => Effect.Effect<IngestKeyInfo, IngestKeyNotFound | ProjectNotFound>
    /**
     * The project's keys' upkeep, which the host runs on its alarm: says `ingest_key.expiring` of
     * each key a week before it expires and again a day before, each once, but not of a key revoked
     * before it would expire; and forgets keys that ended over 30 days ago. Reads the keys, a few
     * rows.
     */
    readonly checkIngestKeys: Effect.Effect<void>
    /**
     * The project's ingest keys that expire within a week and aren't revoked before, the soonest
     * first: what Today asks its owners to replace. Reads the keys, a few rows.
     */
    readonly expiringIngestKeys: Effect.Effect<ReadonlyArray<IngestKeyInfo>>
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
     * listed again. Fails with `ComponentNotFound` for a component the project lacks, and with
     * `TooManySdkKeys` when 20 of its keys are active.
     */
    readonly issueSdkKey: (
      actor: Actor,
      component: ComponentKey,
    ) => Effect.Effect<IssuedSdkKey, ComponentNotFound | ProjectNotFound | TooManySdkKeys>
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
          Result: ProjectRow,
          execute: () => sql`SELECT key, name, created_at AS "createdAt", reset_at AS "resetAt" FROM projects_project`,
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
          Result: Schema.Struct({ key: ComponentKey }),
          execute: (key) => sql`SELECT key FROM projects_components WHERE key = ${key}`,
        })

        // Ingest keys are ASCII, so their characters are their bytes.
        const digestOf = Effect.fn("Projects.digestOf")(function* (key: IngestKey) {
          const bytes = Uint8Array.from(key, (character) => character.charCodeAt(0))
          const digest = yield* crypto.digest("SHA-256", bytes).pipe(Effect.orDie)
          return Hex.encode(digest)
        })

        const keyColumns = sql`SELECT id, component, name, created_at AS "createdAt", last_used_at AS "lastUsedAt",
            expires_at AS "expiresAt", revoked_at AS "revokedAt", warned_within AS "warnedWithin"
          FROM projects_ingest_keys`

        // A new key, its digest and its ID, made before a write's transaction, which holds only SQL.
        const makeKey = Effect.fn("Projects.makeKey")(function* (component: ComponentKey) {
          const secret = yield* crypto.randomBytes(32).pipe(Effect.orDie)
          const ingestKey = IngestKey.make(`cluenori.${settings.project}.${component}.${Base64Url.encode(secret)}`)
          const digest = yield* digestOf(ingestKey)
          const id = IngestKeyId.make(yield* crypto.randomUUIDv7().pipe(Effect.orDie))
          return { ingestKey: Redacted.make(ingestKey), digest, id }
        })

        const insertKey = (
          component: ComponentKey,
          made: MadeKey,
          name: IngestKeyName,
          expiresAt: DateTime.Utc | undefined,
          createdAt: DateTime.Utc,
        ) =>
          sql`INSERT INTO projects_ingest_keys ${sql.insert({
            id: made.id,
            component,
            name,
            digest: made.digest,
            created_at: DateTime.formatIso(createdAt),
            expires_at: expiresAt === undefined ? null : DateTime.toEpochMillis(expiresAt),
          })}`.pipe(Effect.orDie)

        const project = findProject(undefined).pipe(
          Effect.orDie,
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.fail(new ProjectNotFound({ project: settings.project })),
              onSome: (row) => Effect.succeed(projectOf(row)),
            }),
          ),
          Effect.withSpan("Projects.project"),
        )

        const encodeReset = Schema.encodeEffect(ProjectReset)

        const markReset = Effect.fn("Projects.markReset")(function* (at: DateTime.Utc) {
          const current = yield* project
          yield* sql`UPDATE projects_project SET reset_at = ${DateTime.formatIso(at)}`.pipe(Effect.orDie)
          const reset = new Project({ key: current.key, name: current.name, createdAt: current.createdAt, resetAt: at })
          return { project: reset, resetAt: at }
        })

        const reset = Effect.fn("Projects.reset")(function* (actor: Actor) {
          const at = yield* DateTime.now
          const payload = yield* encodeReset(ProjectReset.make({ project: settings.project, at })).pipe(Effect.orDie)
          return yield* log.commit({ source, actor, write: markReset(at), activity: () => [{ payload }] })
        })

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

        const insertComponent = Effect.fn("Projects.insertComponent")(function* (input: AddComponent, made: MadeKey) {
          yield* project
          const existing = yield* findComponent(input.key).pipe(Effect.orDie)
          if (existing._tag === "Some") {
            return yield* new ComponentExists({ component: input.key })
          }
          const createdAt = yield* DateTime.now
          yield* sql`INSERT INTO projects_components ${sql.insert({ key: input.key, name: input.name, created_at: DateTime.formatIso(createdAt) })}`.pipe(
            Effect.orDie,
          )
          yield* insertKey(input.key, made, IngestKeyName.make("first"), undefined, createdAt)
          return new Component({ key: input.key, name: input.name, createdAt })
        })

        // The key and its digest are made before the transaction, which holds only SQL.
        const addComponent = Effect.fn("Projects.addComponent")(function* (actor: Actor, input: AddComponent) {
          const made = yield* makeKey(input.key)
          const ingestKey = made.ingestKey
          const component = yield* log.commit({
            source,
            actor,
            write: insertComponent(input, made),
            activity: (added) => [
              { payload: ComponentAdded.make({ component: added.key, name: added.name }), component: added.key },
            ],
          })
          return { component, ingestKey }
        })

        const findKeyByDigest = SqlSchema.findOneOption({
          Request: Schema.String,
          Result: IngestKeyRow,
          execute: (digest) => sql`${keyColumns} WHERE digest = ${digest}`,
        })

        const authenticate = Effect.fn("Projects.authenticate")(function* (key: Redacted.Redacted<IngestKey>) {
          const presented = Redacted.value(key)
          const scope = ingestKeyScope(presented)
          if (scope.project !== settings.project) {
            return yield* new IngestKeyRejected()
          }
          // Looked up by digest, so the comparison reveals nothing about a key.
          const digest = yield* digestOf(presented)
          const found = yield* findKeyByDigest(digest).pipe(Effect.orDie)
          const now = DateTime.toEpochMillis(yield* DateTime.now)
          if (Option.isNone(found) || found.value.component !== scope.component || endOf(found.value) <= now) {
            return yield* new IngestKeyRejected()
          }
          // Its last use, by the hour: a write the first time in each hour, none after.
          const hour = now - (now % hourMillis)
          if (found.value.lastUsedAt === null || found.value.lastUsedAt < hour) {
            yield* sql`UPDATE projects_ingest_keys SET last_used_at = ${hour} WHERE id = ${found.value.id}`.pipe(
              Effect.orDie,
            )
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
          const active = (yield* findSdkKeys(component).pipe(Effect.orDie)).filter((row) => row.revokedAt === null)
          if (active.length >= sdkKeysPerComponent) {
            return yield* new TooManySdkKeys({ component })
          }
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

        const encodeAdded = Schema.encodeEffect(IngestKeyAdded)
        const encodeRevoked = Schema.encodeEffect(IngestKeyRevoked)
        const encodeExpiring = Schema.encodeEffect(IngestKeyExpiring)

        const findKeys = SqlSchema.findAll({
          Request: ComponentKey,
          Result: IngestKeyRow,
          execute: (component) =>
            sql`${keyColumns} WHERE component = ${component} ORDER BY created_at DESC, rowid DESC`,
        })
        const findAllKeys = SqlSchema.findAll({
          Request: Schema.Void,
          Result: IngestKeyRow,
          execute: () => sql`${keyColumns}`,
        })

        const ingestKeys = Effect.fn("Projects.ingestKeys")(function* (component: ComponentKey) {
          yield* componentExists(component)
          const rows = yield* findKeys(component).pipe(Effect.orDie)
          return { keys: rows.map(ingestKeyInfoOf) }
        })

        const insertIngestKey = Effect.fn("Projects.insertIngestKey")(function* (
          component: ComponentKey,
          input: AddIngestKey,
          made: MadeKey,
        ) {
          yield* componentExists(component)
          const createdAt = yield* DateTime.now
          const now = DateTime.toEpochMillis(createdAt)
          if (input.expiresAt !== undefined && DateTime.toEpochMillis(input.expiresAt) <= now) {
            return yield* new IngestKeyRefused({ reason: "expiryPast" })
          }
          const working = (yield* findKeys(component).pipe(Effect.orDie)).filter((row) => endOf(row) > now)
          if (working.length >= ingestKeysPerComponent) {
            return yield* new IngestKeyRefused({ reason: "tooMany" })
          }
          yield* insertKey(component, made, input.name, input.expiresAt, createdAt)
          return new IngestKeyInfo({
            id: made.id,
            component,
            name: input.name,
            createdAt,
            ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
          })
        })

        const addIngestKey = Effect.fn("Projects.addIngestKey")(function* (
          actor: Actor,
          component: ComponentKey,
          input: AddIngestKey,
        ) {
          const made = yield* makeKey(component)
          const payload = yield* encodeAdded(
            IngestKeyAdded.make({
              component,
              key: made.id,
              name: input.name,
              ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
            }),
          ).pipe(Effect.orDie)
          const key = yield* log.commit({
            source,
            actor,
            write: insertIngestKey(component, input, made),
            activity: () => [{ payload, component }],
          })
          return { key, ingestKey: made.ingestKey }
        })

        const componentKey = Effect.fn("Projects.componentKey")(function* (component: ComponentKey, id: IngestKeyId) {
          yield* project
          const rows = yield* findKeys(component).pipe(Effect.orDie)
          const row = rows.find((each) => each.id === id)
          if (row === undefined) {
            return yield* new IngestKeyNotFound({ key: id })
          }
          return row
        })

        const markKeyRevoked = Effect.fn("Projects.markKeyRevoked")(function* (
          component: ComponentKey,
          id: IngestKeyId,
          at: number,
        ) {
          const row = yield* componentKey(component, id)
          yield* sql`UPDATE projects_ingest_keys SET revoked_at = ${at} WHERE id = ${id}`.pipe(Effect.orDie)
          return { ...row, revokedAt: at }
        })

        // A revocation that wouldn't end the key sooner is answered from its row, with no commit.
        const revokeIngestKey = Effect.fn("Projects.revokeIngestKey")(function* (
          actor: Actor,
          component: ComponentKey,
          id: IngestKeyId,
          at: DateTime.Utc | undefined,
        ) {
          const current = yield* componentKey(component, id)
          const now = DateTime.toEpochMillis(yield* DateTime.now)
          const when = Math.max(now, at === undefined ? now : DateTime.toEpochMillis(at))
          if (when >= endOf(current)) {
            return ingestKeyInfoOf(current)
          }
          const payload = yield* encodeRevoked(
            IngestKeyRevoked.make({ component, key: id, name: current.name, at: DateTime.makeUnsafe(when) }),
          ).pipe(Effect.orDie)
          const revoked = yield* log.commit({
            source,
            actor,
            write: markKeyRevoked(component, id, when),
            activity: () => [{ payload, component }],
          })
          return ingestKeyInfoOf(revoked)
        })

        // Each key that expires within a warning's time, isn't revoked before it would, and wasn't
        // warned of within that time yet, is warned of once; a key that skipped the week, made with
        // a day left, hears only the day's.
        const checkIngestKeys = Effect.gen(function* () {
          const now = DateTime.toEpochMillis(yield* DateTime.now)
          const rows = yield* findAllKeys(undefined).pipe(Effect.orDie)
          for (const row of rows) {
            const expires = row.expiresAt
            if (expires === null || expires <= now || (row.revokedAt !== null && row.revokedAt <= expires)) {
              continue
            }
            // The warnings run from the earliest, so the last that applies is the nearest.
            const within = ingestKeyWarnings.map(Duration.toMillis).findLast((before) => expires - now <= before)
            if (within === undefined || (row.warnedWithin !== null && row.warnedWithin <= within)) {
              continue
            }
            const payload = yield* encodeExpiring(
              IngestKeyExpiring.make({
                component: row.component,
                key: row.id,
                name: row.name,
                expiresAt: DateTime.makeUnsafe(expires),
              }),
            ).pipe(Effect.orDie)
            yield* log.commit({
              source,
              actor: checker,
              write: sql`UPDATE projects_ingest_keys SET warned_within = ${within} WHERE id = ${row.id}`.pipe(
                Effect.orDie,
              ),
              activity: () => [{ payload, component: row.component }],
            })
          }
          const forgetBefore = now - Duration.toMillis(endedIngestKeysKept)
          yield* sql`DELETE FROM projects_ingest_keys WHERE min(coalesce(expires_at, ${Number.MAX_SAFE_INTEGER}),
            coalesce(revoked_at, ${Number.MAX_SAFE_INTEGER})) < ${forgetBefore}`.pipe(Effect.orDie)
        }).pipe(Effect.withSpan("Projects.checkIngestKeys"))

        const expiringIngestKeys = Effect.gen(function* () {
          const now = DateTime.toEpochMillis(yield* DateTime.now)
          const within = now + Math.max(...ingestKeyWarnings.map(Duration.toMillis))
          const rows = yield* findAllKeys(undefined).pipe(Effect.orDie)
          return rows
            .filter(
              (row) =>
                row.expiresAt !== null &&
                row.expiresAt > now &&
                row.expiresAt <= within &&
                (row.revokedAt === null || row.revokedAt > row.expiresAt),
            )
            .toSorted((left, right) => (left.expiresAt ?? 0) - (right.expiresAt ?? 0))
            .map(ingestKeyInfoOf)
        }).pipe(Effect.withSpan("Projects.expiringIngestKeys"))

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
          reset,
          components,
          addComponent,
          authenticate,
          ingestKeys,
          addIngestKey,
          revokeIngestKey,
          checkIngestKeys,
          expiringIngestKeys,
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
