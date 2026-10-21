import { SketchValue, sketchOf } from "@bagatka/quantile-sketch"
import type { Actor } from "@cluenori/foundation"
import { ActivityLog, ComponentKey, EnvelopeName, EnvironmentKey, MemberId } from "@cluenori/foundation"
import { ComponentName, ProjectName, Projects } from "@cluenori/projects"
import type { OperationCounts } from "@cluenori/signals"
import { BatchDigest, Signals } from "@cluenori/signals"
import { assert, describe, it } from "@effect/vitest"
import { DateTime, Effect } from "effect"
import { TestClock } from "effect/testing"

import { Incidents, MonitorUrl } from "../src/index.ts"
import { answers, inProject } from "./in-object.ts"

// 2026-10-21T10:00:00Z, on a minute.
const start = 1792576800000
const minute = 60_000
const hour = 60 * minute
const day = 24 * hour

const api = ComponentKey.make("notes-api")
const jobs = ComponentKey.make("notes-jobs")
const member: Actor = { _tag: "Member", id: MemberId.make("0199f7a2-5c1e-7d3a-9b2f-4e8a1c6d0f53") }

// `count` runs of `operation`, `errors` of them failed, in the minute starting at `at`.
const counts = (operation: string, at: number, count: number, errors = 0): OperationCounts => ({
  bucket: DateTime.makeUnsafe(at - (at % minute)),
  operation: EnvelopeName.make(operation),
  environment: EnvironmentKey.make("production"),
  count,
  errors,
  totalMs: count * 20,
  durations: sketchOf(Array.from({ length: count }, () => SketchValue.make(20))),
})

// The URL of the `index`th of many monitors.
const healthUrl = (index: number) => MonitorUrl.make(`https://notes.test/health/${index}`)

let batches = 0

// Records counts as a trace export of `component` brings them.
const record = (component: ComponentKey, entries: ReadonlyArray<OperationCounts>) =>
  Effect.gen(function* () {
    const signals = yield* Signals
    batches += 1
    const at = yield* DateTime.now
    yield* signals.recordTraces(component, {
      digest: BatchDigest.make(batches.toString(16).padStart(64, "0")),
      archive: new Uint8Array(0),
      from: at,
      to: at,
      spans: entries.length,
      counts: entries,
      kept: [],
      traces: [],
    })
  })

const checkAt = (time: number) =>
  Effect.gen(function* () {
    yield* TestClock.setTime(time)
    const incidents = yield* Incidents
    const changes = yield* incidents.check
    return changes.map((change) => [change.change, change.incident.title] as const)
  })

describe("Incidents", () => {
  it.effect("opens an incident when an operation fails three times its usual, and resolves it 10 minutes after", () =>
    inProject(
      "failing",
      start,
      Effect.gen(function* () {
        // A week of exports, one in a thousand failed; then a minute with 10 of 50 failed.
        yield* record(api, [counts("POST /api/export", start - 3 * day, 1000, 1)])
        yield* record(api, [counts("POST /api/export", start - minute, 50, 10)])

        const opened = yield* checkAt(start)
        // The failures are in the 15 minutes looked at until 14 minutes on, then leave them; ten
        // minutes after it last saw them, the incident resolves.
        const same = yield* checkAt(start + 14 * minute)
        const quiet = yield* checkAt(start + 15 * minute)
        const resolved = yield* checkAt(start + 24 * minute)

        assert.deepStrictEqual(opened, [["opened", "POST /api/export: 20% failed, usually 0.1%"]])
        assert.deepStrictEqual(same, [])
        assert.deepStrictEqual(quiet, [])
        assert.deepStrictEqual(resolved, [["resolved", "POST /api/export: 20% failed, usually 0.1%"]])

        // Back within 30 minutes, the same incident reopens.
        yield* record(api, [counts("POST /api/export", start + 30 * minute, 40, 20)])
        const reopened = yield* checkAt(start + 31 * minute)
        const list = yield* (yield* Incidents).incidents

        assert.deepStrictEqual(reopened, [["reopened", "POST /api/export: 50% failed, usually 0.1%"]])
        assert.strictEqual(list.open.length, 1)
        assert.deepStrictEqual(list.resolved, [])
        assert.strictEqual(DateTime.toEpochMillis(list.open[0]?.openedAt ?? DateTime.makeUnsafe(0)), start)
        assert.strictEqual(DateTime.toEpochMillis(list.checkedAt ?? DateTime.makeUnsafe(0)), start + 31 * minute)
      }),
    ),
  )

  it.effect("learns from many operations at once, as a real project has them", () =>
    inProject(
      "many-operations",
      start,
      Effect.gen(function* () {
        // Forty operations a week ago: more rows than one statement may bind values for.
        yield* record(
          api,
          Array.from({ length: 40 }, (_, index) => counts(`GET /api/items/${index}`, start - 3 * day, 10)),
        )

        assert.deepStrictEqual(yield* checkAt(start), [])
        assert.isDefined((yield* (yield* Incidents).incidents).checkedAt)
      }),
    ),
  )

  it.effect("leaves alone a few failures, and failing as usual", () =>
    inProject(
      "failing-as-usual",
      start,
      Effect.gen(function* () {
        // Four failures are too few; an import that fails a quarter of the time, as it always does,
        // is not news.
        yield* record(api, [counts("GET /api/feed", start - minute, 10, 4)])
        yield* record(api, [counts("POST /api/import", start - 2 * day, 400, 100)])
        yield* record(api, [counts("POST /api/import", start - minute, 40, 10)])

        assert.deepStrictEqual(yield* checkAt(start), [])
      }),
    ),
  )

  it.effect("tells when an incident gets worse: a failure rate twice what it last told", () =>
    inProject(
      "failing-worse",
      start,
      Effect.gen(function* () {
        yield* record(api, [counts("POST /api/export", start - minute, 100, 5)])
        const opened = yield* checkAt(start)
        yield* record(api, [counts("POST /api/export", start + 2 * minute, 100, 30)])
        const worse = yield* checkAt(start + 3 * minute)

        assert.deepStrictEqual(opened, [["opened", "POST /api/export: 5% failed, usually none"]])
        assert.deepStrictEqual(worse, [["worsened", "POST /api/export: 18% failed, usually none"]])
      }),
    ),
  )

  it.effect("opens an incident when a scheduled job misses twice its gap, and resolves it once it runs", () =>
    inProject(
      "stopped",
      start,
      Effect.gen(function* () {
        // A cleanup job ran every hour for the 10 hours before; a feed is asked for whenever.
        yield* record(
          jobs,
          Array.from({ length: 10 }, (_, index) => counts("cleanup.run", start - (index + 1) * hour, 1)),
        )
        yield* record(
          api,
          [3, 47, 260, 300, 410, 590, 600].map((ago) => counts("GET /api/feed", start - ago * minute, 1)),
        )

        const onTime = yield* checkAt(start)
        // Two gaps after its last run, and five minutes for its telemetry, it is overdue.
        const stopped = yield* checkAt(start + hour + 6 * minute)
        yield* record(jobs, [counts("cleanup.run", start + hour + 10 * minute, 1)])
        const ranAgain = yield* checkAt(start + hour + 11 * minute)
        const resolved = yield* checkAt(start + hour + 17 * minute)

        assert.deepStrictEqual(onTime, [])
        assert.deepStrictEqual(stopped, [["opened", "cleanup.run stopped: it usually runs every hour"]])
        assert.deepStrictEqual(ranAgain, [])
        assert.deepStrictEqual(resolved, [["resolved", "cleanup.run stopped: it usually runs every hour"]])
      }),
    ),
  )

  it.effect("learns a job that runs every 10 minutes from its last 6 hours, too busy for two days", () =>
    inProject(
      "stopped-often",
      start,
      Effect.gen(function* () {
        // An outbox poller, every 10 minutes for 40 hours: 240 runs, more than two days look at.
        yield* record(
          jobs,
          Array.from({ length: 240 }, (_, index) => counts("outbox.poll", start - (index + 1) * 10 * minute, 1)),
        )

        const onTime = yield* checkAt(start)
        const stopped = yield* checkAt(start + 16 * minute)

        assert.deepStrictEqual(onTime, [])
        assert.deepStrictEqual(stopped, [["opened", "outbox.poll stopped: it usually runs every 10 minutes"]])
      }),
    ),
  )

  it.effect(
    "opens an incident when a monitor fails two checks in a row, and resolves it 10 minutes after it answers",
    () =>
      inProject(
        "down",
        start,
        Effect.gen(function* () {
          const projects = yield* Projects
          const incidents = yield* Incidents
          const url = MonitorUrl.make("https://down.notes.test/health")
          yield* projects.create(member, ProjectName.make("Notes"))
          yield* projects.addComponent(member, { key: api, name: ComponentName.make("Notes API") })
          yield* incidents.addMonitor(member, { component: api, url })
          answers.set(url, 503)

          const once = yield* checkAt(start)
          const twice = yield* checkAt(start + minute)
          answers.set(url, 200)
          const answered = yield* checkAt(start + 2 * minute)
          const monitors = yield* incidents.monitors
          const resolved = yield* checkAt(start + 11 * minute)

          assert.deepStrictEqual(once, [])
          assert.deepStrictEqual(twice, [["opened", "https://down.notes.test/health is down: HTTP 503"]])
          assert.deepStrictEqual(answered, [])
          assert.deepStrictEqual(
            monitors.monitors.map((entry) => [entry.monitor.url, entry.lastCheck?.problem]),
            [[url, undefined]],
          )
          assert.deepStrictEqual(resolved, [["resolved", "https://down.notes.test/health is down: HTTP 503"]])
        }),
      ),
  )

  it.effect("says what went wrong with a URL that doesn't connect", () =>
    inProject(
      "unreachable",
      start,
      Effect.gen(function* () {
        const projects = yield* Projects
        const incidents = yield* Incidents
        yield* projects.create(member, ProjectName.make("Notes"))
        yield* projects.addComponent(member, { key: api, name: ComponentName.make("Notes API") })
        yield* incidents.addMonitor(member, { component: api, url: MonitorUrl.make("https://nowhere.notes.test/") })

        yield* checkAt(start)
        const down = yield* checkAt(start + minute)

        assert.deepStrictEqual(down, [["opened", "https://nowhere.notes.test/ is down: Could not connect"]])
      }),
    ),
  )

  it.effect("acknowledges an incident once, records who did, and says so when it resolves", () =>
    inProject(
      "acknowledged",
      start,
      Effect.gen(function* () {
        const incidents = yield* Incidents
        const log = yield* ActivityLog
        yield* record(api, [counts("POST /api/export", start - minute, 50, 10)])
        yield* checkAt(start)
        const [open] = (yield* incidents.incidents).open
        if (open === undefined) {
          return assert.fail("The failing export opened no incident")
        }

        yield* TestClock.setTime(start + 2 * minute)
        const first = yield* incidents.acknowledge(member, open.id)
        yield* TestClock.setTime(start + 3 * minute)
        const again = yield* incidents.acknowledge(member, open.id)
        const latest = yield* log.latest

        assert.strictEqual(DateTime.toEpochMillis(first.acknowledgedAt ?? DateTime.makeUnsafe(0)), start + 2 * minute)
        assert.deepStrictEqual(again.acknowledgedAt, first.acknowledgedAt)
        assert.deepStrictEqual(
          latest.map((entry): ReadonlyArray<string | undefined> => [entry.name, entry.actor?._tag]),
          [
            ["incident.acknowledged", "Member"],
            ["incident.acknowledged", "Member"],
            ["incident.opened", "System"],
          ],
        )
        assert.strictEqual(latest[0]?.attrs["title"], open.title)

        // Whoever tells people stays quiet about an incident someone is on.
        yield* checkAt(start + 24 * minute)
        const [resolved] = yield* log.latest
        assert.strictEqual(resolved?.name, "incident.resolved")
        assert.strictEqual(resolved?.attrs["acknowledged"], true)
      }),
    ),
  )

  it.effect("keeps monitors to the project's components, one of each URL, and at most 20", () =>
    inProject(
      "monitors",
      start,
      Effect.gen(function* () {
        const projects = yield* Projects
        const incidents = yield* Incidents
        yield* projects.create(member, ProjectName.make("Notes"))
        yield* projects.addComponent(member, { key: api, name: ComponentName.make("Notes API") })

        const unknown = yield* Effect.flip(incidents.addMonitor(member, { component: jobs, url: healthUrl(0) }))
        for (let index = 0; index < 20; index += 1) {
          yield* incidents.addMonitor(member, { component: api, url: healthUrl(index) })
        }
        const twice = yield* Effect.flip(incidents.addMonitor(member, { component: api, url: healthUrl(0) }))
        const tooMany = yield* Effect.flip(incidents.addMonitor(member, { component: api, url: healthUrl(20) }))

        assert.strictEqual(unknown._tag, "ComponentNotFound")
        assert.strictEqual(twice._tag, "MonitorExists")
        assert.strictEqual(tooMany._tag, "MonitorLimitReached")
        assert.strictEqual((yield* incidents.monitors).monitors.length, 20)
      }),
    ),
  )

  it.effect("resolves a monitor's open incident when the monitor is removed", () =>
    inProject(
      "monitor-removed",
      start,
      Effect.gen(function* () {
        const projects = yield* Projects
        const incidents = yield* Incidents
        const url = MonitorUrl.make("https://removed.notes.test/health")
        yield* projects.create(member, ProjectName.make("Notes"))
        yield* projects.addComponent(member, { key: api, name: ComponentName.make("Notes API") })
        const monitor = yield* incidents.addMonitor(member, { component: api, url })
        answers.set(url, 500)
        yield* checkAt(start)
        yield* checkAt(start + minute)

        yield* incidents.removeMonitor(member, monitor.id)
        const list = yield* incidents.incidents
        const missing = yield* Effect.flip(incidents.removeMonitor(member, monitor.id))

        assert.deepStrictEqual(list.open, [])
        assert.deepStrictEqual(
          list.resolved.map((incident) => incident.title),
          ["https://removed.notes.test/health is down: HTTP 500"],
        )
        assert.strictEqual(missing._tag, "MonitorNotFound")
      }),
    ),
  )
})
