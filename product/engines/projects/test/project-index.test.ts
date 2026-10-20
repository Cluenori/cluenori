import { ProjectKey } from "@cluenori/foundation"
import { assert, describe, it } from "@effect/vitest"
import { DateTime, Effect } from "effect"

import { Project, ProjectIndex, ProjectName } from "../src/index.ts"
import { inWorkspace } from "./in-object.ts"

const createdAt = DateTime.makeUnsafe("2026-10-20T09:40:00Z")
const project = (key: string, name: string) =>
  new Project({ key: ProjectKey.make(key), name: ProjectName.make(name), createdAt })

describe("ProjectIndex", () => {
  it.effect("lists nothing before a project is recorded", () =>
    inWorkspace(
      "empty",
      Effect.gen(function* () {
        const index = yield* ProjectIndex
        assert.deepStrictEqual(yield* index.all, [])
      }),
    ),
  )

  it.effect("lists every recorded project, by key", () =>
    inWorkspace(
      "by-key",
      Effect.gen(function* () {
        const index = yield* ProjectIndex
        yield* index.record(project("notes", "Notes"))
        yield* index.record(project("folio", "Folio"))
        const listed = yield* index.all
        assert.deepStrictEqual(
          listed.map((entry) => entry.key),
          ["folio", "notes"],
        )
        assert.strictEqual(DateTime.formatIso(listed[0]?.createdAt ?? createdAt), "2026-10-20T09:40:00.000Z")
      }),
    ),
  )

  it.effect("keeps one entry for a project recorded again, with its newest name", () =>
    inWorkspace(
      "again",
      Effect.gen(function* () {
        const index = yield* ProjectIndex
        yield* index.record(project("notes", "Notes"))
        yield* index.record(project("notes", "Notes app"))
        assert.deepStrictEqual(
          (yield* index.all).map((entry) => [entry.key, entry.name]),
          [["notes", "Notes app"]],
        )
      }),
    ),
  )
})
