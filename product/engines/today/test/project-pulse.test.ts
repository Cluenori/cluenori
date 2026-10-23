import { CalendarDay, ProjectKey } from "@cluenori/foundation"
import type { LoadPoint, LoadSeries, UsageDay } from "@cluenori/signals"
import { assert, describe, it } from "@effect/vitest"
import { DateTime } from "effect"

import { pulseOf } from "../src/index.ts"

// 2026-10-21T10:00:00Z.
const now = 1792576800000
const hour = 3_600_000
const at = (millis: number) => DateTime.makeUnsafe(millis)
const notes = ProjectKey.make("notes")

// `count` operations, `errors` of them failed, in the hour starting `hoursAgo` before now.
const point = (hoursAgo: number, count: number, errors: number): LoadPoint => ({
  start: at(now - hoursAgo * hour),
  count,
  errors,
  p50Ms: 20,
  p80Ms: 30,
  p95Ms: 40,
  p99Ms: 50,
})

const series = (points: ReadonlyArray<LoadPoint>): LoadSeries => ({ step: "1h", points })

const day = (people: number, windows?: { readonly weekPeople: number; readonly monthPeople: number }): UsageDay => ({
  day: CalendarDay.make("2026-10-20"),
  people,
  installations: people + 2,
  ...windows,
  sessions: people * 3,
  foregroundMs: people * 60_000,
})

describe("pulseOf", () => {
  it("sums the load of each production environment by the hour, oldest first", () => {
    const pulse = pulseOf({
      project: notes,
      load: [series([point(2, 100, 1), point(0, 40, 0)]), series([point(3, 5, 5), point(2, 20, 2)])],
      latest: [],
      weekBefore: [],
    })

    assert.deepStrictEqual(pulse, {
      project: notes,
      load: [
        { start: at(now - 3 * hour), count: 5, errors: 5 },
        { start: at(now - 2 * hour), count: 120, errors: 3 },
        { start: at(now), count: 40, errors: 0 },
      ],
    })
  })

  it("sums people across environments, and a week's or month's only when every day has it", () => {
    const pulse = pulseOf({
      project: notes,
      load: [],
      latest: [day(300, { weekPeople: 900, monthPeople: 2_000 }), day(10)],
      weekBefore: [day(280, { weekPeople: 850, monthPeople: 1_900 }), day(4, { weekPeople: 20, monthPeople: 30 })],
    })

    assert.deepStrictEqual(pulse.people, {
      latest: {
        day: CalendarDay.make("2026-10-20"),
        people: 310,
        installations: 314,
        sessions: 930,
        foregroundMs: 18_600_000,
      },
      weekBefore: {
        day: CalendarDay.make("2026-10-20"),
        people: 284,
        installations: 288,
        weekPeople: 870,
        monthPeople: 1_930,
        sessions: 852,
        foregroundMs: 17_040_000,
      },
    })
  })

  it("has no people when no environment counts the latest day, and no week before when none counts it", () => {
    const empty = pulseOf({ project: notes, load: [], latest: [], weekBefore: [] })
    const newApp = pulseOf({ project: notes, load: [], latest: [day(12)], weekBefore: [] })

    assert.deepStrictEqual(empty, { project: notes, load: [] })
    assert.deepStrictEqual(newApp.people, { latest: day(12) })
  })
})
