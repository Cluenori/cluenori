import { assert, describe, it } from "@effect/vitest"

import { axisTime, dayOf } from "@/lib/format"
import {
  appHealthOf,
  attentionOf,
  columnTimesOf,
  errorGroups,
  failureSpikeOf,
  now,
  roleOf,
  slowerOf,
  statusOf,
} from "@/project-facts"

const minute = 60_000
const hour = 60 * minute

describe("slowerOf", () => {
  it("says an endpoint got slower when its p95 is 1.5 times its usual and 100 ms more", () => {
    assert.deepStrictEqual(slowerOf({ lastDayP95Ms: 420, usualP95Ms: 180 }), { p95Ms: 420, usualP95Ms: 180 })
  })

  it("leaves a fast endpoint alone when it doubles by a few milliseconds", () => {
    assert.isUndefined(slowerOf({ lastDayP95Ms: 4, usualP95Ms: 2 }))
  })

  it("leaves an endpoint alone under 1.5 times its usual", () => {
    assert.isUndefined(slowerOf({ lastDayP95Ms: 1_400, usualP95Ms: 1_000 }))
  })

  it("has no verdict for an endpoint new this week", () => {
    assert.isUndefined(slowerOf({ lastDayP95Ms: 900 }))
  })
})

// A period of minutes with 100 requests each, and these failed.
const columns = (failed: ReadonlyArray<number>) => ({
  from: 0,
  step: minute,
  rows: [{ values: failed.map(() => 100) }],
  failed,
})

describe("failureSpikeOf", () => {
  it("finds the window where the error rate jumped, widened to its neighbors", () => {
    assert.deepStrictEqual(failureSpikeOf(columns([0, 1, 0, 0, 20, 30, 0, 0, 1, 0])), {
      from: 4 * minute,
      to: 6 * minute,
      failed: 50,
      requests: 200,
    })
  })

  it("finds nothing when failures stay level", () => {
    assert.isUndefined(failureSpikeOf(columns([1, 1, 1, 1, 1, 1, 1, 1, 1, 1])))
  })

  it("finds nothing when the worst window is under a 2% error rate", () => {
    assert.isUndefined(failureSpikeOf(columns([0, 0, 0, 0, 1, 0, 0, 0, 0, 0])))
  })
})

describe("statusOf", () => {
  const group = errorGroups[0]

  it("calls a group new for its first day and ongoing for 15 minutes after it was last seen", () => {
    assert.isDefined(group)
    if (group === undefined) {
      return
    }
    assert.deepStrictEqual(statusOf({ ...group, firstSeen: now - 23 * hour, lastSeen: now - 14 * minute }), {
      isNew: true,
      ongoing: true,
    })
    assert.deepStrictEqual(statusOf({ ...group, firstSeen: now - 25 * hour, lastSeen: now - 16 * minute }), {
      isNew: false,
      ongoing: false,
    })
  })
})

describe("roleOf", () => {
  it("calls a component on people's devices an app, and one on servers a backend", () => {
    assert.strictEqual(roleOf("folio-ios"), "app")
    assert.strictEqual(roleOf("folio-web"), "app")
    assert.strictEqual(roleOf("folio-android"), "app")
    assert.strictEqual(roleOf("folio-api"), "backend")
  })
})

describe("appHealthOf", () => {
  it("counts an app's crashes from its crash groups, against its sessions", () => {
    const health = appHealthOf("folio-ios")
    const crashes = errorGroups
      .filter((group) => group.lastComponent === "folio-ios" && group.crash)
      .reduce((sum, group) => sum + group.occurrences, 0)
    assert.strictEqual(health?.crashed, crashes)
    assert.isTrue((health?.sessions ?? 0) > crashes)
  })

  it("has no health for a backend, nor for an app that has sent nothing", () => {
    assert.isUndefined(appHealthOf("folio-api"))
    assert.isUndefined(appHealthOf("folio-android"))
  })
})

describe("columnTimesOf", () => {
  it("names columns by time over a day, and by day over longer periods", () => {
    const day = columnTimesOf({ from: now, step: 20 * minute })
    const week = columnTimesOf({ from: now, step: (7 * 24 * hour) / 72 })
    assert.strictEqual(day.whenOf(3), axisTime(now + 60 * minute))
    assert.strictEqual(week.whenOf(0), dayOf(now))
  })
})

describe("attentionOf", () => {
  const items = attentionOf("folio", "24h")

  it("puts what is failing before what is slow or new", () => {
    const tones = items.map((item) => item.tone)
    assert.strictEqual(tones.lastIndexOf("failure") < tones.indexOf("warning"), true)
  })

  it("names the new crash, and the endpoints and screens that got slower", () => {
    const keys = items.map((item) => item.key)
    assert.include(keys, "new crash 7c3a9e1f5b2d4068")
    assert.include(keys, "slower GET /api/feed")
    assert.include(keys, "slower folio-ios FeedView")
  })

  it("leaves an endpoint that is slow by nature, but as usual, alone", () => {
    assert.notInclude(
      items.map((item) => item.key),
      "slower POST /api/export",
    )
  })
})
