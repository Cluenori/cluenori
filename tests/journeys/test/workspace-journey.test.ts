import { Actor, ComponentKey, MemberId, ProjectKey } from "@cluenori/foundation"
import { ComponentName, ProjectExists, ProjectName, ProjectNotFound } from "@cluenori/projects"
import { assert, layer } from "@effect/vitest"
import { env } from "cloudflare:workers"
import { Effect, Schema } from "effect"

import { CluenoriClient } from "./cluenori-client.ts"

const owner = "0199f7a2-5c1e-7d3a-9b2f-4e8a1c6d0f53"

// What the Worker sends a project's object to create it, as the object reads it: JSON text.
const createInObject = Schema.encodeEffect(Schema.fromJsonString(Schema.Struct({ actor: Actor, name: ProjectName })))

layer(CluenoriClient.layer, { excludeTestServices: true })("workspace", (it) => {
  it.effect("lists the workspace's projects, and shows one with its components", () =>
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      const notes = ProjectKey.make("listed-notes")
      const folio = ProjectKey.make("listed-folio")
      yield* client.projects.createProject({ payload: { key: notes, name: ProjectName.make("Notes") } })
      yield* client.projects.createProject({ payload: { key: folio, name: ProjectName.make("Folio") } })
      yield* client.projects.addComponent({
        params: { project: folio },
        payload: { key: ComponentKey.make("folio-api"), name: ComponentName.make("Folio API") },
      })

      const { projects } = yield* client.projects.listProjects()
      assert.deepStrictEqual(
        projects.map((project) => [project.key, project.name]),
        [
          ["listed-folio", "Folio"],
          ["listed-notes", "Notes"],
        ],
      )
      const detail = yield* client.projects.project({ params: { project: folio } })
      assert.strictEqual(detail.project.name, "Folio")
      assert.deepStrictEqual(
        detail.components.map((component) => component.key),
        ["folio-api"],
      )
    }),
  )

  it.effect("refuses a project that doesn't exist, and lists a project created twice once", () =>
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      const missing = yield* client.projects
        .project({ params: { project: ProjectKey.make("nowhere") } })
        .pipe(Effect.flip)
      assert.deepStrictEqual(missing, new ProjectNotFound({ project: ProjectKey.make("nowhere") }))

      const twice = ProjectKey.make("twice")
      yield* client.projects.createProject({ payload: { key: twice, name: ProjectName.make("Twice") } })
      const again = yield* client.projects
        .createProject({ payload: { key: twice, name: ProjectName.make("Twice again") } })
        .pipe(Effect.flip)
      assert.deepStrictEqual(again, new ProjectExists({ project: twice }))
      const { projects } = yield* client.projects.listProjects()
      assert.deepStrictEqual(
        projects.filter((project) => project.key === twice).map((project) => project.name),
        ["Twice"],
      )
    }),
  )

  it.effect("lists a project that exists but isn't listed once someone tries to create it again", () =>
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      // A project created before the workspace's index existed, or by a create that stopped between
      // the project's object and the index: made in its object directly, so the index never heard.
      const input = yield* createInObject({
        actor: { _tag: "Member", id: MemberId.make(owner) },
        name: ProjectName.make("Unlisted"),
      })
      yield* Effect.promise(() => env.PROJECT.getByName("main/unlisted").call("createProject", input))
      const before = yield* client.projects.listProjects()
      assert.isFalse(before.projects.some((project) => project.key === "unlisted"))

      const retried = yield* client.projects
        .createProject({ payload: { key: ProjectKey.make("unlisted"), name: ProjectName.make("Unlisted") } })
        .pipe(Effect.flip)
      assert.deepStrictEqual(retried, new ProjectExists({ project: ProjectKey.make("unlisted") }))
      const after = yield* client.projects.listProjects()
      assert.isTrue(after.projects.some((project) => project.key === "unlisted"))
    }),
  )
})
