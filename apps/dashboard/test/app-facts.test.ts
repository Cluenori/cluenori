import type { ReleaseHealth } from "@cluenori/analytics"
import { CalendarDay, ComponentKey, EnvironmentKey, Period, ReleaseVersion } from "@cluenori/foundation"
import type { AppUsage } from "@cluenori/signals"
import { assert, describe, it } from "@effect/vitest"
import { DateTime } from "effect"

import { appColorOf, cohortRowsOf, healthRowsOf, healthWordsOf, personDaysOf, usageColumnsOf } from "@/app-facts"

const day = 86_400_000
const at = (millis: number) => DateTime.makeUnsafe(millis)
const now = Date.UTC(2026, 9, 22, 18, 30)
const today = Math.floor(now / day)
const dayOf = (number: number) => CalendarDay.make(DateTime.formatIso(at(number * day)).slice(0, 10))
const ios = ComponentKey.make("notes-ios")
const api = ComponentKey.make("notes-api")
const production = EnvironmentKey.make("production")

// The last 5 days, of which the apps sent on the last 3: day 3's people were none.
const usage: AppUsage = {
  covered: new Period({ from: at((today - 2) * day), to: at(now) }),
  days: [
    { day: dayOf(today - 2), people: 4, installations: 4, sessions: 9, foregroundMs: 1 },
    { day: dayOf(today - 1), people: 0, installations: 0, weekPeople: 4, sessions: 0, foregroundMs: 0 },
    { day: dayOf(today), people: 6, installations: 6, weekPeople: 8, sessions: 14, foregroundMs: 1 },
  ],
  people: 8,
  installations: 8,
  sessions: 23,
  releases: [],
}

const release = (verdict: ReleaseHealth["verdict"], change: Partial<ReleaseHealth> = {}): ReleaseHealth => ({
  release: {
    component: ios,
    environment: production,
    release: ReleaseVersion.make("0.3.0+20"),
    firstSeen: at(now - 12 * day),
    lastSeen: at(now),
    previous: ReleaseVersion.make("0.2.0+10"),
  },
  health: {
    sessions: 700,
    people: 250,
    cold: { launches: 240, firstFrameP50Ms: 1_210, firstFrameP95Ms: 1_640 },
    prewarmed: 4,
  },
  previousHealth: {
    sessions: 900,
    people: 120,
    cold: { launches: 300, firstFrameP50Ms: 520, firstFrameP95Ms: 780 },
    prewarmed: 9,
    memory: { samples: 900, peakP95Bytes: 182_000_000, footprintP95Bytes: 150_000_000 },
  },
  verdict,
  worse: [],
  better: [],
  ...change,
})

describe("app facts", () => {
  it("leaves a day the apps didn't send on unknown, and a counted day of nobody at zero", () => {
    const period = { from: at((today - 4) * day + 3_600_000), to: at(now) }
    assert.deepStrictEqual(usageColumnsOf(usage, period, (each) => each.people).values, [undefined, undefined, 4, 0, 6])
  })

  it("leaves a week that reaches before the apps first sent unknown, never zero", () => {
    const period = { from: at((today - 2) * day), to: at(now) }
    assert.deepStrictEqual(usageColumnsOf(usage, period, (each) => each.weekPeople).values, [undefined, 4, 8])
  })

  it("says what made a release worse or better, in a release's words", () => {
    assert.deepStrictEqual(healthWordsOf(release("worse", { worse: ["coldLaunch", "crashes"] })), {
      words: "Worse: cold launch slower, more crashes",
      tone: "warning",
    })
    assert.deepStrictEqual(healthWordsOf(release("better", { better: ["hangs", "memory"] })), {
      words: "Better: fewer hangs, less memory",
      tone: "better",
    })
    assert.strictEqual(healthWordsOf(release("tooEarly")).words, "Too early to tell")
    assert.strictEqual(healthWordsOf(release("first")).words, "First release counted")
    assert.strictEqual(healthWordsOf(release("unmeasured")).words, "Nothing measured yet")
  })

  it("lists a measure only one release sent as unknown for the other, and leaves out one neither sent", () => {
    const rows = healthRowsOf(release("worse", { worse: ["coldLaunch"] }))
    const labels = rows.map((row) => row.label)
    const memory = rows.find((row) => row.label === "Peak memory p95")
    assert.strictEqual(memory?.now, undefined)
    assert.isString(memory?.before)
    assert.notInclude(labels, "Warm launch p95")
    assert.notInclude(labels, "Crashes per 1,000 sessions")
    assert.strictEqual(rows.find((row) => row.label === "Cold launch p95")?.moved, "worse")
  })

  it("draws every component's apps in one app's color when only one sent", () => {
    assert.strictEqual(appColorOf(undefined, [ios, ios], [api, ios]), "var(--purple)")
    assert.strictEqual(appColorOf(undefined, [ios, api], [api, ios]), "var(--blue)")
    assert.strictEqual(appColorOf(api, [ios], [api, ios]), "var(--blue)")
  })

  it("counts a person's days between those listed as days without a session", () => {
    const days = personDaysOf(
      [
        { day: dayOf(today), sessions: 2 },
        { day: dayOf(today - 3), sessions: 1 },
      ],
      dayOf(today),
    )
    assert.deepStrictEqual(days.values, [1, 0, 0, 2])
  })

  it("marks each cohort's last week as so far", () => {
    const rows = cohortRowsOf([{ week: dayOf(today - 7), people: 10, active: [10, 4] }])
    assert.deepStrictEqual(
      rows[0]?.weeks.map((week) => [week.share, week.soFar]),
      [
        [1, false],
        [0.4, true],
      ],
    )
  })
})
