import {
  ComponentKey,
  EnvelopeName,
  EnvironmentKey,
  FeatureKey,
  InstallationId,
  Period,
  ReleaseVersion,
  SessionId,
} from "@cluenori/foundation"
import { SdkKey } from "@cluenori/projects"
import { assert, describe, it } from "@effect/vitest"
import { DateTime, Effect, Schema } from "effect"
import { SqlClient } from "effect/sql"
import { TestClock } from "effect/testing"

import type { AppBatch, AppSignal } from "../src/index.ts"
import { AppSignalId, AppSignals, AppUserId, Signals } from "../src/index.ts"
import { dropScreensAndOrigins, inApps } from "./in-object.ts"

// Thursday 2026-10-22, noon UTC: the week started on Monday the 19th.
const now = 1792670400000
const hour = 3_600_000
const day = 86_400_000
const ios = ComponentKey.make("notes-ios")
const production = EnvironmentKey.make("production")
const key = SdkKey.make("cluenori-sdk.notes.notes-ios.R2d2C3poBb8Wq0Lk5Xz7Aa")
const sender = { component: ios, key }
const lastDays = (count: number) =>
  new Period({ from: DateTime.makeUnsafe(now - count * day), to: DateTime.makeUnsafe(now + hour) })

// A UUIDv7 made at `millis`, the `n`th: IDs of signals, sessions and installations.
const uuidAt = (millis: number, n: number) => {
  const time = millis.toString(16).padStart(12, "0")
  return `${time.slice(0, 8)}-${time.slice(8)}-7000-8000-${n.toString(16).padStart(12, "0")}`
}
const installationOf = (n: number) => InstallationId.make(uuidAt(now - 400 * day, n))
const sessionAt = (at: number, n: number) => SessionId.make(uuidAt(at, n))

// One session at `at`: it starts, shows a screen, and ends 5 minutes later, signed in as `user` if
// given. `n` keeps its IDs apart from others at the same time.
const sessionSignals = (at: number, n: number, user?: string): ReadonlyArray<AppSignal> => {
  const session = sessionAt(at, n)
  const signed = user === undefined ? {} : { user: AppUserId.make(user) }
  return [
    {
      _tag: "session.started",
      id: AppSignalId.make(uuidAt(at, n * 10 + 1)),
      at: DateTime.makeUnsafe(at),
      session,
      ...signed,
    },
    {
      _tag: "screen",
      id: AppSignalId.make(uuidAt(at + 1000, n * 10 + 2)),
      at: DateTime.makeUnsafe(at + 1000),
      session,
      screen: EnvelopeName.make("card"),
      ...signed,
    },
    {
      _tag: "session.ended",
      id: AppSignalId.make(uuidAt(at + 300_000, n * 10 + 3)),
      at: DateTime.makeUnsafe(at + 300_000),
      session,
      foregroundMs: 300_000,
      ...signed,
    },
  ]
}

const batchOf = (
  installation: InstallationId,
  signals: ReadonlyArray<AppSignal>,
  options: { readonly release?: string; readonly sentAt?: number } = {},
): AppBatch => ({
  installation,
  environment: production,
  release: ReleaseVersion.make(options.release ?? "0.3.0+20"),
  device: { model: "iPhone17,2", platform: "iOS", osVersion: "27.2", locale: "uk-UA", timeZone: "Europe/Kyiv" },
  sdk: { name: "cluenori-swift", version: "0.1.0" },
  sentAt: DateTime.makeUnsafe(options.sentAt ?? now),
  signals: [...signals],
})

const record = (batch: AppBatch) =>
  Effect.gen(function* () {
    const apps = yield* AppSignals
    return yield* apps.record(sender, batch)
  })

describe("AppSignals", () => {
  it.effect("records a batch once when it is sent again, and counts its new signals", () =>
    inApps(
      "apps-duplicates",
      now,
      Effect.gen(function* () {
        const apps = yield* AppSignals
        const installation = installationOf(1)
        const signals = sessionSignals(now - hour, 1, "u-1")
        const first = yield* record(batchOf(installation, signals))
        const again = yield* record(batchOf(installation, signals, { sentAt: now + 1000 }))
        const more = sessionSignals(now - 30 * 60_000, 2, "u-1")
        const mixed = yield* record(batchOf(installation, [...signals.slice(0, 2), ...more.slice(0, 1)]))
        assert.deepStrictEqual(
          [first, again, mixed],
          [
            { accepted: 3, duplicates: 0 },
            { accepted: 0, duplicates: 3 },
            { accepted: 1, duplicates: 2 },
          ],
        )
        const usage = yield* apps.usage({ period: lastDays(1) })
        assert.deepStrictEqual([usage.people, usage.installations, usage.sessions], [1, 1, 2])
      }),
    ),
  )

  it.effect("counts daily, weekly and monthly people, and sessions per person, by day", () =>
    inApps(
      "apps-usage",
      now,
      Effect.gen(function* () {
        const apps = yield* AppSignals
        const signedIn = installationOf(1)
        const anonymous = installationOf(2)
        const once = installationOf(3)
        const iPad = installationOf(4)
        // Ten days of two sessions a day on one phone; an anonymous phone the last three days; another
        // person once five days ago; and the first person's iPad yesterday.
        for (const ago of [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]) {
          const at = now - ago * day - 2 * hour
          yield* record(batchOf(signedIn, [...sessionSignals(at, 1, "u-1"), ...sessionSignals(at + hour, 2, "u-1")]))
        }
        for (const ago of [2, 1, 0]) {
          yield* record(batchOf(anonymous, sessionSignals(now - ago * day - 3 * hour, 3)))
        }
        yield* record(batchOf(once, sessionSignals(now - 5 * day, 4, "u-2")))
        yield* record(batchOf(iPad, sessionSignals(now - day - 4 * hour, 5, "u-1"), { release: "0.3.1+21" }))

        const usage = yield* apps.usage({ period: lastDays(30) })
        assert.strictEqual(usage.days.length, 10, "days before the first batch aren't counted")
        assert.strictEqual(
          DateTime.formatIso(usage.covered?.from ?? DateTime.makeUnsafe(0)),
          "2026-10-13T00:00:00.000Z",
        )
        const today = usage.days.at(-1)
        const yesterday = usage.days.at(-2)
        assert.deepStrictEqual(
          [today?.day, today?.people, today?.installations, today?.sessions, today?.foregroundMs],
          ["2026-10-22", 2, 2, 3, 900_000],
        )
        assert.deepStrictEqual([yesterday?.people, yesterday?.installations, yesterday?.sessions], [2, 3, 4])
        // A week's people need 7 counted days; a month's need 30, which these 10 don't have.
        assert.deepStrictEqual(
          usage.days.map((each) => each.weekPeople),
          [undefined, undefined, undefined, undefined, undefined, undefined, 2, 3, 3, 3],
        )
        assert.isTrue(usage.days.every((each) => each.monthPeople === undefined))
        assert.deepStrictEqual([usage.people, usage.installations, usage.sessions], [3, 4, 25])
        assert.strictEqual(usage.sessionsPerPerson, 25 / 3)
        // 10 days of the first person, 3 of the anonymous one, 1 of the second: 14 person-days.
        assert.strictEqual(usage.sessionsPerPersonDay, 25 / 14)
        assert.deepStrictEqual(
          usage.releases.map((each) => [each.release, each.people, each.installations, each.sessions]),
          [
            ["0.3.0+20", 3, 3, 24],
            ["0.3.1+21", 1, 1, 1],
          ],
        )
        const ofRelease = yield* apps.usage({ period: lastDays(30), release: ReleaseVersion.make("0.3.1+21") })
        assert.deepStrictEqual([ofRelease.people, ofRelease.sessions], [1, 1])
        const nothingYet = yield* apps.usage({ period: lastDays(30), component: ComponentKey.make("notes-android") })
        assert.deepStrictEqual([nothingYet.covered, nothingYet.days, nothingYet.people], [undefined, [], 0])
      }),
    ),
  )

  it.effect("finds each month's people over 30 counted days", () =>
    inApps(
      "apps-monthly",
      now,
      Effect.gen(function* () {
        const apps = yield* AppSignals
        yield* record(batchOf(installationOf(1), sessionSignals(now - 40 * day, 1, "u-1")))
        yield* record(batchOf(installationOf(2), sessionSignals(now - 20 * day, 2, "u-2")))
        yield* record(batchOf(installationOf(3), sessionSignals(now - hour, 3, "u-3")))
        const usage = yield* apps.usage({ period: lastDays(1) })
        assert.deepStrictEqual<unknown>(
          usage.days.map((each) => [each.day, each.people, each.weekPeople, each.monthPeople]),
          [
            ["2026-10-21", 0, 0, 1],
            ["2026-10-22", 1, 1, 2],
          ],
        )
      }),
    ),
  )

  it.effect("groups people into weekly cohorts by the week each was first seen", () =>
    inApps(
      "apps-retention",
      now,
      Effect.gen(function* () {
        const apps = yield* AppSignals
        // Three people first seen on Tuesday the 13th, two back on Tuesday the 20th; one new on the 20th.
        for (const n of [1, 2, 3]) {
          yield* record(batchOf(installationOf(n), sessionSignals(now - 9 * day, n, `u-${n}`)))
        }
        for (const n of [1, 2, 4]) {
          yield* record(batchOf(installationOf(n), sessionSignals(now - 2 * day, n + 10, `u-${n}`)))
        }
        const retention = yield* apps.retention({ period: lastDays(30) })
        assert.strictEqual(retention.currentWeek, "2026-10-19")
        assert.deepStrictEqual<unknown>(
          retention.cohorts.map((cohort) => [cohort.week, cohort.people, cohort.active]),
          [
            ["2026-10-12", 3, [3, 2]],
            ["2026-10-19", 1, [1]],
          ],
        )
      }),
    ),
  )

  it.effect("measures each release's launches, memory, and MetricKit's crashes and hangs", () =>
    inApps(
      "apps-health",
      now,
      Effect.gen(function* () {
        const apps = yield* AppSignals
        const phone = installationOf(1)
        const at = now - 2 * hour
        const session = sessionAt(at, 1)
        const id = (n: number) => AppSignalId.make(uuidAt(at, n))
        const time = DateTime.makeUnsafe(at)
        yield* record(batchOf(phone, sessionSignals(now - 3 * day, 9, "u-1"), { release: "0.2.0+10" }))
        const signals: ReadonlyArray<AppSignal> = [
          ...[900, 1000, 1100].map((ms, n): AppSignal => ({
            _tag: "app.launched",
            id: id(n + 1),
            at: time,
            session,
            start: "cold",
            prewarmed: false,
            firstFrameMs: ms,
            readyMs: ms + 500,
          })),
          ...[300, 320].map((ms, n): AppSignal => ({
            _tag: "app.launched",
            id: id(n + 10),
            at: time,
            session,
            start: "warm",
            prewarmed: false,
            firstFrameMs: ms,
          })),
          // A prewarmed launch's time isn't comparable: only counted.
          { _tag: "app.launched", id: id(20), at: time, session, start: "cold", prewarmed: true, firstFrameMs: 9000 },
          ...[100, 120].map((megabytes, n): AppSignal => ({
            _tag: "app.memory",
            id: id(n + 30),
            at: time,
            session,
            reason: "interval",
            footprintBytes: megabytes * 1_000_000,
            peakBytes: (megabytes + 50) * 1_000_000,
          })),
          {
            _tag: "metrickit",
            id: id(40),
            at: time,
            report: "diagnostics",
            payload: {
              timeStampBegin: "2026-10-21 00:00:00 +0000",
              crashDiagnostics: [
                { diagnosticMetaData: { appVersion: "0.3.0", appBuildVersion: "20", signal: 11 } },
                { diagnosticMetaData: { appVersion: "0.3.0", appBuildVersion: "20", signal: 6 } },
                { diagnosticMetaData: { appVersion: "0.2.0", appBuildVersion: "10", signal: 11 } },
              ],
              hangDiagnostics: [
                { diagnosticMetaData: { appVersion: "0.3.0", appBuildVersion: "20", hangDuration: "2 sec" } },
              ],
            },
          },
        ]
        const recorded = yield* record(batchOf(phone, signals))
        assert.deepStrictEqual(recorded, { accepted: signals.length, duplicates: 0 })

        const health = yield* apps.health({
          component: ios,
          environment: production,
          release: ReleaseVersion.make("0.3.0+20"),
        })
        assert.strictEqual(health.cold?.launches, 3)
        assert.closeTo(health.cold?.firstFrameP50Ms ?? 0, 1000, 20)
        assert.closeTo(health.cold?.ready?.p95Ms ?? 0, 1600, 32)
        assert.strictEqual(health.warm?.launches, 2)
        assert.strictEqual(health.warm?.ready, undefined)
        assert.strictEqual(health.prewarmed, 1)
        assert.strictEqual(health.memory?.samples, 2)
        assert.closeTo(health.memory?.peakP95Bytes ?? 0, 170_000_000, 3_400_000)
        assert.deepStrictEqual(health.diagnostics, {
          reports: 1,
          crashes: 2,
          hangs: 1,
          cpuExceptions: 0,
          diskWriteExceptions: 0,
        })
        const older = yield* apps.health({
          component: ios,
          environment: production,
          release: ReleaseVersion.make("0.2.0+10"),
        })
        assert.deepStrictEqual(
          [older.sessions, older.people, older.diagnostics?.crashes, older.cold],
          [1, 1, 1, undefined],
        )

        const { releases } = yield* apps.releases({ period: lastDays(7) })
        assert.deepStrictEqual(
          releases.map((each) => [each.release, each.previous]),
          [
            ["0.3.0+20", "0.2.0+10"],
            ["0.2.0+10", undefined],
          ],
        )
      }),
    ),
  )

  it.effect("counts each feature's people, events, screens and memory, and those of no feature", () =>
    inApps(
      "apps-features",
      now,
      Effect.gen(function* () {
        const apps = yield* AppSignals
        const flip = FeatureKey.make("cards.flip")
        for (const n of [1, 2]) {
          const at = now - n * hour
          const session = sessionAt(at, n)
          yield* record(
            batchOf(installationOf(n), [
              { _tag: "session.started", id: AppSignalId.make(uuidAt(at, 1)), at: DateTime.makeUnsafe(at), session },
              {
                _tag: "screen",
                id: AppSignalId.make(uuidAt(at, 2)),
                at: DateTime.makeUnsafe(at),
                session,
                screen: EnvelopeName.make("card"),
                feature: flip,
              },
              {
                _tag: "event",
                id: AppSignalId.make(uuidAt(at, 3)),
                at: DateTime.makeUnsafe(at),
                session,
                name: EnvelopeName.make("card.flipped"),
                feature: flip,
              },
              {
                _tag: "app.memory",
                id: AppSignalId.make(uuidAt(at, 4)),
                at: DateTime.makeUnsafe(at),
                session,
                feature: flip,
                reason: "warning",
                footprintBytes: 200_000_000,
                peakBytes: 250_000_000,
              },
            ]),
          )
        }
        yield* record(batchOf(installationOf(3), sessionSignals(now - hour, 3)))
        const { features } = yield* apps.features({ period: lastDays(1) })
        assert.deepStrictEqual(
          features.map((each) => [each.feature, each.people, each.events, each.screens, each.memory?.samples]),
          [
            [undefined, 3, 0, 1, undefined],
            [flip, 2, 2, 2, 2],
          ],
        )
      }),
    ),
  )

  it.effect("measures each screen's readiness, visits, CPU time, hitches and hangs, and the apps' timings", () =>
    inApps(
      "apps-screens",
      now,
      Effect.gen(function* () {
        const apps = yield* AppSignals
        const at = now - hour
        const session = sessionAt(at, 1)
        let n = 0
        // Each signal's own ID and time, a millisecond apart, in the one session.
        const next = () => {
          n += 1
          return { id: AppSignalId.make(uuidAt(at, n)), at: DateTime.makeUnsafe(at + n), session }
        }
        const card = EnvelopeName.make("card")
        const feed = EnvelopeName.make("feed")
        const visit = AppSignalId.make(uuidAt(at, 99))
        yield* record(
          batchOf(installationOf(1), [
            { ...next(), _tag: "screen.ready", screen: card, visit, content: "kept", ms: 100 },
            { ...next(), _tag: "screen.ready", screen: card, visit, content: "kept", ms: 300 },
            { ...next(), _tag: "screen.ready", screen: card, visit, content: "fresh", ms: 900 },
            { ...next(), _tag: "screen.ready", screen: feed, visit, content: "fresh", ms: 400 },
            {
              ...next(),
              _tag: "screen.left",
              screen: card,
              visit,
              visibleMs: 60_000,
              cpuMs: 3_000,
              scrollMs: 10_000,
              hitchMs: 50,
            },
            { ...next(), _tag: "screen.left", screen: card, visit, visibleMs: 30_000, cpuMs: 1_500 },
            { ...next(), _tag: "screen.left", screen: feed, visit, visibleMs: 20_000 },
            // Longer than a day, which is left out: their sum would be no finite number.
            { ...next(), _tag: "screen.left", screen: feed, visit, visibleMs: 1e308 },
            { ...next(), _tag: "screen.left", screen: feed, visit, visibleMs: 1e308 },
            { ...next(), _tag: "app.hang", screen: card, ms: 400 },
            { ...next(), _tag: "app.hang", ms: 1_000 },
            ...[120, 80, 200].map((ms): AppSignal => ({
              ...next(),
              _tag: "timing",
              name: EnvelopeName.make("export.render"),
              ms,
            })),
          ]),
        )
        const { screens, timings } = yield* apps.screens({ period: lastDays(1) })
        assert.deepStrictEqual(
          screens.map((each) => [
            each.screen,
            each.readyKept?.count,
            each.readyFresh?.count,
            each.visible?.count,
            each.hangs?.count,
          ]),
          [
            [card, 2, 1, 2, 1],
            [feed, undefined, 1, 1, undefined],
            // A hang while no screen was named.
            [undefined, undefined, undefined, undefined, 1],
          ],
        )
        const [cardUse, feedUse, none] = screens
        assert.closeTo(cardUse?.readyKept?.p50Ms ?? 0, 100, 2)
        assert.closeTo(cardUse?.readyKept?.p95Ms ?? 0, 300, 6)
        assert.closeTo(cardUse?.readyFresh?.p50Ms ?? 0, 900, 18)
        // CPU over both visits' time in sight: 4.5 s in 90 s, so 3 s a minute; hitches only over the
        // visit that scrolled: 50 ms in 10 s, so 5 ms a second.
        assert.closeTo(cardUse?.cpuMsPerMinute ?? 0, 3_000, 0.001)
        assert.closeTo(cardUse?.hitchMsPerSecond ?? 0, 5, 0.001)
        assert.closeTo(cardUse?.hangs?.p50Ms ?? 0, 400, 8)
        // What the feed's visit didn't measure is unknown, not zero.
        assert.deepStrictEqual([feedUse?.cpuMsPerMinute, feedUse?.hitchMsPerSecond], [undefined, undefined])
        assert.closeTo(none?.hangs?.p95Ms ?? 0, 1_000, 20)
        assert.deepStrictEqual(
          timings.map((each) => [each.name, each.count]),
          [["export.render", 3]],
        )
        assert.closeTo(timings[0]?.p50Ms ?? 0, 120, 3)
        assert.closeTo(timings[0]?.p95Ms ?? 0, 200, 4)
        // Another component's screens are its own.
        const web = yield* apps.screens({ period: lastDays(1), component: ComponentKey.make("notes-web") })
        assert.deepStrictEqual(web, { screens: [], timings: [] })
      }),
    ),
  )

  it.effect("keeps an app's errors as its component's errors, by feature, an unhandled one fatal, once", () =>
    inApps(
      "apps-errors",
      now,
      Effect.gen(function* () {
        const signals = yield* Signals
        const at = now - hour
        const session = sessionAt(at, 1)
        const flip = FeatureKey.make("cards.flip")
        const batch = batchOf(installationOf(1), [
          {
            _tag: "error",
            id: AppSignalId.make(uuidAt(at, 1)),
            at: DateTime.makeUnsafe(at),
            session,
            feature: flip,
            screen: EnvelopeName.make("card"),
            type: "TypeError",
            message: "card is undefined",
            stack: "TypeError: card is undefined\n    at flip (https://notes.example/assets/card.js:12:5)",
            handled: true,
          },
          {
            _tag: "error",
            id: AppSignalId.make(uuidAt(at, 2)),
            at: DateTime.makeUnsafe(at + 1),
            session,
            type: "RangeError",
            message: "Invalid time value",
            handled: false,
          },
        ])
        yield* record(batch)
        // Sent again, the batch's errors are counted once.
        yield* record(batch)
        const all = yield* signals.errors({ period: lastDays(1), component: ios })
        assert.deepStrictEqual(
          all.groups.map((group) => [group.title, group.occurrences, group.lastComponent, group.lastRelease]),
          [
            ["RangeError: Invalid time value", 1, ios, "0.3.0+20"],
            ["TypeError: card is undefined", 1, ios, "0.3.0+20"],
          ],
        )
        const inFeature = yield* signals.errors({ period: lastDays(1), feature: flip })
        assert.deepStrictEqual(
          inFeature.groups.map((group) => group.title),
          ["TypeError: card is undefined"],
        )
        const page = yield* signals.logs({ period: lastDays(1), component: ios })
        assert.deepStrictEqual(
          page.lines
            .map((line) => [line.level, line.exception?.type])
            .toSorted((a, b) => String(a[0]).localeCompare(String(b[0]), "en")),
          [
            ["error", "TypeError"],
            ["fatal", "RangeError"],
          ],
        )
        // Past every retention, the next batch removes them, though no service sent anything since.
        const later = now + 456 * day
        yield* TestClock.setTime(later)
        yield* record(batchOf(installationOf(1), sessionSignals(later - hour, 3), { sentAt: later }))
        const sql = yield* SqlClient.SqlClient
        const kept = yield* sql<{ readonly n: number }>`
          SELECT (SELECT count(*) FROM signals_logs) + (SELECT count(*) FROM signals_error_groups) AS n`
        assert.strictEqual(kept[0]?.n, 0)
      }),
    ),
  )

  it.effect("counts one event of a component in a period, of one environment if asked, up to a limit", () =>
    inApps(
      "apps-event-count",
      now,
      Effect.gen(function* () {
        const apps = yield* AppSignals
        let n = 0
        const events = (at: number, name: string, count: number): ReadonlyArray<AppSignal> =>
          Array.from({ length: count }, () => {
            n += 1
            return {
              _tag: "event",
              id: AppSignalId.make(uuidAt(at, n)),
              at: DateTime.makeUnsafe(at),
              session: sessionAt(at, n),
              name: EnvelopeName.make(name),
            }
          })
        // Three registrations in the last hour, one just before it, one in beta, and other events.
        yield* record(batchOf(installationOf(1), events(now - 30 * 60_000, "user.registered", 3)))
        yield* record(batchOf(installationOf(2), events(now - hour - 60_000, "user.registered", 1)))
        yield* record(batchOf(installationOf(3), events(now - 10 * 60_000, "card.flipped", 4)))
        yield* record({
          ...batchOf(installationOf(4), events(now - 5 * 60_000, "user.registered", 2)),
          environment: EnvironmentKey.make("beta"),
        })
        const lastHour = DateTime.makeUnsafe(now - hour)
        const registered = EnvelopeName.make("user.registered")
        const counted = [
          yield* apps.eventCount({ since: lastHour, component: ios, environment: production, event: registered }, 100),
          yield* apps.eventCount({ since: lastHour, component: ios, event: registered }, 100),
          yield* apps.eventCount({ since: lastHour, component: ios, event: registered }, 2),
          yield* apps.eventCount(
            { since: DateTime.makeUnsafe(now - day), component: ios, environment: production, event: registered },
            100,
          ),
          yield* apps.eventCount(
            { since: lastHour, component: ComponentKey.make("notes-web"), event: registered },
            100,
          ),
        ]
        assert.deepStrictEqual(counted, [3, 5, 2, 4, 0])

        // The first person's 1,000 later signals trim their registrations from their timeline: they
        // count no more, but one still arrived in the hour, never none.
        for (let batch = 0; batch < 4; batch += 1) {
          yield* record(batchOf(installationOf(1), events(now - 20 * 60_000, "card.flipped", 250)))
        }
        assert.strictEqual(
          yield* apps.eventCount({ since: lastHour, component: ios, environment: production, event: registered }, 100),
          1,
        )
        // One that arrives after the moment a caller started from counts too, once it has arrived.
        yield* record(batchOf(installationOf(5), events(now + 5_000, "user.signedOut", 1)))
        assert.strictEqual(
          yield* apps.eventCount(
            { since: DateTime.makeUnsafe(now), component: ios, event: EnvelopeName.make("user.signedOut") },
            100,
          ),
          1,
        )
      }),
    ),
  )

  it.effect("knows an event arrived from the timelines kept before it counted when each last arrived", () =>
    Effect.gen(function* () {
      let n = 0
      const events = (at: number, name: string, count: number): ReadonlyArray<AppSignal> =>
        Array.from({ length: count }, () => {
          n += 1
          return {
            _tag: "event",
            id: AppSignalId.make(uuidAt(at, n)),
            at: DateTime.makeUnsafe(at),
            session: sessionAt(at, n),
            name: EnvelopeName.make(name),
          }
        })
      // A payment in a person's timeline, in a database from before migration 0014.
      yield* inApps(
        "apps-event-before",
        now,
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          yield* record(batchOf(installationOf(1), events(now - 11 * 60_000, "payment.completed", 1)))
          yield* sql`DROP INDEX signals_app_timeline_events`
          yield* sql`DROP TABLE signals_app_event_last`
          yield* dropScreensAndOrigins
          yield* sql`DELETE FROM signals_migrations WHERE migration_id >= 14`
        }).pipe(Effect.orDie),
      )
      // Migrated, then the same person's 1,000 later signals trim it from their timeline.
      const counted = yield* inApps(
        "apps-event-before",
        now,
        Effect.gen(function* () {
          const apps = yield* AppSignals
          for (let batch = 0; batch < 4; batch += 1) {
            yield* record(batchOf(installationOf(1), events(now - 5 * 60_000, "card.flipped", 250)))
          }
          return yield* apps.eventCount(
            {
              since: DateTime.makeUnsafe(now - 30 * 60_000),
              component: ios,
              event: EnvelopeName.make("payment.completed"),
            },
            100,
          )
        }),
      )
      assert.strictEqual(counted, 1)
    }),
  )

  it.effect("tells one feature's whole life: each day, everyone, who used it last, its releases", () =>
    inApps(
      "apps-feature-life",
      now,
      Effect.gen(function* () {
        const apps = yield* AppSignals
        const flip = FeatureKey.make("cards.flip")
        const sync = FeatureKey.make("cards.sync")
        let n = 0
        // `count` events of `feature` at `at`, by the person of `installation`, signed in as `user`.
        const events = (at: number, feature: FeatureKey, count: number, user?: string): ReadonlyArray<AppSignal> =>
          Array.from({ length: count }, () => {
            n += 1
            return {
              _tag: "event",
              id: AppSignalId.make(uuidAt(at, n)),
              at: DateTime.makeUnsafe(at),
              session: sessionAt(at, n),
              name: EnvelopeName.make("card.flipped"),
              feature,
              ...(user === undefined ? {} : { user: AppUserId.make(user) }),
            }
          })
        const signedIn = installationOf(1)
        const anonymous = installationOf(2)
        yield* record(batchOf(signedIn, events(now - 3 * day, flip, 1, "u-1")))
        yield* record(batchOf(anonymous, events(now - day, flip, 2), { release: "0.3.1+21" }))
        yield* record(batchOf(anonymous, events(now - day, sync, 4), { release: "0.3.1+21" }))
        yield* record(batchOf(signedIn, events(now - hour, flip, 1, "u-1"), { release: "0.3.1+21" }))
        yield* record({
          ...batchOf(installationOf(3), events(now - hour, flip, 5)),
          environment: EnvironmentKey.make("beta"),
        })

        const life = yield* apps.feature({ feature: flip, environment: production })
        assert.deepStrictEqual(
          life.days.map((each) => [each.day, each.people, each.events, each.screens]),
          [
            ["2026-10-19", 1, 1, 0],
            ["2026-10-21", 1, 2, 0],
            ["2026-10-22", 1, 1, 0],
          ],
        )
        assert.strictEqual(life.people, 2)
        const signedInPerson = (yield* apps.person({ _tag: "ByUser", user: AppUserId.make("u-1") })).person
        assert.deepStrictEqual(
          life.latestPeople.map((each) => [
            each.person === signedInPerson,
            each.users.join(),
            each.days,
            each.events,
            String(each.lastDay),
          ]),
          [
            [true, "u-1", 2, 2, "2026-10-22"],
            [false, "", 1, 2, "2026-10-21"],
          ],
        )
        assert.deepStrictEqual(
          life.releases.map((each) => [each.release, each.people, each.firstDay, each.lastDay]),
          [
            ["0.3.1+21", 2, "2026-10-21", "2026-10-22"],
            ["0.3.0+20", 1, "2026-10-19", "2026-10-19"],
          ],
        )
        assert.strictEqual(life.memory, undefined, "memory never measured in it is unknown, not zero")
        // Every environment's, beta's person too.
        assert.strictEqual((yield* apps.feature({ feature: flip })).people, 3)
        // A feature the apps never marked has no day and no one; `cards` isn't `cards.flip`.
        const never = yield* apps.feature({ feature: FeatureKey.make("cards") })
        assert.deepStrictEqual([never.days, never.people, never.latestPeople, never.releases], [[], 0, [], []])

        const person = yield* apps.person({ _tag: "ByPerson", person: signedInPerson })
        assert.deepStrictEqual(
          person.features.map((each) => [each.feature, each.days, each.events, String(each.lastDay)]),
          [[flip, 2, 2, "2026-10-22"]],
        )
      }),
    ),
  )

  it.effect("finds a person by user ID or by ID, with their installations, days and timeline", () =>
    inApps(
      "apps-person",
      now,
      Effect.gen(function* () {
        const apps = yield* AppSignals
        const phone = installationOf(1)
        // Anonymous at first, then signed in on the same phone: the history before stays theirs.
        yield* record(batchOf(phone, sessionSignals(now - day, 1)))
        yield* record(batchOf(phone, sessionSignals(now - hour, 2, "u-7")))
        yield* record(batchOf(installationOf(2), sessionSignals(now - 30 * 60_000, 3, "u-7"), { release: "0.3.1+21" }))

        const byUser = yield* apps.person({ _tag: "ByUser", user: AppUserId.make("u-7") })
        const byId = yield* apps.person({ _tag: "ByPerson", person: byUser.person })
        assert.deepStrictEqual(byId, byUser)
        assert.deepStrictEqual(byUser.users, [AppUserId.make("u-7")])
        assert.deepStrictEqual(
          byUser.installations.map((each) => [each.installation, each.release, each.device.model]),
          [
            [installationOf(2), "0.3.1+21", "iPhone17,2"],
            [phone, "0.3.0+20", "iPhone17,2"],
          ],
        )
        assert.deepStrictEqual(
          byUser.days.map((each) => [each.day, each.sessions]),
          [
            ["2026-10-22", 2],
            ["2026-10-21", 1],
          ],
        )
        assert.strictEqual(byUser.timeline.length, 9)
        assert.deepStrictEqual(
          byUser.timeline.slice(0, 3).map((entry) => entry.signal._tag),
          ["session.ended", "screen", "session.started"],
        )
        assert.isTrue(
          byUser.timeline.every((entry) => !("user" in entry.signal)),
          "the app's user ID isn't kept in the timeline",
        )
        const missing = yield* apps.person({ _tag: "ByUser", user: AppUserId.make("u-404") }).pipe(Effect.flip)
        assert.strictEqual(missing._tag, "PersonNotFound")
      }),
    ),
  )

  it.effect("keeps each person's latest 1,000 signals in their timeline", () =>
    inApps(
      "apps-timeline",
      now,
      Effect.gen(function* () {
        const apps = yield* AppSignals
        const phone = installationOf(1)
        const session = sessionAt(now - day, 1)
        const screens = (from: number, count: number): ReadonlyArray<AppSignal> =>
          Array.from({ length: count }, (_, index) => ({
            _tag: "screen",
            id: AppSignalId.make(uuidAt(now - day + (from + index) * 1000, from + index)),
            at: DateTime.makeUnsafe(now - day + (from + index) * 1000),
            session,
            screen: EnvelopeName.make("card"),
            user: AppUserId.make("u-1"),
          }))
        yield* record(batchOf(phone, screens(0, 500)))
        yield* record(batchOf(phone, screens(500, 500)))
        yield* record(batchOf(phone, screens(1000, 10)))
        const person = yield* apps.person({ _tag: "ByUser", user: AppUserId.make("u-1") })
        assert.strictEqual(person.timeline.length, 1000)
        const oldest = person.timeline.at(-1)
        assert.strictEqual(oldest === undefined ? 0 : DateTime.toEpochMillis(oldest.signal.at), now - day + 10_000)
      }),
    ),
  )

  it.effect("refuses batches past a key's or an installation's limit until the minute ends", () =>
    inApps(
      "apps-limits",
      now + 15_000,
      Effect.gen(function* () {
        const apps = yield* AppSignals
        const send = (installation: InstallationId, n: number) =>
          apps.record(sender, batchOf(installation, sessionSignals(now - hour, n))).pipe(Effect.result)
        const taken = [yield* send(installationOf(1), 1), yield* send(installationOf(1), 2)]
        const refused = yield* send(installationOf(1), 3)
        const another = yield* send(installationOf(2), 4)
        const pastKey = yield* send(installationOf(3), 5)
        assert.deepStrictEqual(
          taken.map((result) => result._tag),
          ["Success", "Success"],
        )
        const refusal = refused._tag === "Failure" ? refused.failure : undefined
        assert.deepStrictEqual(refusal?._tag === "TooManySignals" ? [refusal._tag, refusal.retryAfterSeconds] : [], [
          "TooManySignals",
          45,
        ])
        assert.strictEqual(another._tag, "Success")
        assert.strictEqual(pastKey._tag === "Failure" ? pastKey.failure._tag : "Success", "TooManySignals")
      }),
      { limits: { perKey: 3, perInstallation: 2 } },
    ),
  )

  it.effect("archives the new signals scrubbed, with each person instead of the app's user ID", () => {
    const files = new Map<string, string>()
    return inApps(
      "apps-archive",
      now,
      Effect.gen(function* () {
        const at = now - hour
        const session = sessionAt(at, 1)
        yield* record(
          batchOf(installationOf(1), [
            {
              _tag: "event",
              id: AppSignalId.make(uuidAt(at, 1)),
              at: DateTime.makeUnsafe(at),
              session,
              name: EnvelopeName.make("autograph.requested"),
              properties: { contact: "ann@example.com", count: 2 },
              user: AppUserId.make("u-secret-1"),
            },
          ]),
        )
        const [entry] = [...files.entries()]
        assert.isDefined(entry)
        const [path, json] = entry ?? ["", ""]
        assert.isTrue(path.startsWith(`main/apps-archive/2026-10-22/notes-ios/${installationOf(1)}/`))
        const archived = yield* Schema.decodeEffect(
          Schema.fromJsonString(
            Schema.Struct({ signals: Schema.Array(Schema.Struct({ person: Schema.String, signal: Schema.Unknown })) }),
          ),
        )(json)
        assert.strictEqual(archived.signals.length, 1)
        assert.isFalse(json.includes("u-secret-1"), "the app's user ID isn't archived")
        assert.isFalse(json.includes("ann@example.com"), "emails are scrubbed")
        assert.isTrue(json.includes("[email]"))
      }),
      { files },
    )
  })

  it.effect("corrects the times of a batch from a device whose clock is off", () =>
    inApps(
      "apps-clock",
      now,
      Effect.gen(function* () {
        const apps = yield* AppSignals
        // The device's clock is two days behind: it sent its batch "two days ago", an hour after recording it.
        const behind = now - 2 * day
        yield* record(batchOf(installationOf(1), sessionSignals(behind - hour, 1, "u-1"), { sentAt: behind }))
        const usage = yield* apps.usage({ period: lastDays(5) })
        assert.deepStrictEqual(
          usage.days.map((each) => [each.day, each.sessions]),
          [["2026-10-22", 1]],
        )
      }),
    ),
  )
})
