import { sketchOf } from "@bagatka/quantile-sketch"
import type { Actor } from "@cluenori/foundation"
import {
  ActivityLog,
  ComponentKey,
  EnvelopeName,
  EnvironmentKey,
  InstallationId,
  MemberId,
  ReleaseVersion,
  SessionId,
} from "@cluenori/foundation"
import { ComponentName, ProjectName, Projects, SdkKey } from "@cluenori/projects"
import type { OperationCounts } from "@cluenori/signals"
import { AppSignalId, AppSignals, BatchDigest, Signals } from "@cluenori/signals"
import { assert, describe, it } from "@effect/vitest"
import { DateTime, Deferred, Effect, Result, Schema } from "effect"
import { TestClock } from "effect/testing"

import type { Monitor } from "../src/index.ts"
import { AddMonitor, IncidentId, Incidents, monitorLimit, MonitorUrl } from "../src/index.ts"
import { answers, before, inProject } from "./in-object.ts"

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
  durations: sketchOf(Array.from({ length: count }, () => 20)).sketch,
})

// The same counts, each run taking `ms`.
const taking = (entry: OperationCounts, ms: number): OperationCounts => ({
  ...entry,
  totalMs: entry.count * ms,
  durations: sketchOf(Array.from({ length: entry.count }, () => ms)).sketch,
})

// The same counts, its runs taking these times.
const spread = (entry: OperationCounts, durations: ReadonlyArray<number>): OperationCounts => ({
  ...entry,
  totalMs: durations.reduce((total, ms) => total + ms, 0),
  durations: sketchOf(durations).sketch,
})

// The URL of the `index`th of many monitors.
const healthUrl = (index: number) => MonitorUrl.make(`https://notes.test/health/${index}`)

// A monitor of a URL, ringing as an alarm.
const urlMonitor = (component: ComponentKey, url: MonitorUrl) => ({
  component,
  condition: { _tag: "noAnswer" as const, subject: { _tag: "url" as const, url } },
  level: "alarm" as const,
})
const urlOfMonitor = (monitor: Monitor) =>
  monitor.condition._tag === "noAnswer" ? monitor.condition.subject.url : undefined

const operation = (name: string) => ({ _tag: "operation" as const, operation: EnvelopeName.make(name) })

// A UUIDv7 made at `at`, the `n`th: IDs of an app's signals, sessions and installations.
const uuidAt = (at: number, n: number) => {
  const time = at.toString(16).padStart(12, "0")
  return `${time.slice(0, 8)}-${time.slice(8)}-7000-8000-${n.toString(16).padStart(12, "0")}`
}

// Whether a monitor to add decodes, and one of the API's shape with `condition`.
const decoded = (input: unknown) => Result.isSuccess(Schema.decodeUnknownResult(AddMonitor)(input))
const of = (condition: unknown, more: object = {}) => ({ component: "notes-api", condition, level: "alarm", ...more })

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

// The same counts, run by `version`.
const release = (entry: OperationCounts, version: string): OperationCounts => ({
  ...entry,
  release: ReleaseVersion.make(version),
})

// The same counts, from dev.
const dev = (entry: OperationCounts): OperationCounts => ({ ...entry, environment: EnvironmentKey.make("dev") })

// An entry's environment and whether it is production, in an order that doesn't depend on commits.
const placesOf = (entries: ReadonlyArray<{ readonly attrs: Readonly<Record<string, unknown>> }>) =>
  entries
    .map((entry) => [String(entry.attrs["environment"]), entry.attrs["production"]] as const)
    .toSorted(([left], [right]) => Number(left > right) - Number(left < right))
    .map(([environment, production]) => [environment, production])

describe("Incidents", () => {
  it.effect("says whether each change is in an environment its project calls production", () =>
    inProject(
      "production",
      start,
      Effect.gen(function* () {
        const projects = yield* Projects
        const log = yield* ActivityLog
        yield* projects.create(member, ProjectName.make("Notes"))
        yield* record(api, [dev(counts("POST /api/export", start - 3 * day, 1000, 1))])
        yield* record(api, [dev(counts("POST /api/export", start - minute, 50, 10))])
        yield* record(api, [counts("POST /api/export", start - 3 * day, 1000, 1)])
        yield* record(api, [counts("POST /api/export", start - minute, 50, 10)])
        yield* checkAt(start)
        const opened = (yield* log.latest).filter((entry) => entry.name === "incident.opened")
        // Once the project calls dev production too, its changes say so.
        yield* projects.updateSettings(member, {
          productionEnvironments: [EnvironmentKey.make("production"), EnvironmentKey.make("dev")],
        })
        yield* checkAt(start + 25 * minute)
        const resolved = (yield* log.latest).filter((entry) => entry.name === "incident.resolved")

        assert.deepStrictEqual(placesOf(opened), [
          ["dev", false],
          ["production", true],
        ])
        assert.deepStrictEqual(placesOf(resolved), [
          ["dev", true],
          ["production", true],
        ])
      }),
    ),
  )

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

  it.effect("never takes an operation that runs regularly for a job, but hints that it is quiet", () =>
    inProject(
      "regular-not-a-job",
      start,
      Effect.gen(function* () {
        // An endpoint the app asks every 31 minutes for a day, as Graphit's did, then nobody asks.
        yield* record(
          api,
          Array.from({ length: 48 }, (_, index) =>
            counts("GET /api/verification/latest", start - (index + 1) * 31 * minute, 1),
          ),
        )

        const incidents = yield* Incidents
        const log = yield* ActivityLog
        const onTime = yield* checkAt(start)
        const quietOnTime = (yield* incidents.incidents).quiet
        // Two gaps after its last call and five minutes more, it is quiet: a hint, not an incident.
        const later = yield* checkAt(start + 2 * hour)
        const quiet = (yield* incidents.incidents).quiet
        // Called again, it is no longer quiet.
        yield* record(api, [counts("GET /api/verification/latest", start + 2 * hour + minute, 1)])
        const calledAgain = yield* checkAt(start + 2 * hour + 2 * minute)
        const quietAfter = (yield* incidents.incidents).quiet

        assert.deepStrictEqual([onTime, later, calledAgain], [[], [], []])
        assert.deepStrictEqual(quietOnTime, [])
        assert.deepStrictEqual(
          quiet.map((hint) => [hint.operation, hint.usualGapMs, DateTime.toEpochMillis(hint.lastRanAt)]),
          [["GET /api/verification/latest", 31 * minute, start - 31 * minute]],
        )
        assert.deepStrictEqual(quietAfter, [])
        // Nothing about it is activity, so nothing about it can reach a phone.
        assert.deepStrictEqual(yield* log.latest, [])
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
          yield* incidents.addMonitor(member, urlMonitor(api, url))
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
            monitors.monitors.map((entry) => [urlOfMonitor(entry.monitor), entry.lastCheck?.problem]),
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
        yield* incidents.addMonitor(member, urlMonitor(api, MonitorUrl.make("https://nowhere.notes.test/")))

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

  it.effect("keeps an incident's whole life, and the release that ran last where it opened", () =>
    inProject(
      "life",
      start,
      Effect.gen(function* () {
        const incidents = yield* Incidents
        // 1.4.0 ran days ago, 1.4.1 half an hour ago, then 1.4.0 again, rolled back, when it failed;
        // 9.0.0 ran in dev, which the incident isn't in.
        yield* record(api, [release(counts("POST /api/export", start - 3 * day, 1000, 1), "1.4.0")])
        yield* record(api, [release(counts("POST /api/export", start - 30 * minute, 10), "1.4.1")])
        yield* record(api, [release(dev(counts("GET /api/feed", start - 2 * minute, 10)), "9.0.0")])
        yield* record(api, [release(counts("POST /api/export", start - minute, 50, 10), "1.4.0")])
        yield* checkAt(start)
        yield* record(api, [counts("POST /api/export", start + 2 * minute, 100, 60)])
        yield* checkAt(start + 3 * minute)
        const [open] = (yield* incidents.incidents).open
        if (open === undefined) {
          return assert.fail("The failing export opened no incident")
        }
        yield* TestClock.setTime(start + 4 * minute)
        yield* incidents.acknowledge(member, open.id)
        yield* checkAt(start + 16 * minute)
        yield* checkAt(start + 18 * minute)
        yield* checkAt(start + 27 * minute)
        yield* record(api, [counts("POST /api/export", start + 30 * minute, 40, 20)])
        yield* checkAt(start + 31 * minute)

        const detail = yield* incidents.incident(open.id)
        const missing = yield* Effect.flip(incidents.incident(IncidentId.make("019a0f2e-5c1e-7d3a-9b2f-4e8a1c6d0f00")))

        assert.deepStrictEqual(
          detail.updates.map((update) => [update.change, DateTime.toEpochMillis(update.at) - start, update.title]),
          [
            ["opened", 0, "POST /api/export: 20% failed, usually 0.1%"],
            ["worsened", 3 * minute, "POST /api/export: 47% failed, usually 0.1%"],
            ["acknowledged", 4 * minute, undefined],
            ["resolved", 27 * minute, undefined],
            ["reopened", 31 * minute, "POST /api/export: 50% failed, usually 0.1%"],
          ],
        )
        assert.deepStrictEqual(detail.releases, [
          { environment: EnvironmentKey.make("production"), release: ReleaseVersion.make("1.4.0") },
        ])
        assert.strictEqual(detail.incident.resolvedAt, undefined)
        assert.strictEqual(missing._tag, "IncidentNotFound")
      }),
    ),
  )

  it.effect("keeps a monitor's every check, its days, since when it is up, and its incidents", () =>
    inProject(
      "history",
      start,
      Effect.gen(function* () {
        const projects = yield* Projects
        const incidents = yield* Incidents
        const url = MonitorUrl.make("https://history.notes.test/health")
        yield* projects.create(member, ProjectName.make("Notes"))
        yield* projects.addComponent(member, { key: api, name: ComponentName.make("Notes API") })
        // The API ran 2.0.0 in production and 2.1.0 in staging: a monitor's URL may be either.
        yield* record(api, [{ ...counts("GET /health", start - 5 * minute, 5), release: ReleaseVersion.make("2.0.0") }])
        yield* record(api, [
          {
            ...counts("GET /health", start - 5 * minute, 5),
            environment: EnvironmentKey.make("staging"),
            release: ReleaseVersion.make("2.1.0"),
          },
        ])
        const monitor = yield* incidents.addMonitor(member, urlMonitor(api, url))

        answers.set(url, 200)
        yield* checkAt(start)
        answers.set(url, 503)
        yield* checkAt(start + minute)
        yield* checkAt(start + 2 * minute)
        answers.set(url, 204)
        yield* checkAt(start + 3 * minute)
        // A day later, it answers again: a second day.
        yield* checkAt(start + day)

        const detail = yield* incidents.monitor(monitor.id)
        const list = yield* incidents.monitors
        const [down] = detail.incidents
        const opened = down === undefined ? undefined : yield* incidents.incident(down.id)

        assert.deepStrictEqual(detail.state.lastCheck, { at: DateTime.makeUnsafe(start + day), status: 204, ms: 0 })
        // Passing since it answered again, not since the check a day later.
        assert.strictEqual(DateTime.toEpochMillis(detail.state.since ?? DateTime.makeUnsafe(0)), start + 3 * minute)
        assert.deepStrictEqual(
          detail.state.days.map((entry): ReadonlyArray<unknown> => [
            entry.day,
            entry.checks,
            entry.failed,
            entry.averageMs,
          ]),
          [
            ["2026-10-21", 4, 2, 0],
            ["2026-10-22", 1, 0, 0],
          ],
        )
        assert.deepStrictEqual(list.monitors[0]?.days, detail.state.days)
        // The last 24 hours, by five minutes: the check exactly a day before is out of them.
        assert.deepStrictEqual(
          detail.recent.map((step) => [DateTime.toEpochMillis(step.start) - start, step.checks, step.failed]),
          [
            [0, 3, 2],
            [day, 1, 0],
          ],
        )
        assert.deepStrictEqual(
          detail.failures.map((check) => [DateTime.toEpochMillis(check.at) - start, check.status, check.problem]),
          [
            [2 * minute, 503, "HTTP 503"],
            [minute, 503, "HTTP 503"],
          ],
        )
        assert.deepStrictEqual(
          detail.incidents.map((incident) => incident.title),
          ["https://history.notes.test/health is down: HTTP 503"],
        )
        assert.deepStrictEqual(
          opened?.releases.map((ran): ReadonlyArray<string | undefined> => [ran.environment, ran.release]),
          [
            ["production", "2.0.0"],
            ["staging", "2.1.0"],
          ],
        )

        // A week and a day on, its checks of the first day are gone, and its day stays.
        yield* checkAt(start + 8 * day)
        const later = yield* incidents.monitor(monitor.id)
        assert.deepStrictEqual(later.failures, [])
        assert.strictEqual(later.state.days.length, 3)

        yield* incidents.removeMonitor(member, monitor.id)
        assert.strictEqual((yield* Effect.flip(incidents.monitor(monitor.id)))._tag, "MonitorNotFound")
      }),
    ),
  )

  it.effect("keeps nothing of a monitor removed while its URL is fetched, and counts a repeated check once", () =>
    inProject(
      "fetch-races",
      start,
      Effect.gen(function* () {
        const projects = yield* Projects
        const incidents = yield* Incidents
        const url = MonitorUrl.make("https://races.notes.test/health")
        yield* projects.create(member, ProjectName.make("Notes"))
        yield* projects.addComponent(member, { key: api, name: ComponentName.make("Notes API") })
        const monitor = yield* incidents.addMonitor(member, urlMonitor(api, url))
        answers.set(url, 503)
        yield* checkAt(start)
        // Checked again in the same millisecond, it counts once, in its checks and its day alike.
        yield* incidents.check
        const once = yield* incidents.monitor(monitor.id)

        // The second failed check is fetched; meanwhile the monitor is removed.
        const fetching = yield* Deferred.make<void>()
        const removed = yield* Deferred.make<void>()
        before.set(url, Deferred.succeed(fetching, undefined).pipe(Effect.andThen(Deferred.await(removed))))
        yield* TestClock.setTime(start + minute)
        const [changes] = yield* Effect.all(
          [
            incidents.check,
            Deferred.await(fetching).pipe(
              Effect.andThen(incidents.removeMonitor(member, monitor.id)),
              Effect.andThen(Deferred.succeed(removed, undefined)),
            ),
          ],
          { concurrency: 2 },
        )
        before.delete(url)

        assert.deepStrictEqual(
          [once.recent.reduce((sum, step) => sum + step.checks, 0), once.state.days.map((each) => each.checks)],
          [1, [1]],
        )
        assert.deepStrictEqual(changes, [])
        assert.deepStrictEqual((yield* incidents.incidents).open, [])
        assert.strictEqual((yield* Effect.flip(incidents.monitor(monitor.id)))._tag, "MonitorNotFound")
      }),
    ),
  )

  it.effect("tells an acknowledgment made while URLs are fetched when the incident resolves", () =>
    inProject(
      "fetch-acknowledged",
      start,
      Effect.gen(function* () {
        const projects = yield* Projects
        const incidents = yield* Incidents
        const log = yield* ActivityLog
        const url = MonitorUrl.make("https://acknowledged.notes.test/health")
        yield* projects.create(member, ProjectName.make("Notes"))
        yield* projects.addComponent(member, { key: api, name: ComponentName.make("Notes API") })
        yield* incidents.addMonitor(member, urlMonitor(api, url))
        answers.set(url, 503)
        yield* checkAt(start)
        yield* checkAt(start + minute)
        const [open] = (yield* incidents.incidents).open
        if (open === undefined) {
          return assert.fail("The monitor down twice opened no incident")
        }

        // It answers again, 11 minutes on; while that check fetches it, someone acknowledges it.
        answers.set(url, 200)
        const fetching = yield* Deferred.make<void>()
        const acknowledged = yield* Deferred.make<void>()
        before.set(url, Deferred.succeed(fetching, undefined).pipe(Effect.andThen(Deferred.await(acknowledged))))
        yield* TestClock.setTime(start + 12 * minute)
        const [changes] = yield* Effect.all(
          [
            incidents.check,
            Deferred.await(fetching).pipe(
              Effect.andThen(incidents.acknowledge(member, open.id)),
              Effect.andThen(Deferred.succeed(acknowledged, undefined)),
            ),
          ],
          { concurrency: 2 },
        )
        before.delete(url)
        const resolved = (yield* log.latest).find((entry) => entry.name === "incident.resolved")

        assert.deepStrictEqual(
          changes.map((change) => [change.change, change.incident.acknowledgedAt !== undefined]),
          [["resolved", true]],
        )
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

        const unknown = yield* Effect.flip(incidents.addMonitor(member, urlMonitor(jobs, healthUrl(0))))
        for (let index = 0; index < monitorLimit; index += 1) {
          yield* incidents.addMonitor(member, urlMonitor(api, healthUrl(index)))
        }
        const twice = yield* Effect.flip(incidents.addMonitor(member, urlMonitor(api, healthUrl(0))))
        const tooMany = yield* Effect.flip(incidents.addMonitor(member, urlMonitor(api, healthUrl(monitorLimit))))

        assert.strictEqual(unknown._tag, "ComponentNotFound")
        assert.strictEqual(twice._tag, "MonitorExists")
        assert.strictEqual(tooMany._tag, "MonitorLimitReached")
        assert.strictEqual((yield* incidents.monitors).monitors.length, monitorLimit)
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
        const monitor = yield* incidents.addMonitor(member, urlMonitor(api, url))
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

  it.effect("opens a declared job's stopped incident, at its level, once it hasn't run for its minutes", () =>
    inProject(
      "monitor-nothing-for",
      start,
      Effect.gen(function* () {
        const projects = yield* Projects
        const incidents = yield* Incidents
        const log = yield* ActivityLog
        yield* projects.create(member, ProjectName.make("Notes"))
        yield* projects.addComponent(member, { key: jobs, name: ComponentName.make("Notes jobs") })
        yield* record(jobs, [counts("cleanup.run", start - 5 * minute, 1)])
        const monitor = yield* incidents.addMonitor(member, {
          component: jobs,
          environment: EnvironmentKey.make("production"),
          condition: {
            _tag: "nothingFor",
            subject: { _tag: "operation", operation: EnvelopeName.make("cleanup.run") },
            minutes: 30,
          },
          level: "timeSensitive",
        })

        // Not judged before its 30 minutes have passed since it was added.
        const early = yield* checkAt(start + 29 * minute)
        const due = yield* checkAt(start + 30 * minute)
        const opened = (yield* log.latest).filter((entry) => entry.name === "incident.opened")
        const measured = (yield* incidents.monitors).monitors.map((state) => [state.measured?.value, state.firing])
        yield* TestClock.setTime(start + 35 * minute)
        yield* record(jobs, [counts("cleanup.run", start + 35 * minute, 1)])
        const ran = yield* checkAt(start + 36 * minute)
        const resolved = yield* checkAt(start + 41 * minute)
        const detail = yield* incidents.monitor(monitor.id)

        assert.deepStrictEqual(early, [])
        assert.deepStrictEqual(due, [["opened", "cleanup.run hasn't run for 30 minutes"]])
        assert.deepStrictEqual(
          opened.map((entry) => [entry.attrs["detector"], entry.attrs["level"], entry.attrs["subject"]]),
          [["monitor", "timeSensitive", "cleanup.run"]],
        )
        assert.deepStrictEqual(measured, [[0, true]])
        assert.deepStrictEqual(ran, [])
        assert.deepStrictEqual(resolved, [["resolved", "cleanup.run hasn't run for 30 minutes"]])
        assert.deepStrictEqual(
          detail.incidents.map((incident) => incident.title),
          ["cleanup.run hasn't run for 30 minutes"],
        )
      }),
    ),
  )

  it.effect(
    "fires a monitor of an operation's chosen percentile or error rate above its numbers, of enough runs, and resolves it when removed",
    () =>
      inProject(
        "monitor-thresholds",
        start,
        Effect.gen(function* () {
          const projects = yield* Projects
          const incidents = yield* Incidents
          yield* projects.create(member, ProjectName.make("Notes"))
          yield* projects.addComponent(member, { key: api, name: ComponentName.make("Notes API") })
          // 10 card reads at 820 ms: enough for a p50, too few for a p95. 100 feed reads, 97 at 50 ms
          // and 3 at 2 s: a p95 of 50 ms and a p99 of 2 s. 20 syncs with 4 failed: 20%, too few for
          // the failing detector.
          yield* record(api, [release(taking(counts("GET /api/card", start - minute, 10), 820), "1.2.3")])
          yield* record(api, [
            spread(counts("GET /api/feed", start - minute, 100), [...Array(97).fill(50), 2000, 2000, 2000]),
          ])
          yield* record(api, [counts("POST /api/sync", start - minute, 20, 4)])
          // A split of 3 slow runs in each of two environments: none judged, though 6 in all.
          yield* record(api, [taking(counts("POST /api/split", start - minute, 3), 1000)])
          yield* record(api, [dev(taking(counts("POST /api/split", start - minute, 3), 1000))])
          const latency = (operationName: string, percentile: 50 | 95 | 99, ms: number) =>
            incidents.addMonitor(member, {
              component: api,
              condition: {
                _tag: "latencyAbove",
                subject: operation(operationName),
                percentile,
                ms,
                minutes: 15,
              },
              level: "alarm",
            })
          const slow = yield* latency("GET /api/card", 50, 500)
          // Another of the same operation, set higher: both fire, each its own incident.
          yield* latency("GET /api/card", 50, 600)
          // The card's p95, of 10 runs: unknown, never judged.
          const cardP95 = yield* latency("GET /api/card", 95, 500)
          // The feed's tail is slow, its p95 isn't.
          yield* latency("GET /api/feed", 99, 1000)
          yield* latency("GET /api/feed", 95, 1000)
          const split = yield* latency("POST /api/split", 50, 500)
          yield* incidents.addMonitor(member, {
            component: api,
            condition: { _tag: "errorRateAbove", subject: operation("POST /api/sync"), percent: 5, minutes: 15 },
            level: "quiet",
          })
          // Not above: the same numbers, set higher.
          yield* incidents.addMonitor(member, {
            component: api,
            condition: { _tag: "errorRateAbove", subject: operation("POST /api/sync"), percent: 20, minutes: 15 },
            level: "alarm",
          })

          const fired = (yield* checkAt(start)).map(([change, title]) => [
            change,
            title.replace(/(p\d\d) [\d.]+ (ms|s),/, "$1 ~,"),
          ])
          const states = (yield* incidents.monitors).monitors
          const measured = (id: string) => states.find((state) => state.monitor.id === id)?.measured
          const p50 = measured(slow.id)?.value
          const slowIncident = (yield* incidents.incidents).open.find((incident) =>
            incident.title.endsWith("above 500 ms"),
          )
          const ran = slowIncident === undefined ? [] : (yield* incidents.incident(slowIncident.id)).releases
          yield* incidents.removeMonitor(member, slow.id)
          const list = yield* incidents.incidents

          assert.deepStrictEqual(
            fired.toSorted(([, left], [, right]) => String(left).localeCompare(String(right))),
            [
              ["opened", "GET /api/card p50 ~, above 500 ms"],
              ["opened", "GET /api/card p50 ~, above 600 ms"],
              ["opened", "GET /api/feed p99 ~, above 1000 ms"],
              ["opened", "POST /api/sync: 20% failed, above 5%"],
            ],
          )
          assert.isTrue(p50 !== undefined && Math.abs(p50 - 820) <= 820 * 0.02)
          assert.isTrue(measured(cardP95.id) !== undefined && measured(cardP95.id)?.value === undefined)
          assert.isTrue(measured(split.id) !== undefined && measured(split.id)?.value === undefined)
          // A monitor of every environment: the release that ran in each.
          assert.deepStrictEqual(ran, [
            { environment: EnvironmentKey.make("production"), release: ReleaseVersion.make("1.2.3") },
          ])
          assert.deepStrictEqual(
            list.resolved.map((incident) => incident.subject),
            ["GET /api/card"],
          )
        }),
      ),
  )

  it.effect("fires a monitor of an app's event that came more times than its number in its window", () =>
    inProject(
      "monitor-event",
      start,
      Effect.gen(function* () {
        const projects = yield* Projects
        const incidents = yield* Incidents
        const apps = yield* AppSignals
        const ios = ComponentKey.make("notes-ios")
        yield* projects.create(member, ProjectName.make("Notes"))
        yield* projects.addComponent(member, { key: ios, name: ComponentName.make("Notes for iPhone") })
        yield* apps.record(
          { component: ios, key: SdkKey.make("cluenori-sdk.notes.notes-ios.R2d2C3poBb8Wq0Lk5Xz7Aa") },
          {
            installation: InstallationId.make(uuidAt(start - day, 1)),
            environment: EnvironmentKey.make("production"),
            release: ReleaseVersion.make("1.0.0+1"),
            device: { model: "iPhone17,2", platform: "iOS", osVersion: "27.2", locale: "en-US", timeZone: "UTC" },
            sdk: { name: "cluenori-swift", version: "0.1.0" },
            sentAt: DateTime.makeUnsafe(start),
            signals: [1, 2, 3].map((n) => ({
              _tag: "event" as const,
              id: AppSignalId.make(uuidAt(start - 10 * minute, n + 1)),
              at: DateTime.makeUnsafe(start - 10 * minute),
              session: SessionId.make(uuidAt(start - 10 * minute, n + 10)),
              name: EnvelopeName.make("payment.failed"),
            })),
          },
        )
        const event = { _tag: "event" as const, event: EnvelopeName.make("payment.failed") }
        yield* incidents.addMonitor(member, {
          component: ios,
          condition: { _tag: "moreThan", subject: event, count: 2, minutes: 60 },
          level: "timeSensitive",
        })
        yield* incidents.addMonitor(member, {
          component: ios,
          condition: { _tag: "moreThan", subject: event, count: 3, minutes: 60 },
          level: "timeSensitive",
        })

        assert.deepStrictEqual(yield* checkAt(start), [["opened", "payment.failed: 3 in 1 hour, more than 2"]])
      }),
    ),
  )

  it("refuses a monitor with numbers out of bounds, or a URL's with an environment", () => {
    const job = { _tag: "operation", operation: "cleanup.run" }
    const url = { _tag: "noAnswer", subject: { _tag: "url", url: "https://notes.test/health" } }
    assert.deepStrictEqual(
      [
        of({ _tag: "nothingFor", subject: job, minutes: 30 }),
        of({ _tag: "nothingFor", subject: job, minutes: 0 }),
        of({ _tag: "nothingFor", subject: job, minutes: 10_081 }),
        of({ _tag: "latencyAbove", subject: job, percentile: 95, ms: 500, minutes: 1441 }),
        of({ _tag: "latencyAbove", subject: job, percentile: 95, ms: Number.POSITIVE_INFINITY, minutes: 15 }),
        of({ _tag: "latencyAbove", subject: job, percentile: 90, ms: 500, minutes: 15 }),
        of({ _tag: "latencyAbove", subject: job, ms: 500, minutes: 15 }),
        of({ _tag: "errorRateAbove", subject: job, percent: 100, minutes: 15 }),
        of({ _tag: "moreThan", subject: job, count: 3, minutes: 15 }),
        of({ _tag: "moreThan", subject: { _tag: "error", error: "DROP TABLE" }, count: 3, minutes: 15 }),
        of(url, { environment: "production" }),
        of(url, { level: "loud" }),
        of({ _tag: "noAnswer", subject: { _tag: "url", url: "https://notes.test/\u0007" } }),
      ].map(decoded),
      [true, false, false, false, false, false, false, false, false, false, false, false, false],
    )
  })
})
