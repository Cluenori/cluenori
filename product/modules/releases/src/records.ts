import { Actor, ComponentKey, EnvironmentKey, ReleaseVersion } from "@cluenori/foundation"
import { CommitSha } from "@cluenori/github"
import { Context, DateTime, Effect, Layer, Option, Schema } from "effect"
import { Migrator, SqlClient, SqlSchema } from "effect/sql"

import type { ReleaseNote } from "./note.ts"
import { NoteLocale, NoteText } from "./note.ts"
import { hasEnded, Promotion } from "./promotion.ts"
import { ReleaseChanges, ReleaseCommit, StoreBuild } from "./release.ts"
import { ComponentVersionPolicy } from "./version-policy.ts"
import { SemanticVersion } from "./version.ts"

/** Where a release's facts came from. */
export type Source = "github" | "appStoreConnect"

/** A deploy reported by `cluenori-release`. */
export interface Deploy {
  readonly component: ComponentKey
  readonly environment: EnvironmentKey | undefined
  readonly release: ReleaseVersion
  readonly commit: CommitSha
  /** When it was first reported there. */
  readonly deployedAt: DateTime.Utc
  /** When it was last reported there: later than `deployedAt` once deployed there again, as in a rollback. */
  readonly lastDeployedAt: DateTime.Utc
}

/** An app's build, kept with its component, the environment whose app it is in, and the release it is. */
export interface StoredBuild {
  readonly component: ComponentKey
  readonly environment: EnvironmentKey
  readonly release: ReleaseVersion
  readonly build: StoreBuild
}

/** What a component's next builds are numbered from: its version, and the last build number given; 0 for none yet. */
export interface VersionLine {
  readonly component: ComponentKey
  readonly version: SemanticVersion
  readonly lastBuild: number
  readonly setAt: DateTime.Utc
}

/** The release a commit was numbered as, once and for good. */
export interface NumberedCommit {
  readonly component: ComponentKey
  readonly commit: CommitSha
  readonly release: ReleaseVersion
  readonly version: SemanticVersion
  readonly build: number
}

/** A release that reached production: to be published, or published again, on GitHub's Releases page. */
export interface ReachedProduction {
  readonly component: ComponentKey
  readonly release: ReleaseVersion
  /** The production environment it reached; none for a deploy that named none. */
  readonly environment: EnvironmentKey | undefined
  readonly reachedAt: DateTime.Utc
}

/** A release to publish, and how many times it was marked, to tell a mark made while it was published. */
export interface ReleaseToPublish extends ReachedProduction {
  readonly marked: number
}

/** A release's page on GitHub's Releases page, once published. */
export interface PublishedRelease {
  readonly url: string
  readonly publishedAt: DateTime.Utc
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
    // Promotions, each as JSON, with the actor who started it, and what they are found by: their
    // component, environment and release, when they started (Unix ms), and whether they ended.
    "0002_promotions": Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`CREATE TABLE releases_promotions (
        id TEXT PRIMARY KEY,
        component TEXT NOT NULL,
        environment TEXT NOT NULL,
        release TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended INTEGER NOT NULL,
        actor TEXT NOT NULL,
        promotion_json TEXT NOT NULL
      ) WITHOUT ROWID`
      yield* sql`CREATE INDEX releases_promotions_by_release ON releases_promotions (component, release, started_at)`
      yield* sql`CREATE INDEX releases_promotions_unended ON releases_promotions (started_at) WHERE ended = 0`
    }),
    // Store builds by the environment whose App Store app they are in, as each deploy target has its
    // own app; those kept before are read again within a minute. Each component's version line, and
    // each commit's number, unique for good.
    "0003_versions": Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`DROP TABLE releases_store_builds`
      yield* sql`CREATE TABLE releases_store_builds (
        component TEXT NOT NULL,
        environment TEXT NOT NULL,
        release TEXT NOT NULL,
        uploaded_at INTEGER NOT NULL,
        build_json TEXT NOT NULL,
        PRIMARY KEY (component, environment, release)
      ) WITHOUT ROWID`
      yield* sql`DELETE FROM releases_syncs WHERE source = 'appStoreConnect'`
      yield* sql`CREATE TABLE releases_versions (
        component TEXT PRIMARY KEY,
        version TEXT NOT NULL,
        last_build INTEGER NOT NULL,
        set_at INTEGER NOT NULL
      ) WITHOUT ROWID`
      yield* sql`CREATE TABLE releases_numbers (
        component TEXT NOT NULL,
        commit_sha TEXT NOT NULL,
        release TEXT NOT NULL,
        version TEXT NOT NULL,
        build INTEGER NOT NULL,
        numbered_at INTEGER NOT NULL,
        PRIMARY KEY (component, commit_sha),
        UNIQUE (component, release)
      ) WITHOUT ROWID`
    }),
    // Releases' notes, one for each language, and when each was saved (Unix ms); and the project's
    // notes style, one row at most.
    "0004_notes": Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`CREATE TABLE releases_notes (
        component TEXT NOT NULL,
        release TEXT NOT NULL,
        locale TEXT NOT NULL,
        text TEXT NOT NULL,
        saved_at INTEGER NOT NULL,
        PRIMARY KEY (component, release, locale)
      ) WITHOUT ROWID`
      yield* sql`CREATE TABLE releases_notes_style (
        only INTEGER PRIMARY KEY CHECK (only = 1),
        style TEXT NOT NULL
      )`
    }),
    // Releases that reached production, to publish on GitHub: the environment ('' for none) and when
    // (Unix ms); `pending` until published, and again when it must be published again, `marked`
    // counting each time; its page once published.
    "0005_github_releases": Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`CREATE TABLE releases_github_releases (
        component TEXT NOT NULL,
        release TEXT NOT NULL,
        environment TEXT NOT NULL,
        reached_at INTEGER NOT NULL,
        pending INTEGER NOT NULL,
        marked INTEGER NOT NULL,
        url TEXT,
        published_at INTEGER,
        PRIMARY KEY (component, release)
      ) WITHOUT ROWID`
    }),
    // When each deploy was last reported (Unix ms), besides its first: a release deployed again,
    // as in a rollback, is the one there now.
    "0006_deploys_again": Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`ALTER TABLE releases_deploys ADD COLUMN last_deployed_at INTEGER NOT NULL DEFAULT 0`
      yield* sql`UPDATE releases_deploys SET last_deployed_at = deployed_at`
    }),
    // Each component's version policy, as JSON, at most one.
    "0007_version_policies": Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`CREATE TABLE releases_version_policies (
        component TEXT PRIMARY KEY,
        policy_json TEXT NOT NULL
      ) WITHOUT ROWID`
    }),
  }),
})

const CommitJson = Schema.fromJsonString(ReleaseCommit)
const ChangesJson = Schema.fromJsonString(ReleaseChanges)
const BuildJson = Schema.fromJsonString(StoreBuild)
const PromotionJson = Schema.fromJsonString(Promotion)
const PolicyJson = Schema.fromJsonString(ComponentVersionPolicy)

// What a reset empties. Kept: `releases_versions`, `releases_version_policies`, `releases_notes_style`.
const resetTables = [
  "releases_commits",
  "releases_lookups",
  "releases_changes",
  "releases_store_builds",
  "releases_deploys",
  "releases_syncs",
  "releases_numbers",
  "releases_notes",
  "releases_promotions",
  "releases_github_releases",
]

// A release's promotions are listed up to this many, the latest first.
const promotionsListed = 20

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
    /** Apps' builds, of every component or one, each with its environment and the release it is: `2.4.0+312`. */
    readonly storeBuilds: (component?: ComponentKey) => Effect.Effect<ReadonlyArray<StoredBuild>>
    /** Replaces the builds of an environment's app with those App Store Connect listed now, by release. */
    readonly replaceStoreBuilds: (
      component: ComponentKey,
      environment: EnvironmentKey,
      builds: ReadonlyArray<{ readonly release: ReleaseVersion; readonly build: StoreBuild }>,
    ) => Effect.Effect<void>
    /** Every component's version line. */
    readonly versionLines: Effect.Effect<ReadonlyArray<VersionLine>>
    /** Sets a component's version, and its last build number. */
    readonly saveVersionLine: (line: VersionLine) => Effect.Effect<void>
    /** Every component's version policy, by component. */
    readonly versionPolicies: Effect.Effect<ReadonlyArray<ComponentVersionPolicy>>
    /** A component's version policy, once set. One row. */
    readonly versionPolicy: (component: ComponentKey) => Effect.Effect<Option.Option<ComponentVersionPolicy>>
    /** Sets a component's version policy, replacing the one it had. */
    readonly saveVersionPolicy: (policy: ComponentVersionPolicy) => Effect.Effect<void>
    /** Removes a component's version policy; nothing for a component without one. */
    readonly removeVersionPolicy: (component: ComponentKey) => Effect.Effect<void>
    /** The release `commit` was numbered as, if it was. */
    readonly numberOf: (component: ComponentKey, commit: CommitSha) => Effect.Effect<Option.Option<NumberedCommit>>
    /** Keeps the release a commit was numbered as. A commit or release numbered before is a defect. */
    readonly saveNumber: (numbered: NumberedCommit, at: DateTime.Utc) => Effect.Effect<void>
    /** A release's notes, by language. */
    readonly notes: (component: ComponentKey, release: ReleaseVersion) => Effect.Effect<ReadonlyArray<ReleaseNote>>
    /** Replaces a release's notes. */
    readonly saveNotes: (
      component: ComponentKey,
      release: ReleaseVersion,
      notes: ReadonlyArray<ReleaseNote>,
      at: DateTime.Utc,
    ) => Effect.Effect<void>
    /** The latest notes saved of a component's other releases, the latest first: at most `count` releases'. */
    readonly recentNotes: (
      component: ComponentKey,
      except: ReleaseVersion,
      count: number,
    ) => Effect.Effect<ReadonlyArray<{ readonly release: ReleaseVersion; readonly notes: ReadonlyArray<ReleaseNote> }>>
    /** The project's notes style, once set. */
    readonly notesStyle: Effect.Effect<Option.Option<string>>
    readonly saveNotesStyle: (style: string) => Effect.Effect<void>
    /** Deploys reported, the last reported first, of every component or one. */
    readonly deploys: (component?: ComponentKey) => Effect.Effect<ReadonlyArray<Deploy>>
    /**
     * Records a deploy; one of the same release and environment reported again keeps its first time,
     * and takes `lastDeployedAt`.
     */
    readonly saveDeploy: (deploy: Deploy) => Effect.Effect<void>
    /** Each source's last read of each component. */
    readonly syncs: Effect.Effect<ReadonlyArray<Sync>>
    readonly saveSync: (sync: Sync) => Effect.Effect<void>
    /**
     * Marks a release that just reached production, in `environment`, to be published on GitHub: a
     * release published before is published again, as the latest.
     */
    readonly queueGitHubRelease: (release: ReachedProduction) => Effect.Effect<void>
    /** Marks a release published before to be published again, as when its notes change; nothing for another. */
    readonly requeueGitHubRelease: (component: ComponentKey, release: ReleaseVersion) => Effect.Effect<void>
    /** The releases to publish, the earliest to reach production first. */
    readonly gitHubReleasesToPublish: Effect.Effect<ReadonlyArray<ReleaseToPublish>>
    /** Keeps a release's page, published now; still to publish if it was marked again meanwhile. */
    readonly saveGitHubRelease: (published: ReleaseToPublish, page: PublishedRelease) => Effect.Effect<void>
    /** A release's page on GitHub, once published. */
    readonly gitHubRelease: (
      component: ComponentKey,
      release: ReleaseVersion,
    ) => Effect.Effect<Option.Option<PublishedRelease>>
    /** A release's promotions, to every environment, the latest first: at most 20. */
    readonly promotions: (component: ComponentKey, release: ReleaseVersion) => Effect.Effect<ReadonlyArray<Promotion>>
    /** The promotions that haven't ended, the oldest first, of every component or one environment's. */
    readonly unendedPromotions: (where?: {
      readonly component: ComponentKey
      readonly environment: EnvironmentKey
    }) => Effect.Effect<ReadonlyArray<Promotion>>
    /** Each component's latest promotion to each environment, ended or not. */
    readonly latestPromotions: Effect.Effect<ReadonlyArray<Promotion>>
    /** Records a promotion that just started, with the actor who started it. */
    readonly startPromotion: (promotion: Promotion, actor: Actor) => Effect.Effect<void>
    /** Records what changed about a promotion: its run, its state, and when it ended. */
    readonly updatePromotion: (promotion: Promotion) => Effect.Effect<void>
    /**
     * Deletes the records of releases, for good, in one transaction: commits and lookups, changes,
     * store builds, deploys, each source's last read, commits' numbers, notes, promotions, and
     * releases to publish on GitHub and their pages. Kept: each component's version line, so its
     * build numbers never go back (a commit numbered again gets the next number), its version
     * policy, and the notes style.
     */
    readonly reset: Effect.Effect<void>
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
        Result: Schema.Struct({
          component: ComponentKey,
          environment: EnvironmentKey,
          release: ReleaseVersion,
          build: BuildJson,
        }),
        execute: (asked) =>
          sql`SELECT component, environment, release, build_json AS "build" FROM releases_store_builds
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
          lastDeployedAt: Schema.Int,
        }),
        execute: (asked) =>
          sql`SELECT component, environment, release, commit_sha AS "commit", deployed_at AS "deployedAt",
              last_deployed_at AS "lastDeployedAt"
            FROM releases_deploys
            ${asked.component === undefined ? sql`` : sql`WHERE component = ${asked.component}`}
            ORDER BY last_deployed_at DESC`,
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
      const encodePromotion = Schema.encodeEffect(PromotionJson)
      const NoteRow = Schema.Struct({ release: ReleaseVersion, locale: NoteLocale, text: NoteText })
      const findNotes = SqlSchema.findAll({
        Request: Schema.Struct({ component: ComponentKey, release: ReleaseVersion }),
        Result: NoteRow,
        execute: (key) =>
          sql`SELECT release, locale, text FROM releases_notes
            WHERE component = ${key.component} AND release = ${key.release} ORDER BY locale`,
      })
      const findRecentNotes = SqlSchema.findAll({
        Request: Schema.Struct({ component: ComponentKey, except: ReleaseVersion, count: Schema.Int }),
        Result: NoteRow,
        execute: (asked) =>
          sql`SELECT release, locale, text FROM releases_notes
            WHERE component = ${asked.component} AND release IN (
              SELECT release FROM releases_notes WHERE component = ${asked.component} AND release <> ${asked.except}
              GROUP BY release ORDER BY MAX(saved_at) DESC LIMIT ${asked.count})
            ORDER BY saved_at DESC, locale`,
      })
      const findToPublish = SqlSchema.findAll({
        Request: Schema.Void,
        Result: Schema.Struct({
          component: ComponentKey,
          release: ReleaseVersion,
          environment: Schema.Union([Schema.Literal(""), EnvironmentKey]),
          reachedAt: Schema.Int,
          marked: Schema.Int,
        }),
        execute: () =>
          sql`SELECT component, release, environment, reached_at AS "reachedAt", marked FROM releases_github_releases
            WHERE pending = 1 ORDER BY reached_at`,
      })
      const findPublished = SqlSchema.findOneOption({
        Request: Schema.Struct({ component: ComponentKey, release: ReleaseVersion }),
        Result: Schema.Struct({ url: Schema.String, publishedAt: Schema.Int }),
        execute: (key) =>
          sql`SELECT url, published_at AS "publishedAt" FROM releases_github_releases
            WHERE component = ${key.component} AND release = ${key.release} AND url IS NOT NULL`,
      })
      const findStyle = SqlSchema.findOneOption({
        Request: Schema.Void,
        Result: Schema.Struct({ style: Schema.String }),
        execute: () => sql`SELECT style FROM releases_notes_style`,
      })
      const findVersionLines = SqlSchema.findAll({
        Request: Schema.Void,
        Result: Schema.Struct({
          component: ComponentKey,
          version: SemanticVersion,
          lastBuild: Schema.Int,
          setAt: Schema.Int,
        }),
        execute: () =>
          sql`SELECT component, version, last_build AS "lastBuild", set_at AS "setAt" FROM releases_versions ORDER BY component`,
      })
      const findNumber = SqlSchema.findOneOption({
        Request: Schema.Struct({ component: ComponentKey, commit: CommitSha }),
        Result: Schema.Struct({
          component: ComponentKey,
          commit: CommitSha,
          release: ReleaseVersion,
          version: SemanticVersion,
          build: Schema.Int,
        }),
        execute: (key) =>
          sql`SELECT component, commit_sha AS "commit", release, version, build FROM releases_numbers
            WHERE component = ${key.component} AND commit_sha = ${key.commit}`,
      })
      const findPolicies = SqlSchema.findAll({
        Request: Schema.Void,
        Result: Schema.Struct({ policy: PolicyJson }),
        execute: () => sql`SELECT policy_json AS "policy" FROM releases_version_policies ORDER BY component`,
      })
      const findPolicy = SqlSchema.findOneOption({
        Request: ComponentKey,
        Result: Schema.Struct({ policy: PolicyJson }),
        execute: (component) =>
          sql`SELECT policy_json AS "policy" FROM releases_version_policies WHERE component = ${component}`,
      })
      const encodePolicy = Schema.encodeEffect(PolicyJson)
      const encodeActor = Schema.encodeEffect(Schema.fromJsonString(Actor))
      const findPromotions = SqlSchema.findAll({
        Request: Schema.Struct({ component: ComponentKey, release: ReleaseVersion }),
        Result: Schema.Struct({ promotion: PromotionJson }),
        execute: (key) =>
          sql`SELECT promotion_json AS "promotion" FROM releases_promotions
            WHERE component = ${key.component} AND release = ${key.release}
            ORDER BY started_at DESC LIMIT ${promotionsListed}`,
      })
      const findLatest = SqlSchema.findAll({
        Request: Schema.Void,
        Result: Schema.Struct({ promotion: PromotionJson }),
        execute: () =>
          sql`SELECT promotion_json AS "promotion" FROM releases_promotions AS promotion
            WHERE started_at = (SELECT MAX(started_at) FROM releases_promotions AS other
              WHERE other.component = promotion.component AND other.environment = promotion.environment)`,
      })
      const findUnended = SqlSchema.findAll({
        Request: Schema.Struct({
          component: Schema.optionalKey(ComponentKey),
          environment: Schema.optionalKey(EnvironmentKey),
        }),
        Result: Schema.Struct({ promotion: PromotionJson }),
        execute: (where) =>
          sql`SELECT promotion_json AS "promotion" FROM releases_promotions WHERE ended = 0
            ${where.component === undefined ? sql`` : sql`AND component = ${where.component}`}
            ${where.environment === undefined ? sql`` : sql`AND environment = ${where.environment}`}
            ORDER BY started_at`,
      })

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
        replaceStoreBuilds: (component, environment, builds) =>
          Effect.gen(function* () {
            yield* sql`DELETE FROM releases_store_builds WHERE component = ${component} AND environment = ${environment}`
            for (const { release, build } of builds) {
              const json = yield* encodeBuild(build)
              yield* sql`INSERT OR REPLACE INTO releases_store_builds ${sql.insert({
                component,
                environment,
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
                lastDeployedAt: DateTime.makeUnsafe(row.lastDeployedAt),
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
            last_deployed_at: DateTime.toEpochMillis(deploy.lastDeployedAt),
          })}
            ON CONFLICT (component, environment, release) DO UPDATE SET last_deployed_at = excluded.last_deployed_at`.pipe(
            Effect.asVoid,
            Effect.orDie,
          ),
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
        versionLines: findVersionLines(undefined).pipe(
          Effect.orDie,
          Effect.map((rows) => rows.map((row): VersionLine => ({ ...row, setAt: DateTime.makeUnsafe(row.setAt) }))),
        ),
        saveVersionLine: (line) =>
          sql`INSERT INTO releases_versions ${sql.insert({
            component: line.component,
            version: line.version,
            last_build: line.lastBuild,
            set_at: DateTime.toEpochMillis(line.setAt),
          })}
            ON CONFLICT (component) DO UPDATE SET version = excluded.version, last_build = excluded.last_build,
              set_at = excluded.set_at`.pipe(Effect.asVoid, Effect.orDie),
        versionPolicies: findPolicies(undefined).pipe(
          Effect.orDie,
          Effect.map((rows) => rows.map((row) => row.policy)),
        ),
        versionPolicy: (component) =>
          findPolicy(component).pipe(Effect.orDie, Effect.map(Option.map((row) => row.policy))),
        saveVersionPolicy: (policy) =>
          Effect.gen(function* () {
            const json = yield* encodePolicy(policy)
            yield* sql`INSERT INTO releases_version_policies ${sql.insert({ component: policy.component, policy_json: json })}
              ON CONFLICT (component) DO UPDATE SET policy_json = excluded.policy_json`
          }).pipe(Effect.orDie),
        removeVersionPolicy: (component) =>
          sql`DELETE FROM releases_version_policies WHERE component = ${component}`.pipe(Effect.asVoid, Effect.orDie),
        numberOf: (component, commit) => findNumber({ component, commit }).pipe(Effect.orDie),
        saveNumber: (numbered, at) =>
          sql`INSERT INTO releases_numbers ${sql.insert({
            component: numbered.component,
            commit_sha: numbered.commit,
            release: numbered.release,
            version: numbered.version,
            build: numbered.build,
            numbered_at: DateTime.toEpochMillis(at),
          })}`.pipe(Effect.asVoid, Effect.orDie),
        notes: (component, release) =>
          findNotes({ component, release }).pipe(
            Effect.orDie,
            Effect.map((rows) => rows.map((row): ReleaseNote => ({ locale: row.locale, text: row.text }))),
          ),
        saveNotes: (component, release, notes, at) =>
          Effect.gen(function* () {
            yield* sql`DELETE FROM releases_notes WHERE component = ${component} AND release = ${release}`
            for (const note of notes) {
              yield* sql`INSERT INTO releases_notes ${sql.insert({
                component,
                release,
                locale: note.locale,
                text: note.text,
                saved_at: DateTime.toEpochMillis(at),
              })}`
            }
          }).pipe(Effect.orDie),
        recentNotes: (component, except, count) =>
          findRecentNotes({ component, except, count }).pipe(
            Effect.orDie,
            Effect.map((rows) => {
              const byRelease = new Map<ReleaseVersion, Array<ReleaseNote>>()
              for (const row of rows) {
                byRelease.set(row.release, [
                  ...(byRelease.get(row.release) ?? []),
                  { locale: row.locale, text: row.text },
                ])
              }
              return Array.from(byRelease, ([release, notes]) => ({ release, notes }))
            }),
          ),
        notesStyle: findStyle(undefined).pipe(Effect.orDie, Effect.map(Option.map((row) => row.style))),
        saveNotesStyle: (style) =>
          sql`INSERT INTO releases_notes_style ${sql.insert({ only: 1, style })}
            ON CONFLICT (only) DO UPDATE SET style = excluded.style`.pipe(Effect.asVoid, Effect.orDie),
        queueGitHubRelease: (release) =>
          sql`INSERT INTO releases_github_releases ${sql.insert({
            component: release.component,
            release: release.release,
            environment: release.environment ?? "",
            reached_at: DateTime.toEpochMillis(release.reachedAt),
            pending: 1,
            marked: 1,
          })}
            ON CONFLICT (component, release) DO UPDATE SET environment = excluded.environment,
              reached_at = excluded.reached_at, pending = 1, marked = marked + 1`.pipe(Effect.asVoid, Effect.orDie),
        requeueGitHubRelease: (component, release) =>
          sql`UPDATE releases_github_releases SET pending = 1, marked = marked + 1
            WHERE component = ${component} AND release = ${release}`.pipe(Effect.asVoid, Effect.orDie),
        gitHubReleasesToPublish: findToPublish(undefined).pipe(
          Effect.orDie,
          Effect.map((rows) =>
            rows.map((row): ReleaseToPublish => ({
              component: row.component,
              release: row.release,
              environment: row.environment === "" ? undefined : row.environment,
              reachedAt: DateTime.makeUnsafe(row.reachedAt),
              marked: row.marked,
            })),
          ),
        ),
        // Marked again while it was being published, as by notes saved then, it stays to publish.
        saveGitHubRelease: (published, page) =>
          sql`UPDATE releases_github_releases SET url = ${page.url},
              published_at = ${DateTime.toEpochMillis(page.publishedAt)},
              pending = CASE WHEN marked = ${published.marked} THEN 0 ELSE pending END
            WHERE component = ${published.component} AND release = ${published.release}`.pipe(
            Effect.asVoid,
            Effect.orDie,
          ),
        gitHubRelease: (component, release) =>
          findPublished({ component, release }).pipe(
            Effect.orDie,
            Effect.map(
              Option.map((row): PublishedRelease => ({
                url: row.url,
                publishedAt: DateTime.makeUnsafe(row.publishedAt),
              })),
            ),
          ),
        promotions: (component, release) =>
          findPromotions({ component, release }).pipe(
            Effect.orDie,
            Effect.map((rows) => rows.map((row) => row.promotion)),
          ),
        latestPromotions: findLatest(undefined).pipe(
          Effect.orDie,
          Effect.map((rows) => rows.map((row) => row.promotion)),
        ),
        unendedPromotions: (where) =>
          findUnended(where ?? {}).pipe(
            Effect.orDie,
            Effect.map((rows) => rows.map((row) => row.promotion)),
          ),
        startPromotion: (promotion, actor) =>
          Effect.gen(function* () {
            const json = yield* encodePromotion(promotion)
            const actorJson = yield* encodeActor(actor)
            yield* sql`INSERT INTO releases_promotions ${sql.insert({
              id: promotion.id,
              component: promotion.component,
              environment: promotion.environment,
              release: promotion.release,
              started_at: DateTime.toEpochMillis(promotion.startedAt),
              ended: hasEnded(promotion.state) ? 1 : 0,
              actor: actorJson,
              promotion_json: json,
            })}`
          }).pipe(Effect.orDie),
        updatePromotion: (promotion) =>
          Effect.gen(function* () {
            const json = yield* encodePromotion(promotion)
            yield* sql`UPDATE releases_promotions SET ended = ${hasEnded(promotion.state) ? 1 : 0},
              promotion_json = ${json} WHERE id = ${promotion.id}`
          }).pipe(Effect.orDie),
        reset: sql
          .withTransaction(Effect.forEach(resetTables, (table) => sql`DELETE FROM ${sql(table)}`, { discard: true }))
          .pipe(Effect.orDie, Effect.withSpan("ReleaseRecords.reset")),
      })
    }),
  )
}
