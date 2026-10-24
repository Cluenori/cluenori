import { assert, describe, it } from "@effect/vitest"
import { Option } from "effect"

import { scoreOf, tallyOf } from "../src/mutation-score.ts"

describe("scoreOf", () => {
  it("counts killed and timed-out mutants as caught, and leaves out those that never ran", () => {
    const tally = tallyOf(["Killed", "Timeout", "Survived", "NoCoverage", "CompileError", "RuntimeError", "Ignored"])
    assert.deepStrictEqual(tally, { caught: 2, survived: 1, notCovered: 1 })
    assert.deepStrictEqual(scoreOf(tally), Option.some(50))
  })

  it("has no score when no mutant counts", () => {
    assert.deepStrictEqual(scoreOf(tallyOf(["CompileError", "Ignored"])), Option.none())
  })
})
