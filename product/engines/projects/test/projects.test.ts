import { Repository } from "@bagatka/github"
import type { Actor } from "@cluenori/foundation"
import { ActivityLog, ComponentKey, EnvironmentKey, MemberId, ProjectKey } from "@cluenori/foundation"
import { assert, describe, it } from "@effect/vitest"
import { Effect, Redacted, Schema } from "effect"
import { SqlClient } from "effect/sql"

import {
  BundleId,
  ComponentExists,
  ComponentName,
  ComponentNotFound,
  defaultProjectSettings,
  IngestKey,
  IngestKeyRejected,
  isProduction,
  ProjectExists,
  ProjectName,
  ProjectNotFound,
  Projects,
} from "../src/index.ts"
import { inProject } from "./in-object.ts"

const owner: Actor = { _tag: "Member", id: MemberId.make("0199f7a2-5c1e-7d3a-9b2f-4e8a1c6d0f53") }
const notesApi = { key: ComponentKey.make("notes-api"), name: ComponentName.make("Notes API") }

const createWithApi = Effect.gen(function* () {
  const projects = yield* Projects
  yield* projects.create(owner, ProjectName.make("Notes"))
  return yield* projects.addComponent(owner, notesApi)
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
    "links a component to its repository and App Store app, with component.linked, and unlinks one left out",
    () =>
      inProject(
        "links",
        Effect.gen(function* () {
          yield* createWithApi
          const projects = yield* Projects
          const linked = yield* projects.linkComponent(owner, notesApi.key, {
            repository: Repository.make("notes/notes-api"),
            appStoreBundleId: BundleId.make("com.example.notes"),
          })
          const unlinked = yield* projects.linkComponent(owner, notesApi.key, {
            repository: Repository.make("notes/notes-api"),
          })
          const [component] = yield* projects.components
          const missing = yield* projects.linkComponent(owner, ComponentKey.make("notes-web"), {}).pipe(Effect.flip)
          const log = yield* ActivityLog
          const [latest] = yield* log.latest

          assert.deepInclude(linked, {
            repository: Repository.make("notes/notes-api"),
            appStoreBundleId: BundleId.make("com.example.notes"),
          })
          assert.isUndefined(unlinked.appStoreBundleId)
          assert.strictEqual(component?.repository, "notes/notes-api")
          assert.isUndefined(component?.appStoreBundleId)
          assert.deepStrictEqual(missing, new ComponentNotFound({ component: ComponentKey.make("notes-web") }))
          assert.strictEqual(latest?.name, "component.linked")
          assert.deepStrictEqual(latest?.attrs, { component: "notes-api", repository: "notes/notes-api" })
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

  it.effect("keeps no ingest key anywhere in the project's database", () =>
    inProject(
      "keeps-no-key",
      Effect.gen(function* () {
        const added = yield* createWithApi
        const secret = Redacted.value(added.ingestKey).split(".")[3] ?? ""
        const sql = yield* SqlClient.SqlClient
        // Every table but the platform's own, which a Durable Object may not read.
        const tables = yield* sql<{
          readonly name: string
        }>`SELECT name FROM sqlite_master WHERE type = 'table' AND substr(name, 1, 4) <> '_cf_'`
        const everything = yield* Effect.forEach(tables, (table) => sql.unsafe(`SELECT * FROM "${table.name}"`))
        const stored = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(everything)

        assert.isAbove(secret.length, 0)
        assert.notInclude(stored, secret)
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
})
