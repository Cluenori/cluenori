import { assert, describe, it } from "@effect/vitest"
import { DateTime } from "effect"

import { errorStatusOf, slowerOf } from "../src/index.ts"

// 2026-10-20T09:40:00Z.
const now = 1792489200000
const minute = 60_000
const hour = 60 * minute
const at = (epochMillis: number) => DateTime.makeUnsafe(epochMillis)

describe("slowerOf", () => {
  it("says an operation got slower when its p95 is 1.5 times its usual and 100 ms more", () => {
    assert.deepStrictEqual(slowerOf({ lastDayP95Ms: 420, usualP95Ms: 180 }), { p95Ms: 420, usualP95Ms: 180 })
  })

  it("leaves a fast operation alone when it doubles by a few milliseconds", () => {
    assert.isUndefined(slowerOf({ lastDayP95Ms: 4, usualP95Ms: 2 }))
  })

  it("leaves an operation alone under 1.5 times its usual", () => {
    assert.isUndefined(slowerOf({ lastDayP95Ms: 1_400, usualP95Ms: 1_000 }))
  })

  it("has no verdict for an operation new this week", () => {
    assert.isUndefined(slowerOf({ lastDayP95Ms: 900 }))
  })
})

describe("errorStatusOf", () => {
  it("calls a group new for its first day and ongoing for 15 minutes after it was last seen", () => {
    const seen = (first: number, last: number) => ({ firstSeen: at(now - first), lastSeen: at(now - last) })
    assert.deepStrictEqual(errorStatusOf(seen(23 * hour, 14 * minute), now), { isNew: true, ongoing: true })
    assert.deepStrictEqual(errorStatusOf(seen(25 * hour, 16 * minute), now), { isNew: false, ongoing: false })
  })
})
