import { assert, describe, it } from "@effect/vitest"
import { Option } from "effect"

import type { QuantileSketch } from "../src/index.ts"
import {
  countOf,
  emptySketch,
  mergeSketches,
  Quantile,
  quantileOf,
  relativeAccuracy,
  SketchValue,
  sketchOf,
} from "../src/index.ts"

// Request durations in milliseconds, spread like real ones: most fast, a long tail. Deterministic,
// so a failure repeats.
const durations = Array.from({ length: 10_000 }, (_, index) => {
  const unit = (Math.sin(index * 12.9898) * 43_758.5453) % 1
  return SketchValue.make(Math.exp(3 + 2.5 * Math.abs(unit) ** 2))
})

const exactQuantile = (values: ReadonlyArray<number>, quantile: number) => {
  const sorted = values.toSorted((left, right) => left - right)
  return sorted[Math.max(Math.ceil(quantile * sorted.length) - 1, 0)] ?? Number.NaN
}

const read = (sketch: QuantileSketch, quantile: number) =>
  Option.getOrElse(quantileOf(sketch, Quantile.make(quantile)), () => Number.NaN)

describe("QuantileSketch", () => {
  it("reads every quantile within 2% of the true value", () => {
    const sketch = sketchOf(durations)
    for (const quantile of [0, 0.5, 0.8, 0.95, 0.99, 1]) {
      const exact = exactQuantile(durations, quantile)
      const estimate = read(sketch, quantile)
      assert.isAtMost(Math.abs(estimate - exact) / exact, relativeAccuracy, `p${quantile * 100}`)
    }
  })

  it("merges into the sketch of all the values together", () => {
    const halves = [sketchOf(durations.slice(0, 3_000)), sketchOf(durations.slice(3_000))]
    assert.deepStrictEqual(mergeSketches(halves), sketchOf(durations))
  })

  it("stays small however many values it holds", () => {
    const sketch = sketchOf(durations)
    assert.strictEqual(countOf(sketch), 10_000)
    assert.isAtMost(sketch.counts.length, 200)
  })

  it("reads p99 of fewer than 100 values as the largest, by nearest rank", () => {
    const sketch = sketchOf([1, 2, 3, 4, 30].map((value) => SketchValue.make(value)))
    assert.isAtMost(Math.abs(read(sketch, 0.99) - 30) / 30, relativeAccuracy)
    assert.isAtMost(Math.abs(read(sketch, 0.5) - 3) / 3, relativeAccuracy)
  })

  it("counts zero durations, and reads them as zero", () => {
    const sketch = sketchOf([0, 0, 0, 5].map((value) => SketchValue.make(value)))
    assert.strictEqual(sketch.zeros, 3)
    assert.strictEqual(read(sketch, 0.5), 0)
    assert.isAtMost(Math.abs(read(sketch, 1) - 5) / 5, relativeAccuracy)
  })

  it("has no quantile when it holds no values", () => {
    assert.isTrue(Option.isNone(quantileOf(emptySketch, Quantile.make(0.5))))
    assert.deepStrictEqual(mergeSketches([]), emptySketch)
  })
})
