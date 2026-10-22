import { ComponentKey, ProjectKey } from "@cluenori/foundation"
import { SemanticVersion } from "@cluenori/releases"
import { assert, describe, it } from "@effect/vitest"
import { Effect, Option } from "effect"

import { bumped, versionToSet, versionWantedOf } from "../src/version-bump.ts"

const project = ProjectKey.make("notes")
const component = ComponentKey.make("notes-ios")
const current = Option.some(SemanticVersion.make("1.4.2"))

describe("bumped", () => {
  it("raises the patch", () => {
    assert.strictEqual(bumped(SemanticVersion.make("1.4.2"), "patch"), "1.4.3")
  })

  it("raises the minor and starts the patch again", () => {
    assert.strictEqual(bumped(SemanticVersion.make("1.4.2"), "minor"), "1.5.0")
  })

  it("raises the major and starts the minor and patch again", () => {
    assert.strictEqual(bumped(SemanticVersion.make("1.4.2"), "major"), "2.0.0")
  })

  it("counts past 9 as numbers, not text", () => {
    assert.strictEqual(bumped(SemanticVersion.make("0.9.9"), "patch"), "0.9.10")
    assert.strictEqual(bumped(SemanticVersion.make("0.9.9"), "minor"), "0.10.0")
    assert.strictEqual(bumped(SemanticVersion.make("9.0.0"), "major"), "10.0.0")
  })
})

describe("versionWantedOf", () => {
  it.effect("takes patch, minor and major as parts, and anything else as a version", () =>
    Effect.gen(function* () {
      const part = yield* versionWantedOf("minor")
      const version = yield* versionWantedOf("2.0.0")
      assert.deepStrictEqual([part, version], ["minor", "2.0.0"])
    }),
  )

  it.effect("refuses a version that isn't MAJOR.MINOR.PATCH", () =>
    Effect.gen(function* () {
      const refused = yield* versionWantedOf("1.4").pipe(Effect.flip)
      assert.match(refused.message, /^"1.4" isn't a version, MAJOR.MINOR.PATCH, or patch, minor or major: /)
    }),
  )
})

describe("versionToSet", () => {
  it.effect("raises a part of the current version for patch, minor and major", () =>
    Effect.gen(function* () {
      const patch = yield* versionToSet({ project, component, wanted: "patch", current })
      const minor = yield* versionToSet({ project, component, wanted: "minor", current })
      const major = yield* versionToSet({ project, component, wanted: "major", current })
      assert.deepStrictEqual([patch, minor, major], ["1.4.3", "1.5.0", "2.0.0"])
    }),
  )

  it.effect("takes a version as it is, with or without a current one", () =>
    Effect.gen(function* () {
      const set = yield* versionToSet({ project, component, wanted: SemanticVersion.make("2.0.0"), current })
      const first = yield* versionToSet({
        project,
        component,
        wanted: SemanticVersion.make("1.0.0"),
        current: Option.none(),
      })
      assert.deepStrictEqual([set, first], ["2.0.0", "1.0.0"])
    }),
  )

  it.effect("refuses a bump of a component with no version yet, saying how to set its first", () =>
    Effect.gen(function* () {
      const refused = yield* versionToSet({ project, component, wanted: "patch", current: Option.none() }).pipe(
        Effect.flip,
      )
      assert.strictEqual(
        refused.message,
        "notes-ios has no version yet, so no patch to raise. Set its first: ./cluenori version notes notes-ios 1.0.0",
      )
    }),
  )
})
