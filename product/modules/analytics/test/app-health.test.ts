import type { ComponentKey } from "@cluenori/foundation"
import {
  ComponentKey as ComponentKeySchema,
  EnvironmentKey,
  InstallationId,
  Period,
  ReleaseVersion,
  SessionId,
} from "@cluenori/foundation"
import { SdkKey } from "@cluenori/projects"
import type { AppHealth, AppSignal } from "@cluenori/signals"
import { AppSignalId, AppSignals } from "@cluenori/signals"
import { assert, describe, it } from "@effect/vitest"
import { DateTime, Effect } from "effect"

import { analyticsModule, compareHealth, healthVerdictOf } from "../src/index.ts"
import { inProject } from "./in-object.ts"

// Thursday 2026-10-22, noon UTC.
const now = 1792670400000
const minute = 60_000
const hour = 60 * minute
const day = 24 * hour
const ios: ComponentKey = ComponentKeySchema.make("notes-ios")
const key = SdkKey.make("cluenori-sdk.notes.notes-ios.R2d2C3poBb8Wq0Lk5Xz7Aa")

const uuidAt = (millis: number, n: number) => {
  const time = millis.toString(16).padStart(12, "0")
  return `${time.slice(0, 8)}-${time.slice(8)}-7000-8000-${n.toString(16).padStart(12, "0")}`
}

/**
 * One release's batch: `sessions` sessions and `launches` cold launches of `launchMs` each, spread
 * from `from` to `to`, and a MetricKit report with `crashes` crashes of it.
 */
const releaseBatch = (
  release: string,
  installation: number,
  shape: {
    readonly from: number
    readonly to: number
    readonly sessions: number
    readonly launches: number
    readonly launchMs: number
    readonly crashes: number
  },
) => {
  const [version, build] = release.split("+")
  const step = (count: number) => (shape.to - shape.from) / Math.max(1, count - 1)
  const signals: Array<AppSignal> = []
  for (let n = 0; n < shape.sessions; n += 1) {
    const at = Math.round(shape.from + n * step(shape.sessions))
    signals.push({
      _tag: "session.started",
      id: AppSignalId.make(uuidAt(at, n)),
      at: DateTime.makeUnsafe(at),
      session: SessionId.make(uuidAt(at, 10_000 + n)),
    })
  }
  for (let n = 0; n < shape.launches; n += 1) {
    const at = Math.round(shape.from + n * step(shape.launches))
    signals.push({
      _tag: "app.launched",
      id: AppSignalId.make(uuidAt(at, 20_000 + n)),
      at: DateTime.makeUnsafe(at),
      session: SessionId.make(uuidAt(at, 10_000 + n)),
      start: "cold",
      prewarmed: false,
      firstFrameMs: shape.launchMs,
    })
  }
  signals.push({
    _tag: "metrickit",
    id: AppSignalId.make(uuidAt(shape.to, 30_000)),
    at: DateTime.makeUnsafe(shape.to),
    report: "diagnostics",
    payload: {
      appVersion: version,
      metaData: { appBuildVersion: build },
      crashDiagnostics: Array.from({ length: shape.crashes }, () => ({
        diagnosticMetaData: { appVersion: version, appBuildVersion: build, signal: 11 },
      })),
    },
  })
  return {
    installation: InstallationId.make(uuidAt(now - 400 * day, installation)),
    environment: EnvironmentKey.make("production"),
    release: ReleaseVersion.make(release),
    device: {
      model: "iPhone17,2",
      platform: "iOS" as const,
      osVersion: "27.2",
      locale: "en-US",
      timeZone: "Europe/Warsaw",
    },
    sdk: { name: "cluenori-swift", version: "0.1.0" },
    sentAt: DateTime.makeUnsafe(now),
    signals,
  }
}

const lastWeek = new Period({ from: DateTime.makeUnsafe(now - 7 * day), to: DateTime.makeUnsafe(now + minute) })

describe("app health", () => {
  it.effect("compares each release with the one before it: slower launches and more crashes are worse", () =>
    inProject(
      "health-verdicts",
      now,
      Effect.gen(function* () {
        const apps = yield* AppSignals
        const sender = { component: ios, key }
        yield* apps.record(
          sender,
          releaseBatch("0.2.0+10", 1, {
            from: now - 3 * day,
            to: now - day - hour,
            sessions: 250,
            launches: 60,
            launchMs: 800,
            crashes: 1,
          }),
        )
        yield* apps.record(
          sender,
          releaseBatch("0.3.0+20", 2, {
            from: now - day,
            to: now - 2 * hour,
            sessions: 250,
            launches: 60,
            launchMs: 1400,
            crashes: 8,
          }),
        )
        yield* apps.record(
          sender,
          releaseBatch("0.3.1+21", 3, {
            from: now - 90 * minute,
            to: now - 10 * minute,
            sessions: 250,
            launches: 60,
            launchMs: 700,
            crashes: 0,
          }),
        )
        yield* apps.record(
          sender,
          releaseBatch("0.4.0+30", 4, {
            from: now - 20 * minute,
            to: now - 5 * minute,
            sessions: 5,
            launches: 5,
            launchMs: 700,
            crashes: 0,
          }),
        )

        const { releases } = yield* analyticsModule.queries.appHealth.run({ period: lastWeek })
        assert.deepStrictEqual<unknown>(
          releases.map((row) => [row.release.release, row.release.previous, row.verdict, row.worse, row.better]),
          [
            ["0.4.0+30", "0.3.1+21", "tooEarly", [], []],
            ["0.3.1+21", "0.3.0+20", "better", [], ["coldLaunch", "crashes"]],
            ["0.3.0+20", "0.2.0+10", "worse", ["coldLaunch", "crashes"], []],
            ["0.2.0+10", undefined, "first", [], []],
          ],
        )
        const worse = releases[2]
        assert.strictEqual(worse?.crashesPerThousand, 32)
        assert.strictEqual(worse?.previousCrashesPerThousand, 4)
        assert.strictEqual(worse?.hangsPerThousand, 0)
        assert.strictEqual(worse?.health.cold?.launches, 60)
        assert.closeTo(worse?.health.cold?.firstFrameP95Ms ?? 0, 1400, 28)
        assert.closeTo(worse?.previousHealth?.cold?.firstFrameP95Ms ?? 0, 800, 16)
      }),
    ),
  )
})

const health = (overrides: Partial<AppHealth>): AppHealth => ({
  sessions: 300,
  people: 50,
  prewarmed: 0,
  ...overrides,
})
const memory = (peakMegabytes: number, samples = 60) => ({
  samples,
  peakP95Bytes: peakMegabytes * 1_000_000,
  footprintP95Bytes: peakMegabytes * 800_000,
})

describe("health rules", () => {
  it("calls peak memory higher at 1.25 times and 50 MB more", () => {
    assert.deepStrictEqual(compareHealth(health({ memory: memory(250) }), health({ memory: memory(200) })).worse, [
      "memory",
    ])
    assert.deepStrictEqual(compareHealth(health({ memory: memory(240) }), health({ memory: memory(200) })).worse, [])
    // 1.5 times, but only 30 MB more: a small app's memory moves that much.
    assert.deepStrictEqual(compareHealth(health({ memory: memory(90) }), health({ memory: memory(60) })).worse, [])
  })

  it("doesn't compare what too few launches, measurements or sessions measured", () => {
    const comparison = compareHealth(
      health({
        sessions: 150,
        memory: memory(400, 49),
        cold: { launches: 49, firstFrameP50Ms: 3000, firstFrameP95Ms: 4000 },
        diagnostics: { reports: 1, crashes: 20, hangs: 0, cpuExceptions: 0, diskWriteExceptions: 0 },
      }),
      health({
        memory: memory(100),
        cold: { launches: 200, firstFrameP50Ms: 300, firstFrameP95Ms: 400 },
        diagnostics: { reports: 1, crashes: 0, hangs: 0, cpuExceptions: 0, diskWriteExceptions: 0 },
      }),
    )
    assert.deepStrictEqual([comparison.worse, comparison.compared], [[], 0])
    assert.strictEqual(healthVerdictOf(health({ sessions: 150 }), comparison, 5 * hour), "tooEarly")
  })

  it("leaves crashes uncompared until MetricKit reported of both releases", () => {
    const reported = { reports: 1, crashes: 30, hangs: 0, cpuExceptions: 0, diskWriteExceptions: 0 }
    assert.deepStrictEqual(compareHealth(health({ diagnostics: reported }), health({})).compared, 0)
  })
})
