import { CommitSha } from "@bagatka/github"
import { ComponentKey, EnvironmentKey, ReleaseVersion } from "@cluenori/foundation"
import { Context, DateTime, Effect, Layer, Option, Schema } from "effect"
import { Migrator, SqlClient, SqlSchema } from "effect/sql"

import { ReleaseChanges, ReleaseCommit, StoreBuild } from "./release.ts"

/** Where a release's facts came from. */
export type Source = "github" | "appStoreConnect"

/** A deploy reported by `cluenori-release`. */
export interface Deploy {
  readonly component: ComponentKey
  readonly environment: EnvironmentKey | undefined
  readonly release: ReleaseVersion
  readonly commit: CommitSha
  readonly deployedAt: DateTime.Utc
}

/** An app's build, kept with its component and the release it is. */
export interface StoredBuild {
  readonly component: ComponentKey
  readonly release: ReleaseVersion
  readonly build: StoreBuild
}

/** A source's last read of a component: when, and what went wrong, if anything. */
export interface Sync {
  readonly component: ComponentKey
  readonly source: Source
  readonly at: DateTime.Utc
  readonly problem: string | undefined
}

const migrate = Migrator.make({})({
  table: "releases_migrations",
  loader: Migrator.fromRecord({
    // A release's commit, from a deploy report or its repository; lookups that found none, so they
    // wait before trying again; what changed since the release before; an app's builds in App Store
    // Connect, by the release they are; deploys reported; and each source's last read.
    "0001_records": Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`CREATE TABLE releases_commits (
        component TEXT NOT NULL,
        release TEXT NOT NULL,
        commit_json TEXT NOT NULL,
        PRIMARY KEY (component, release)
      ) WITHOUT ROWID`
      yield* sql`CREATE TABLE releases_lookups (
        component TEXT NOT NULL,
        release TEXT NOT NULL,
        tried_at INTEGER NOT NULL,
        PRIMARY KEY (component, release)
      ) WITHOUT ROWID`
      yield* sql`CREATE TABLE releases_changes (
        component TEXT NOT NULL,
        release TEXT NOT NULL,
        previous TEXT NOT NULL,
        changes_json TEXT NOT NULL,
        PRIMARY KEY (component, release, previous)
      ) WITHOUT ROWID`
      yield* sql`CREATE TABLE releases_store_builds (
        component TEXT NOT NULL,
        release TEXT NOT NULL,
        uploaded_at INTEGER NOT NULL,
        build_json TEXT NOT NULL,
        PRIMARY KEY (component, release)
      ) WITHOUT ROWID`
      yield* sql`CREATE TABLE releases_deploys (
        component TEXT NOT NULL,
        environment TEXT NOT NULL,
        release TEXT NOT NULL,
        commit_sha TEXT NOT NULL,
        deployed_at INTEGER NOT NULL,
        PRIMARY KEY (component, environment, release)
      ) WITHOUT ROWID`
      yield* sql`CREATE TABLE releases_syncs (
        component TEXT NOT NULL,
        source TEXT NOT NULL,
        synced_at INTEGER NOT NULL,
        problem TEXT,
        PRIMARY KEY (component, source)
      ) WITHOUT ROWID`
    }),
  }),
})

const CommitJson = Schema.fromJsonString(ReleaseCommit)
const ChangesJson = Schema.fromJsonString(ReleaseChanges)
const BuildJson = Schema.fromJsonString(StoreBuild)

/**
 * What the Releases module keeps in the project's database: releases' commits and changes, apps'
 * store builds, reported deploys, and when each source last read each component. Facts other
 * engines own (counts, errors, incidents) are read from them, never copied here.
 */
export class ReleaseRecords extends Context.Service<
  ReleaseRecords,
  {
    /** The commits found for a component's releases, by release. */
    readonly commits: (component: ComponentKey) => Effect.Effect<ReadonlyMap<string, ReleaseCommit>>
    readonly saveCommit: (
      component: ComponentKey,
      release: ReleaseVersion,
      commit: ReleaseCommit,
    ) => Effect.Effect<void>
    /** When a lookup of a release's commit last found none; absent when none was tried, or one was found. */
    readonly lookupTriedAt: (
      component: ComponentKey,
      release: ReleaseVersion,
    ) => Effect.Effect<Option.Option<DateTime.Utc>>
    readonly saveLookup: (component: ComponentKey, release: ReleaseVersion, at: DateTime.Utc) => Effect.Effect<void>
    /** What changed from `previous` to `release`, once found. */
    readonly changes: (
      component: ComponentKey,
      release: ReleaseVersion,
      previous: ReleaseVersion,
    ) => Effect.Effect<Option.Option<ReleaseChanges>>
    readonly saveChanges: (
      component: ComponentKey,
      release: ReleaseVersion,
      previous: ReleaseVersion,
      changes: ReleaseChanges,
    ) => Effect.Effect<void>
    /** Apps' builds, of every component or one, each with the release it is: `2.4.0+312`. */
    readonly storeBuilds: (component?: ComponentKey) => Effect.Effect<ReadonlyArray<StoredBuild>>
    /** Replaces an app's builds with those App Store Connect listed now, by release. */
    readonly replaceStoreBuilds: (
      component: ComponentKey,
      builds: ReadonlyArray<{ readonly release: ReleaseVersion; readonly build: StoreBuild }>,
    ) => Effect.Effect<void>
    /** Deploys reported, the latest first, of every component or one. */
    readonly deploys: (component?: ComponentKey) => Effect.Effect<ReadonlyArray<Deploy>>
    /** Records a deploy; one of the same release and environment reported again keeps the first time. */
    readonly saveDeploy: (deploy: Deploy) => Effect.Effect<void>
    /** Each source's last read of each component. */
    readonly syncs: Effect.Effect<ReadonlyArray<Sync>>
    readonly saveSync: (sync: Sync) => Effect.Effect<void>
  }
>()("@cluenori/releases/records/ReleaseRecords") {
  /** The records on the project's database, first creating or updating its tables. */
  static readonly layer = Layer.effect(
    ReleaseRecords,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* migrate.pipe(Effect.orDie)

      const findCommits = SqlSchema.findAll({
        Request: ComponentKey,
        Result: Schema.Struct({ release: Schema.String, commit: CommitJson }),
        execute: (component) =>
          sql`SELECT release, commit_json AS "commit" FROM releases_commits WHERE component = ${component}`,
      })
      const findLookup = SqlSchema.findOneOption({
        Request: Schema.Struct({ component: ComponentKey, release: ReleaseVersion }),
        Result: Schema.Struct({ triedAt: Schema.Int }),
        execute: (key) =>
          sql`SELECT tried_at AS "triedAt" FROM releases_lookups WHERE component = ${key.component} AND release = ${key.release}`,
      })
      const findChanges = SqlSchema.findOneOption({
        Request: Schema.Struct({ component: ComponentKey, release: ReleaseVersion, previous: ReleaseVersion }),
        Result: Schema.Struct({ changes: ChangesJson }),
        execute: (key) =>
          sql`SELECT changes_json AS "changes" FROM releases_changes
            WHERE component = ${key.component} AND release = ${key.release} AND previous = ${key.previous}`,
      })
      const findBuilds = SqlSchema.findAll({
        Request: Schema.Struct({ component: Schema.optionalKey(ComponentKey) }),
        Result: Schema.Struct({ component: ComponentKey, release: ReleaseVersion, build: BuildJson }),
        execute: (asked) =>
          sql`SELECT component, release, build_json AS "build" FROM releases_store_builds
            ${asked.component === undefined ? sql`` : sql`WHERE component = ${asked.component}`}
            ORDER BY uploaded_at DESC`,
      })
      const findDeploys = SqlSchema.findAll({
        Request: Schema.Struct({ component: Schema.optionalKey(ComponentKey) }),
        Result: Schema.Struct({
          component: ComponentKey,
          environment: Schema.Union([Schema.Literal(""), EnvironmentKey]),
          release: ReleaseVersion,
          commit: CommitSha,
          deployedAt: Schema.Int,
        }),
        execute: (asked) =>
          sql`SELECT component, environment, release, commit_sha AS "commit", deployed_at AS "deployedAt"
            FROM releases_deploys
            ${asked.component === undefined ? sql`` : sql`WHERE component = ${asked.component}`}
            ORDER BY deployed_at DESC`,
      })
      const findSyncs = SqlSchema.findAll({
        Request: Schema.Void,
        Result: Schema.Struct({
          component: ComponentKey,
          source: Schema.Literals(["github", "appStoreConnect"]),
          at: Schema.Int,
          problem: Schema.NullOr(Schema.String),
        }),
        execute: () => sql`SELECT component, source, synced_at AS "at", problem FROM releases_syncs`,
      })
      const encodeCommit = Schema.encodeEffect(CommitJson)
      const encodeChanges = Schema.encodeEffect(ChangesJson)
      const encodeBuild = Schema.encodeEffect(BuildJson)

      return ReleaseRecords.of({
        commits: (component) =>
          findCommits(component).pipe(
            Effect.orDie,
            Effect.map((rows) => new Map(rows.map((row) => [row.release, row.commit] as const))),
          ),
        saveCommit: (component, release, commit) =>
          Effect.gen(function* () {
            const json = yield* encodeCommit(commit)
            yield* sql`INSERT INTO releases_commits ${sql.insert({ component, release, commit_json: json })}
              ON CONFLICT (component, release) DO UPDATE SET commit_json = excluded.commit_json`
            yield* sql`DELETE FROM releases_lookups WHERE component = ${component} AND release = ${release}`
          }).pipe(Effect.orDie),
        lookupTriedAt: (component, release) =>
          findLookup({ component, release }).pipe(
            Effect.orDie,
            Effect.map(Option.map((row) => DateTime.makeUnsafe(row.triedAt))),
          ),
        saveLookup: (component, release, at) =>
          sql`INSERT INTO releases_lookups ${sql.insert({ component, release, tried_at: DateTime.toEpochMillis(at) })}
            ON CONFLICT (component, release) DO UPDATE SET tried_at = excluded.tried_at`.pipe(
            Effect.asVoid,
            Effect.orDie,
          ),
        changes: (component, release, previous) =>
          findChanges({ component, release, previous }).pipe(
            Effect.orDie,
            Effect.map(Option.map((row) => row.changes)),
          ),
        saveChanges: (component, release, previous, changes) =>
          Effect.gen(function* () {
            const json = yield* encodeChanges(changes)
            yield* sql`INSERT INTO releases_changes ${sql.insert({ component, release, previous, changes_json: json })}
              ON CONFLICT (component, release, previous) DO UPDATE SET changes_json = excluded.changes_json`
          }).pipe(Effect.orDie),
        storeBuilds: (component) => findBuilds(component === undefined ? {} : { component }).pipe(Effect.orDie),
        replaceStoreBuilds: (component, builds) =>
          Effect.gen(function* () {
            yield* sql`DELETE FROM releases_store_builds WHERE component = ${component}`
            for (const { release, build } of builds) {
              const json = yield* encodeBuild(build)
              yield* sql`INSERT OR REPLACE INTO releases_store_builds ${sql.insert({
                component,
                release,
                uploaded_at: DateTime.toEpochMillis(build.uploadedAt),
                build_json: json,
              })}`
            }
          }).pipe(Effect.orDie),
        deploys: (component) =>
          findDeploys(component === undefined ? {} : { component }).pipe(
            Effect.orDie,
            Effect.map((rows) =>
              rows.map((row): Deploy => ({
                component: row.component,
                environment: row.environment === "" ? undefined : row.environment,
                release: row.release,
                commit: row.commit,
                deployedAt: DateTime.makeUnsafe(row.deployedAt),
              })),
            ),
          ),
        saveDeploy: (deploy) =>
          sql`INSERT INTO releases_deploys ${sql.insert({
            component: deploy.component,
            environment: deploy.environment ?? "",
            release: deploy.release,
            commit_sha: deploy.commit,
            deployed_at: DateTime.toEpochMillis(deploy.deployedAt),
          })}
            ON CONFLICT (component, environment, release) DO NOTHING`.pipe(Effect.asVoid, Effect.orDie),
        syncs: findSyncs(undefined).pipe(
          Effect.orDie,
          Effect.map((rows) =>
            rows.map((row): Sync => ({
              component: row.component,
              source: row.source,
              at: DateTime.makeUnsafe(row.at),
              problem: row.problem ?? undefined,
            })),
          ),
        ),
        saveSync: (sync) =>
          sql`INSERT INTO releases_syncs ${sql.insert({
            component: sync.component,
            source: sync.source,
            synced_at: DateTime.toEpochMillis(sync.at),
            problem: sync.problem ?? null,
          })}
            ON CONFLICT (component, source) DO UPDATE SET synced_at = excluded.synced_at, problem = excluded.problem`.pipe(
            Effect.asVoid,
            Effect.orDie,
          ),
      })
    }),
  )
}
