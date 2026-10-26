import { CalendarDay, ComponentKey, ProjectKey } from "@cluenori/foundation"
import type { MonitorState } from "@cluenori/incidents"
import { Monitor, MonitorId, MonitorUrl } from "@cluenori/incidents"
import { assert, describe, it } from "@effect/vitest"
import { DateTime } from "effect"

import { monitorBriefOf, standingWordsOf, stripOf, uptimeAnswerOf, uptimeOf } from "@/incident-facts"

const day = 86_400_000
// 2026-10-21T10:00:00Z.
const now = 1792576800000

// A monitor added on 2026-10-17, its checks by day as given, last checked at `now`, failing or not.
const monitor = (id: string, days: MonitorState["days"], problem?: string): MonitorState => ({
  monitor: new Monitor({
    id: MonitorId.make(`019a0f2e-5c1e-7d3a-9b2f-4e8a1c6d0f5${id}`),
    component: ComponentKey.make("notes-api"),
    url: MonitorUrl.make(`https://notes.example/health/${id}`),
    addedAt: DateTime.makeUnsafe(now - 4 * day),
  }),
  lastCheck: { at: DateTime.makeUnsafe(now), ...(problem === undefined ? {} : { problem }) },
  days,
})

const counted = (date: string, checks: number, failed: number) => ({ day: CalendarDay.make(date), checks, failed })

describe("stripOf", () => {
  it("tells days before the monitor apart from days it wasn't checked, and some failed from all", () => {
    const state = monitor("1", [
      counted("2026-10-17", 840, 0),
      counted("2026-10-19", 1440, 3),
      counted("2026-10-20", 1440, 1440),
      counted("2026-10-21", 600, 0),
    ])
    assert.deepStrictEqual(
      stripOf(state, now, 6).map((entry) => [entry.day, entry.tone]),
      [
        ["2026-10-16", "before"],
        ["2026-10-17", "up"],
        ["2026-10-18", "unchecked"],
        ["2026-10-19", "some"],
        ["2026-10-20", "down"],
        ["2026-10-21", "up"],
      ],
    )
  })
})

describe("uptimeOf", () => {
  it("never says 100% when a check failed, and nothing when there were no checks", () => {
    assert.match(uptimeOf([counted("2026-10-21", 100_000, 1)]) ?? "", /99[.,]99/)
    assert.isUndefined(uptimeOf([]))
  })
})

describe("uptimeAnswerOf", () => {
  it("answers whether everything is up: down first, then whether all were checked", () => {
    const up = monitor("1", [])
    const down = monitor("2", [], "HTTP 503")
    const unchecked: MonitorState = { monitor: monitor("3", []).monitor, days: [] }
    assert.deepStrictEqual(uptimeAnswerOf([up, down, unchecked]), { tone: "failure", words: "1 of 3 monitors is down" })
    assert.deepStrictEqual(uptimeAnswerOf([up, unchecked]), {
      tone: "steady",
      words: "1 monitor is up; 1 not checked yet",
    })
    assert.deepStrictEqual(uptimeAnswerOf([up, monitor("4", [])]), { tone: "steady", words: "All 2 monitors are up" })
    assert.deepStrictEqual(uptimeAnswerOf([]), { tone: "quiet", words: "No monitors" })
  })

  it("says how long a monitor has been as it is only when that is known", () => {
    assert.strictEqual(standingWordsOf(monitor("1", [])), "Up")
    assert.strictEqual(standingWordsOf({ ...monitor("2", [], "HTTP 503") }), "Down: HTTP 503")
    assert.match(standingWordsOf({ ...monitor("1", []), since: DateTime.makeUnsafe(now - 3 * day) }), /^Up for 3 \S+$/)
  })
})

describe("monitorBriefOf", () => {
  it("hands an agent a monitor's URL without the token in its query", () => {
    const state = monitor("1", [counted("2026-10-21", 10, 0)])
    const secret: MonitorState = {
      ...state,
      monitor: new Monitor({
        id: state.monitor.id,
        component: state.monitor.component,
        addedAt: state.monitor.addedAt,
        url: MonitorUrl.make("https://ops:pw@notes.example/health?token=s3cret"),
      }),
    }

    const brief = monitorBriefOf(
      ProjectKey.make("notes"),
      { state: secret, recent: [], failures: [], incidents: [] },
      now,
    )

    assert.include(brief, "https://notes.example/health?…, of notes-api")
    assert.notInclude(brief, "s3cret")
    assert.notInclude(brief, "pw@")
  })
})
