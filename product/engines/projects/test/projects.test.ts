import type { Actor } from "@cluenori/foundation"
import { ActivityLog, ComponentKey, EnvironmentKey, MemberId, ProjectKey } from "@cluenori/foundation"
import { Repository, WorkflowFile } from "@cluenori/github"
import { assert, describe, it } from "@effect/vitest"
import { DateTime, Effect, Redacted, Schema } from "effect"
import { SqlClient } from "effect/sql"
import { TestClock } from "effect/testing"

import {
  BundleId,
  ComponentExists,
  ComponentLinks,
  ComponentName,
  ComponentNotFound,
  defaultProjectSettings,
  IngestKey,
  IngestKeyId,
  IngestKeyName,
  IngestKeyNotFound,
  IngestKeyRefused,
  IngestKeyRejected,
  isProduction,
  ProjectExists,
  ProjectName,
  ProjectNotFound,
  Projects,
  SdkKey,
  SdkKeyNotFound,
  TooManySdkKeys,
} from "../src/index.ts"
import { inProject } from "./in-object.ts"

const owner: Actor = { _tag: "Member", id: MemberId.make("0199f7a2-5c1e-7d3a-9b2f-4e8a1c6d0f53") }
const notesApi = { key: ComponentKey.make("notes-api"), name: ComponentName.make("Notes API") }

const createWithApi = Effect.gen(function* () {
  const projects = yield* Projects
  yield* projects.create(owner, ProjectName.make("Notes"))
  return yield* projects.addComponent(owner, notesApi)
})

// The same SDK key's ID under another project's or component's name.
const renamed = (key: SdkKey, from: string, to: string) => SdkKey.make(key.replace(from, to))

const hour = 3_600_000
const day = 24 * hour
// A time on the hour, so the hours a test moves through are whole: 2026-10-20 12:00 UTC.
const noon = 1_792_670_400_000
const at = (millis: number) => DateTime.makeUnsafe(millis)
const named = (name: string) => IngestKeyName.make(name)

// Runs `program` in project `project` on a test clock set to `start`.
const inProjectAt = <A, E>(
  project: string,
  start: number,
  program: Effect.Effect<A, E, Projects | ActivityLog | SqlClient.SqlClient>,
) => inProject(project, TestClock.setTime(start).pipe(Effect.andThen(program), Effect.provide(TestClock.layer())))

const activityNames = Effect.gen(function* () {
  const log = yield* ActivityLog
  return (yield* log.latest).map((entry) => entry.name)
})

// Changes one character of the secret, keeping the key's form.
const tampered = (key: IngestKey) => IngestKey.make(`${key.slice(0, -1)}${key.endsWith("A") ? "B" : "A"}`)

describe("Projects", () => {
  it.effect("creates the project once, with project.created", () =>
    inProject(
      "creates-once",
      Effect.gen(function* () {
        const projects = yield* Projects
        const created = yield* projects.create(owner, ProjectName.make("Notes"))
        const again = yield* projects.create(owner, ProjectName.make("Notes again")).pipe(Effect.flip)
        const log = yield* ActivityLog
        const activity = yield* log.latest

        assert.strictEqual(created.key, "creates-once")
        assert.deepStrictEqual(again, new ProjectExists({ project: created.key }))
        assert.strictEqual(activity.length, 1)
        assert.strictEqual(activity[0]?.name, "project.created")
        assert.deepStrictEqual(activity[0]?.attrs, { project: "creates-once", name: "Notes" })
      }),
    ),
  )

  it.effect("adds a component with an ingest key that names it, shown only once", () =>
    inProject(
      "adds-component",
      Effect.gen(function* () {
        const added = yield* createWithApi
        const projects = yield* Projects
        const components = yield* projects.components
        const log = yield* ActivityLog
        const [componentAdded] = yield* log.latest

        assert.match(Redacted.value(added.ingestKey), /^cluenori\.adds-component\.notes-api\.[A-Za-z0-9_-]{43}$/)
        assert.deepStrictEqual(
          components.map((component) => component.key),
          ["notes-api"],
        )
        assert.strictEqual(componentAdded?.name, "component.added")
        assert.strictEqual(componentAdded?.component, "notes-api")
      }),
    ),
  )

  it.effect(
    "links a component to its repository and deploy targets, with component.linked, and unlinks one left out",
    () =>
      inProject(
        "links",
        Effect.gen(function* () {
          yield* createWithApi
          const projects = yield* Projects
          const targets = [
            { environment: EnvironmentKey.make("dev"), workflow: WorkflowFile.make("deploy.yml") },
            {
              environment: EnvironmentKey.make("production"),
              workflow: WorkflowFile.make("ios.yml"),
              appStore: { bundleId: BundleId.make("com.example.notes"), distribution: "appStore" as const },
            },
          ]
          const linked = yield* projects.linkComponent(owner, notesApi.key, {
            repository: Repository.make("notes/notes-api"),
            deployTargets: targets,
          })
          const [deploying] = yield* projects.components
          const unlinked = yield* projects.linkComponent(owner, notesApi.key, {
            repository: Repository.make("notes/notes-api"),
          })
          const [component] = yield* projects.components
          const missing = yield* projects.linkComponent(owner, ComponentKey.make("notes-web"), {}).pipe(Effect.flip)
          const log = yield* ActivityLog
          const [latest] = yield* log.latest

          assert.deepInclude(linked, { repository: Repository.make("notes/notes-api"), deployTargets: targets })
          assert.deepStrictEqual(deploying?.deployTargets, targets)
          assert.isUndefined(unlinked.deployTargets)
          assert.strictEqual(component?.repository, "notes/notes-api")
          assert.isUndefined(component?.deployTargets)
          assert.deepStrictEqual(missing, new ComponentNotFound({ component: ComponentKey.make("notes-web") }))
          assert.strictEqual(latest?.name, "component.linked")
          assert.deepStrictEqual(latest?.attrs, { component: "notes-api", repository: "notes/notes-api" })
        }),
      ),
  )

  it.effect("refuses a deploy target with neither a workflow nor an App Store app, and two for one environment", () =>
    Effect.sync(() => {
      const decode = Schema.decodeUnknownResult(ComponentLinks)
      const empty = decode({ deployTargets: [{ environment: "dev" }] })
      const twice = decode({
        deployTargets: [
          { environment: "dev", workflow: "deploy.yml" },
          { environment: "dev", workflow: "other.yml" },
        ],
      })
      assert.isTrue(empty._tag === "Failure")
      assert.isTrue(twice._tag === "Failure")
    }),
  )

  it.effect("links a component that ships with another, and refuses one the project lacks or itself", () =>
    inProject(
      "ships-with",
      Effect.gen(function* () {
        const projects = yield* Projects
        yield* createWithApi
        const worker = ComponentKey.make("notes-worker")
        yield* projects.addComponent(owner, { key: worker, name: ComponentName.make("Notes worker") })
        const linked = yield* projects.linkComponent(owner, worker, { shipsWith: notesApi.key })
        const missing = yield* projects
          .linkComponent(owner, worker, { shipsWith: ComponentKey.make("notes-web") })
          .pipe(Effect.flip)
        const itself = yield* projects.linkComponent(owner, worker, { shipsWith: worker }).pipe(Effect.flip)
        const components = yield* projects.components

        assert.strictEqual(linked.shipsWith, notesApi.key)
        assert.deepInclude(missing, { _tag: "ComponentNotFound", component: ComponentKey.make("notes-web") })
        assert.deepInclude(itself, { _tag: "ComponentNotFound", component: worker })
        assert.strictEqual(components.find((component) => component.key === worker)?.shipsWith, notesApi.key)
      }),
    ),
  )

  it.effect("calls prod, production and live production until the project chooses, with project.settings_changed", () =>
    inProject(
      "settings",
      Effect.gen(function* () {
        const projects = yield* Projects
        const before = yield* projects.settings.pipe(Effect.flip)
        yield* projects.create(owner, ProjectName.make("Notes"))
        const defaults = yield* projects.settings
        const chosen = { productionEnvironments: [EnvironmentKey.make("prod"), EnvironmentKey.make("staging")] }
        yield* projects.updateSettings(owner, chosen)
        const after = yield* projects.settings
        const log = yield* ActivityLog
        const [latest] = yield* log.latest

        assert.deepStrictEqual(before, new ProjectNotFound({ project: ProjectKey.make("settings") }))
        assert.deepStrictEqual(defaults, defaultProjectSettings)
        assert.deepStrictEqual(after, chosen)
        assert.isTrue(isProduction(after, EnvironmentKey.make("staging")))
        assert.isFalse(isProduction(after, EnvironmentKey.make("dev")))
        assert.isTrue(isProduction(after, undefined))
        assert.strictEqual(latest?.name, "project.settings_changed")
      }),
    ),
  )

  it.effect("turns an App Store app linked before deploy targets into production's target", () =>
    Effect.gen(function* () {
      // A database from before: the app's bundle ID in its old column, and migration 4 not yet run.
      yield* inProject(
        "app-store-before",
        Effect.gen(function* () {
          yield* createWithApi
          const sql = yield* SqlClient.SqlClient
          yield* sql`UPDATE projects_components SET app_store_bundle_id = 'com.example.notes', deploy_targets = NULL`
          yield* sql`ALTER TABLE projects_components DROP COLUMN deploy_targets`
          yield* sql`ALTER TABLE projects_components DROP COLUMN ships_with`
          yield* sql`DROP TABLE projects_sdk_keys`
          yield* sql`ALTER TABLE projects_components ADD COLUMN ingest_key_digest TEXT NOT NULL DEFAULT ''`
          yield* sql`DROP TABLE projects_ingest_keys`
          yield* sql`DELETE FROM projects_migrations WHERE migration_id >= 4`
        }),
      )
      const [component] = yield* inProject(
        "app-store-before",
        Effect.gen(function* () {
          const projects = yield* Projects
          return yield* projects.components
        }),
      )

      assert.deepStrictEqual(component?.deployTargets, [
        {
          environment: EnvironmentKey.make("production"),
          appStore: { bundleId: BundleId.make("com.example.notes"), distribution: "appStore" },
        },
      ])
    }),
  )

  it.effect("keeps no ingest key anywhere in the project's database", () =>
    inProject(
      "keeps-no-key",
      Effect.gen(function* () {
        const added = yield* createWithApi
        const projects = yield* Projects
        const another = yield* projects.addIngestKey(owner, notesApi.key, { name: IngestKeyName.make("ci") })
        const secrets = [added.ingestKey, another.ingestKey].map((key) => Redacted.value(key).split(".")[3] ?? "")
        const sql = yield* SqlClient.SqlClient
        // Every table but the platform's own, which a Durable Object may not read.
        const tables = yield* sql<{
          readonly name: string
        }>`SELECT name FROM sqlite_master WHERE type = 'table' AND substr(name, 1, 4) <> '_cf_'`
        const everything = yield* Effect.forEach(tables, (table) => sql.unsafe(`SELECT * FROM "${table.name}"`))
        const stored = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(everything)

        for (const secret of secrets) {
          assert.strictEqual(secret.length, 43)
          assert.notInclude(stored, secret)
        }
      }),
    ),
  )

  it.effect("refuses a second component with the same key, and stores nothing", () =>
    inProject(
      "same-component",
      Effect.gen(function* () {
        yield* createWithApi
        const projects = yield* Projects
        const again = yield* projects.addComponent(owner, notesApi).pipe(Effect.flip)
        const log = yield* ActivityLog
        const activity = yield* log.latest

        assert.deepStrictEqual(again, new ComponentExists({ component: notesApi.key }))
        assert.strictEqual(activity.length, 2)
      }),
    ),
  )

  it.effect("adds no component to a project that doesn't exist", () =>
    inProject(
      "no-project",
      Effect.gen(function* () {
        const projects = yield* Projects
        const failure = yield* projects.addComponent(owner, notesApi).pipe(Effect.flip)
        assert.deepStrictEqual(failure, new ProjectNotFound({ project: ProjectKey.make("no-project") }))
      }),
    ),
  )

  it.effect("tells which component an ingest key belongs to, and refuses every other key alike", () =>
    inProject(
      "authenticates",
      Effect.gen(function* () {
        const added = yield* createWithApi
        const projects = yield* Projects
        const key = Redacted.value(added.ingestKey)
        const component = yield* projects.authenticate(added.ingestKey)
        const others = [
          tampered(key),
          IngestKey.make(key.replace("cluenori.authenticates.", "cluenori.other-project.")),
          IngestKey.make(key.replace(".notes-api.", ".notes-ios.")),
        ]
        const refusals = yield* Effect.forEach(others, (other) =>
          projects.authenticate(Redacted.make(other)).pipe(Effect.flip),
        )

        assert.strictEqual(component, "notes-api")
        assert.deepStrictEqual(refusals, [new IngestKeyRejected(), new IngestKeyRejected(), new IngestKeyRejected()])
      }),
    ),
  )

  it.effect("keeps a component's keys working side by side until one is revoked, now or later", () =>
    inProjectAt(
      "keys-overlap",
      noon,
      Effect.gen(function* () {
        const added = yield* createWithApi
        const projects = yield* Projects
        const blue = yield* projects.addIngestKey(owner, notesApi.key, { name: named("blue") })
        // Both work: a deploy can move to the new key with no gap.
        assert.strictEqual(yield* projects.authenticate(added.ingestKey), "notes-api")
        assert.strictEqual(yield* projects.authenticate(blue.ingestKey), "notes-api")
        const listed = yield* projects.ingestKeys(notesApi.key)
        assert.deepStrictEqual(
          listed.keys.map((key) => key.name),
          ["blue", "first"],
        )
        const first = listed.keys[1]?.id ?? IngestKeyId.make("00000000-0000-7000-8000-000000000000")

        // Revoked in 24 hours: it works until then, and not a millisecond after.
        const scheduled = yield* projects.revokeIngestKey(owner, notesApi.key, first, at(noon + day))
        assert.strictEqual(DateTime.toEpochMillis(scheduled.revokedAt ?? at(0)), noon + day)
        // A later revocation changes nothing; it only moves earlier.
        const later = yield* projects.revokeIngestKey(owner, notesApi.key, first, at(noon + 2 * day))
        assert.strictEqual(DateTime.toEpochMillis(later.revokedAt ?? at(0)), noon + day)
        yield* TestClock.setTime(noon + day - 1)
        assert.strictEqual(yield* projects.authenticate(added.ingestKey), "notes-api")
        yield* TestClock.setTime(noon + day)
        assert.deepStrictEqual(yield* projects.authenticate(added.ingestKey).pipe(Effect.flip), new IngestKeyRejected())
        assert.strictEqual(yield* projects.authenticate(blue.ingestKey), "notes-api")
        // Revoked at once, the other stops too; revoking an ended key says nothing new.
        yield* projects.revokeIngestKey(owner, notesApi.key, blue.key.id, undefined)
        yield* projects.revokeIngestKey(owner, notesApi.key, blue.key.id, undefined)
        assert.deepStrictEqual(yield* projects.authenticate(blue.ingestKey).pipe(Effect.flip), new IngestKeyRejected())
        // Newest first.
        assert.deepStrictEqual(yield* activityNames, [
          "ingest_key.revoked",
          "ingest_key.revoked",
          "ingest_key.added",
          "component.added",
          "project.created",
        ])
        // A key of another component, or none, isn't found.
        const missing = IngestKeyId.make("0199f7a2-5c1e-7d3a-9b2f-4e8a1c6d0f54")
        assert.deepStrictEqual(
          yield* projects.revokeIngestKey(owner, notesApi.key, missing, undefined).pipe(Effect.flip),
          new IngestKeyNotFound({ key: missing }),
        )
      }),
    ),
  )

  it.effect("keeps when a key was last used by the hour, writing it once an hour", () =>
    inProjectAt(
      "keys-last-used",
      noon,
      Effect.gen(function* () {
        const added = yield* createWithApi
        const projects = yield* Projects
        const lastUsed = projects
          .ingestKeys(notesApi.key)
          .pipe(Effect.map(({ keys }) => keys.map((key) => key.lastUsedAt && DateTime.toEpochMillis(key.lastUsedAt))))
        assert.deepStrictEqual(yield* lastUsed, [undefined])
        yield* TestClock.setTime(noon + 20 * 60_000)
        yield* projects.authenticate(added.ingestKey)
        yield* TestClock.setTime(noon + 59 * 60_000)
        yield* projects.authenticate(added.ingestKey)
        assert.deepStrictEqual(yield* lastUsed, [noon])
        yield* TestClock.setTime(noon + 2 * hour + 1)
        yield* projects.authenticate(added.ingestKey)
        assert.deepStrictEqual(yield* lastUsed, [noon + 2 * hour])
      }),
    ),
  )

  it.effect("warns a week and a day before a key expires, once each, then refuses it, and forgets it 30 days on", () =>
    inProjectAt(
      "keys-expire",
      noon,
      Effect.gen(function* () {
        yield* createWithApi
        const projects = yield* Projects
        const ci = yield* projects.addIngestKey(owner, notesApi.key, {
          name: named("ci"),
          expiresAt: at(noon + 10 * day),
        })
        // Revoked before it would expire: never warned of.
        const old = yield* projects.addIngestKey(owner, notesApi.key, {
          name: named("old"),
          expiresAt: at(noon + 8 * day),
        })
        yield* projects.revokeIngestKey(owner, notesApi.key, old.key.id, at(noon + 7 * day))
        const log = yield* ActivityLog
        const warnings = log.latest.pipe(
          Effect.map((entries) =>
            entries.filter((entry) => entry.name === "ingest_key.expiring").map((entry) => entry.attrs),
          ),
        )
        const checkAt = (millis: number) => TestClock.setTime(millis).pipe(Effect.andThen(projects.checkIngestKeys))
        yield* checkAt(noon)
        yield* checkAt(noon + 3 * day - 1)
        assert.deepStrictEqual(yield* warnings, [])
        yield* checkAt(noon + 3 * day)
        yield* checkAt(noon + 3 * day + hour)
        yield* checkAt(noon + 9 * day - 1)
        const ciWarning = {
          component: "notes-api",
          key: ci.key.id,
          name: "ci",
          expiresAt: DateTime.formatIso(at(noon + 10 * day)),
        }
        assert.deepStrictEqual(yield* warnings, [ciWarning])
        yield* checkAt(noon + 9 * day)
        yield* checkAt(noon + 9 * day + hour)
        assert.deepStrictEqual(yield* warnings, [ciWarning, ciWarning])
        // A key made with less than a day left hears only the day's warning.
        yield* projects.addIngestKey(owner, notesApi.key, {
          name: named("short"),
          expiresAt: at(noon + 9 * day + 12 * hour),
        })
        yield* checkAt(noon + 9 * day + 2 * hour)
        yield* checkAt(noon + 9 * day + 3 * hour)
        assert.deepStrictEqual(
          (yield* warnings).map((each) => each["name"]),
          ["short", "ci", "ci"],
        )
        yield* TestClock.setTime(noon + 10 * day)
        assert.deepStrictEqual(yield* projects.authenticate(ci.ingestKey).pipe(Effect.flip), new IngestKeyRejected())
        // Listed 30 days after it ended, then forgotten; the key that never expires stays.
        yield* checkAt(noon + 40 * day - 1)
        assert.deepStrictEqual(
          (yield* projects.ingestKeys(notesApi.key)).keys.map((key) => key.name),
          ["ci", "first"],
        )
        yield* checkAt(noon + 40 * day + 1)
        assert.deepStrictEqual(
          (yield* projects.ingestKeys(notesApi.key)).keys.map((key) => key.name),
          ["first"],
        )
      }),
    ),
  )

  it.effect("refuses an eleventh working key and one that would expire at once", () =>
    inProjectAt(
      "keys-bound",
      noon,
      Effect.gen(function* () {
        yield* createWithApi
        const projects = yield* Projects
        const past = yield* projects
          .addIngestKey(owner, notesApi.key, { name: named("late"), expiresAt: at(noon) })
          .pipe(Effect.flip)
        assert.deepStrictEqual(past, new IngestKeyRefused({ reason: "expiryPast" }))
        const nine = yield* Effect.forEach(
          Array.from({ length: 9 }, (_, index) => index),
          (index) => projects.addIngestKey(owner, notesApi.key, { name: named(`key-${index}`) }),
        )
        const tooMany = yield* projects.addIngestKey(owner, notesApi.key, { name: named("more") }).pipe(Effect.flip)
        assert.deepStrictEqual(tooMany, new IngestKeyRefused({ reason: "tooMany" }))
        // One that ended no longer counts: an owner can always make room.
        yield* projects.revokeIngestKey(
          owner,
          notesApi.key,
          nine[0]?.key.id ?? IngestKeyId.make("0199f7a2-5c1e-7d3a-9b2f-4e8a1c6d0f54"),
          undefined,
        )
        const room = yield* projects.addIngestKey(owner, notesApi.key, { name: named("more") })
        assert.strictEqual(yield* projects.authenticate(room.ingestKey), "notes-api")
      }),
    ),
  )

  it.effect("turns each component's one key from before into its key first, made in the same millisecond too", () =>
    Effect.gen(function* () {
      // A database from before: the key's digest in its old column, and migration 7 not yet run.
      const added = yield* inProject(
        "key-before",
        Effect.gen(function* () {
          const made = yield* createWithApi
          const projects = yield* Projects
          const worker = yield* projects.addComponent(owner, {
            key: ComponentKey.make("notes-worker"),
            name: ComponentName.make("Notes worker"),
          })
          const sql = yield* SqlClient.SqlClient
          // Both components made in the same millisecond, as an import could make them.
          yield* sql`UPDATE projects_components SET created_at = (SELECT created_at FROM projects_components WHERE key = 'notes-api')`
          yield* sql`ALTER TABLE projects_components ADD COLUMN ingest_key_digest TEXT NOT NULL DEFAULT ''`
          yield* sql`UPDATE projects_components SET ingest_key_digest =
            (SELECT digest FROM projects_ingest_keys WHERE projects_ingest_keys.component = projects_components.key)`
          yield* sql`DROP TABLE projects_ingest_keys`
          yield* sql`DELETE FROM projects_migrations WHERE migration_id >= 7`
          return { ...made, worker }
        }),
      )
      const { component, workerComponent, keys } = yield* inProject(
        "key-before",
        Effect.gen(function* () {
          const projects = yield* Projects
          return {
            component: yield* projects.authenticate(added.ingestKey),
            workerComponent: yield* projects.authenticate(added.worker.ingestKey),
            keys: (yield* projects.ingestKeys(notesApi.key)).keys,
          }
        }),
      )
      assert.strictEqual(component, "notes-api")
      assert.strictEqual(workerComponent, "notes-worker")
      assert.deepStrictEqual(
        keys.map((key) => [key.name, key.expiresAt, key.revokedAt, Schema.is(IngestKeyId)(key.id)]),
        [["first", undefined, undefined, true]],
      )
      // Its ID's time is the component's creation.
      const idMillis = Number.parseInt((keys[0]?.id ?? "").replace("-", "").slice(0, 12), 16)
      assert.strictEqual(idMillis, DateTime.toEpochMillis(added.component.createdAt))
    }),
  )

  it.effect("issues SDK keys that each authenticate to their component, listed newest first, with sdk_key.issued", () =>
    inProject(
      "sdk-keys-issued",
      Effect.gen(function* () {
        yield* createWithApi
        const projects = yield* Projects
        const first = yield* projects.issueSdkKey(owner, notesApi.key)
        const second = yield* projects.issueSdkKey(owner, notesApi.key)
        const firstComponent = yield* projects.authenticateSdkKey(first.key)
        const secondComponent = yield* projects.authenticateSdkKey(second.key)
        const list = yield* projects.sdkKeys(notesApi.key)
        const log = yield* ActivityLog
        const [latest, before] = yield* log.latest

        assert.match(first.key, /^cluenori-sdk\.sdk-keys-issued\.notes-api\.[A-Za-z0-9_-]{22}$/)
        assert.notStrictEqual(first.key, second.key)
        assert.strictEqual(firstComponent, notesApi.key)
        assert.strictEqual(secondComponent, notesApi.key)
        assert.deepStrictEqual(list, { keys: [second, first] })
        assert.isUndefined(first.revokedAt)
        assert.strictEqual(latest?.name, "sdk_key.issued")
        assert.strictEqual(latest?.component, "notes-api")
        assert.deepStrictEqual(latest?.attrs, { component: "notes-api", key: second.key })
        assert.strictEqual(before?.name, "sdk_key.issued")
        assert.deepStrictEqual(before?.attrs, { component: "notes-api", key: first.key })
      }),
    ),
  )

  it.effect(
    "revokes an SDK key, which then fails to authenticate while the other still does, with sdk_key.revoked",
    () =>
      inProject(
        "sdk-keys-revoked",
        Effect.gen(function* () {
          yield* createWithApi
          const projects = yield* Projects
          const old = yield* projects.issueSdkKey(owner, notesApi.key)
          const current = yield* projects.issueSdkKey(owner, notesApi.key)
          const revoked = yield* projects.revokeSdkKey(owner, notesApi.key, old.key)
          const refused = yield* projects.authenticateSdkKey(old.key).pipe(Effect.flip)
          const stillActive = yield* projects.authenticateSdkKey(current.key)
          const log = yield* ActivityLog
          const afterRevoke = yield* log.latest
          const again = yield* projects.revokeSdkKey(owner, notesApi.key, old.key)
          const afterAgain = yield* log.latest
          const list = yield* projects.sdkKeys(notesApi.key)

          assert.isDefined(revoked.revokedAt)
          assert.deepStrictEqual(refused, new SdkKeyNotFound({ key: old.key }))
          assert.strictEqual(stillActive, notesApi.key)
          assert.strictEqual(afterRevoke[0]?.name, "sdk_key.revoked")
          assert.strictEqual(afterRevoke[0]?.component, "notes-api")
          assert.deepStrictEqual(afterRevoke[0]?.attrs, { component: "notes-api", key: old.key })
          assert.deepStrictEqual(again, revoked)
          assert.strictEqual(afterAgain.length, afterRevoke.length)
          assert.deepStrictEqual(list, { keys: [current, revoked] })
        }),
      ),
  )

  it.effect("refuses a 21st active SDK key, and issues one again once a key is revoked", () =>
    inProject(
      "sdk-keys-bound",
      Effect.gen(function* () {
        yield* createWithApi
        const projects = yield* Projects
        const twenty = yield* Effect.forEach(Array.from({ length: 20 }), () =>
          projects.issueSdkKey(owner, notesApi.key),
        )
        const tooMany = yield* projects.issueSdkKey(owner, notesApi.key).pipe(Effect.flip)
        assert.deepStrictEqual(tooMany, new TooManySdkKeys({ component: notesApi.key }))
        const [oldest] = twenty
        assert.isDefined(oldest)
        yield* projects.revokeSdkKey(owner, notesApi.key, oldest.key)
        const again = yield* projects.issueSdkKey(owner, notesApi.key)
        assert.strictEqual(yield* projects.authenticateSdkKey(again.key), notesApi.key)
      }),
    ),
  )

  it.effect("refuses an SDK key that is unknown, another project's, or for a component the project lacks, alike", () =>
    inProject(
      "sdk-keys-refused",
      Effect.gen(function* () {
        yield* createWithApi
        const projects = yield* Projects
        const issued = yield* projects.issueSdkKey(owner, notesApi.key)
        const others = [
          SdkKey.make("cluenori-sdk.sdk-keys-refused.notes-api.AAAAAAAAAAAAAAAAAAAAAA"),
          renamed(issued.key, ".sdk-keys-refused.", ".other-project."),
          renamed(issued.key, ".notes-api.", ".notes-ios."),
        ]
        const refusals = yield* Effect.forEach(others, (other) => projects.authenticateSdkKey(other).pipe(Effect.flip))

        assert.deepStrictEqual(
          refusals,
          others.map((key) => new SdkKeyNotFound({ key })),
        )
      }),
    ),
  )

  it.effect(
    "issues and lists no SDK keys for a component the project lacks, and revokes only the component's own",
    () =>
      inProject(
        "sdk-keys-missing",
        Effect.gen(function* () {
          yield* createWithApi
          const projects = yield* Projects
          const notesIos = ComponentKey.make("notes-ios")
          const issueMissing = yield* projects.issueSdkKey(owner, notesIos).pipe(Effect.flip)
          const listMissing = yield* projects.sdkKeys(notesIos).pipe(Effect.flip)
          const issued = yield* projects.issueSdkKey(owner, notesApi.key)
          const revokeElsewhere = yield* projects.revokeSdkKey(owner, notesIos, issued.key).pipe(Effect.flip)
          const stillActive = yield* projects.authenticateSdkKey(issued.key)

          assert.deepStrictEqual(issueMissing, new ComponentNotFound({ component: notesIos }))
          assert.deepStrictEqual(listMissing, new ComponentNotFound({ component: notesIos }))
          assert.deepStrictEqual(revokeElsewhere, new SdkKeyNotFound({ key: issued.key }))
          assert.strictEqual(stillActive, notesApi.key)
        }),
      ),
  )

  it.effect("issues no SDK key in a project that doesn't exist", () =>
    inProject(
      "sdk-keys-no-project",
      Effect.gen(function* () {
        const projects = yield* Projects
        const failure = yield* projects.issueSdkKey(owner, notesApi.key).pipe(Effect.flip)
        assert.deepStrictEqual(failure, new ProjectNotFound({ project: ProjectKey.make("sdk-keys-no-project") }))
      }),
    ),
  )
})
