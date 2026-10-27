import { assert, describe, it } from "@effect/vitest"
import { Option } from "effect"

import { floorOf, scoreOf, tallyOf } from "../src/mutation-score.ts"

describe("scoreOf", () => {
  it("counts killed and timed-out mutants as caught, and leaves out those that never ran", () => {
    const tally = tallyOf(["Killed", "Timeout", "Survived", "NoCoverage", "CompileError", "RuntimeError", "Ignored"])
    assert.deepStrictEqual(tally, { caught: 2, survived: 1, notCovered: 1 })
    assert.deepStrictEqual(scoreOf(tally), Option.some(50))
  })

  it("has no score when no mutant counts", () => {
    assert.deepStrictEqual(scoreOf(tallyOf(["CompileError", "Ignored"])), Option.none())
  })

  it("scores all caught, none caught, and an uneven mix without treating untested mutants as caught", () => {
    for (const { tally, score } of [
      { tally: { caught: 3, survived: 0, notCovered: 0 }, score: 100 },
      { tally: { caught: 0, survived: 2, notCovered: 0 }, score: 0 },
      { tally: { caught: 0, survived: 0, notCovered: 2 }, score: 0 },
      { tally: { caught: 1, survived: 2, notCovered: 5 }, score: 12.5 },
    ]) {
      assert.deepStrictEqual(scoreOf(tally), Option.some(score))
    }
  })
})

describe("floorOf", () => {
  it("rounds a score down to hundredths, so the run that set the floor clears it", () => {
    const score = Option.getOrThrow(scoreOf({ caught: 84, survived: 102, notCovered: 5 }))
    // 84 of 191 is 43.979…%, shown as 43.98%.
    assert.strictEqual(floorOf(score), 43.97)
    assert.isTrue(score >= floorOf(score))
    assert.strictEqual(floorOf(floorOf(score)), 43.97)
  })
})
