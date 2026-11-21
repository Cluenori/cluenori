import { sketchOf } from "@bagatka/quantile-sketch"
import {
  CalendarDay,
  ComponentKey,
  EnvelopeName,
  EnvironmentKey,
  InstallationId,
  ProcessName,
  ProjectKey,
  ReleaseVersion,
  SessionId,
} from "@cluenori/foundation"
import { ComponentName, ProjectName, Projects, SdkKey } from "@cluenori/projects"
import type { OperationCounts } from "@cluenori/signals"
import { AppSignalId, AppSignals, BatchDigest, Signals } from "@cluenori/signals"
import { assert, describe, it } from "@effect/vitest"
import { DateTime, Effect } from "effect"
import { TestClock } from "effect/testing"

import { Today } from "../src/index.ts"
import { inProject } from "./in-object.ts"

// 2026-10-22T10:37:00Z, deliberately not on an hour or day boundary.
const now = 1792665420000
const hour = 3_600_000
const day = 24 * hour
const currentHour = 1792663200000
const at = (millis: number) => DateTime.makeUnsafe(millis)
const api = ComponentKey.make("notes-api")
const blue = EnvironmentKey.make("blue")
const green = EnvironmentKey.make("green")
const staging = EnvironmentKey.make("staging")
const actor = { _tag: "System" as const, process: ProcessName.make("today.test") }

const operation = (
  bucket: number,
  count: number,
  errors: number,
  duration: number,
  environment?: EnvironmentKey,
): OperationCounts => ({
  bucket: at(bucket),
  operation: EnvelopeName.make("GET /notes"),
  count,
  errors,
  totalMs: count * duration,
  durations: sketchOf(Array.from({ length: count }, () => duration)).sketch,
  ...(environment === undefined ? {} : { environment }),
})

const record = (counts: ReadonlyArray<OperationCounts>) =>
  Effect.gen(function* () {
    const signals = yield* Signals
    yield* signals.recordTraces(api, {
      digest: BatchDigest.make("a".repeat(64)),
      archive: new Uint8Array(0),
      from: at(currentHour - 8 * day),
      to: at(now),
      spans: counts.reduce((sum, row) => sum + row.count, 0),
      counts,
      kept: [],
      traces: [],
    })
  })

// One app session, recorded at its own time so it isn't corrected as an offline device's clock.
const session = (time: number, n: number, environment: EnvironmentKey) =>
  Effect.gen(function* () {
    yield* TestClock.setTime(time)
    const apps = yield* AppSignals
    const id = `019a0f2e-5c1e-7000-8000-${n.toString(16).padStart(12, "0")}`
    yield* apps.record(
      { component: api, key: SdkKey.make("cluenori-sdk.notes.notes-api.R2d2C3poBb8Wq0Lk5Xz7Aa") },
      {
        installation: InstallationId.make(id),
        environment,
        release: ReleaseVersion.make("1.0.0"),
        device: { model: "browser", platform: "web", osVersion: "1", locale: "en", timeZone: "UTC" },
        sdk: { name: "cluenori-web", version: "0.1.0" },
        sentAt: at(time),
        signals: [{ _tag: "session.started", id: AppSignalId.make(id), at: at(time), session: SessionId.make(id) }],
      },
    )
  })

describe("Today", () => {
  it.effect("sums only production load in the current hour and 23 before it, and usage on whole UTC days", () =>
    inProject(
      "today-production-pulse",
      now,
      Effect.gen(function* () {
        const projects = yield* Projects
        yield* projects.create(actor, ProjectName.make("Notes"))
        yield* projects.updateSettings(actor, { productionEnvironments: [blue, green] })
        yield* record([
          operation(currentHour - 24 * hour, 50, 30, 10, blue),
          operation(currentHour - 23 * hour, 7, 2, 20, blue),
          operation(currentHour, 3, 1, 30, blue),
          operation(currentHour, 11, 4, 40, green),
          operation(currentHour, 100, 90, 50, staging),
          operation(currentHour + hour, 200, 150, 60, blue),
        ])
        // The same UTC day a week before yesterday, then yesterday, then today (not a whole day).
        yield* session(now - 8 * day, 1, blue)
        yield* session(now - day, 2, blue)
        yield* session(now - day, 3, blue)
        yield* session(now - day, 4, green)
        yield* session(now - day, 5, staging)
        yield* session(now, 6, green)
        const today = yield* Today
        const pulse = yield* today.pulse
        assert.deepStrictEqual(pulse, {
          project: ProjectKey.make("today-production-pulse"),
          load: [
            { start: at(currentHour - 23 * hour), count: 7, errors: 2 },
            { start: at(currentHour), count: 14, errors: 5 },
          ],
          people: {
            latest: {
              day: CalendarDay.make("2026-10-21"),
              people: 3,
              installations: 3,
              sessions: 3,
              foregroundMs: 0,
            },
            weekBefore: {
              day: CalendarDay.make("2026-10-14"),
              people: 1,
              installations: 1,
              sessions: 1,
              foregroundMs: 0,
            },
          },
        })
      }),
    ),
  )

  for (const environment of [undefined, staging]) {
    it.effect(`counts unnamed telemetry as production, but excludes staging: ${environment ?? "unnamed"}`, () =>
      inProject(
        `today-pulse-${environment ?? "unnamed"}`,
        now,
        Effect.gen(function* () {
          const projects = yield* Projects
          yield* projects.create(actor, ProjectName.make("Notes"))
          yield* projects.updateSettings(actor, { productionEnvironments: [blue] })
          yield* record([operation(currentHour, 5, 2, 10, environment)])
          const today = yield* Today
          assert.deepStrictEqual(yield* today.pulse, {
            project: ProjectKey.make(`today-pulse-${environment ?? "unnamed"}`),
            load: environment === undefined ? [{ start: at(currentHour), count: 5, errors: 2 }] : [],
          })
        }),
      ),
    )
  }

  it.effect("reports missing projects honestly, and an empty project's pulse without invented people", () =>
    inProject(
      "today-missing",
      now,
      Effect.gen(function* () {
        const today = yield* Today
        for (const question of [today.items.pipe(Effect.result), today.pulse.pipe(Effect.result)]) {
          const result = yield* question
          assert.strictEqual(result._tag, "Failure")
          if (result._tag === "Failure") {
            assert.strictEqual(result.failure._tag, "ProjectNotFound")
            assert.strictEqual(result.failure.project, "today-missing")
          }
        }
        const projects = yield* Projects
        yield* projects.create(actor, ProjectName.make("Notes"))
        assert.deepStrictEqual(yield* today.items, [])
        assert.deepStrictEqual(yield* today.pulse, { project: ProjectKey.make("today-missing"), load: [] })
      }),
    ),
  )

  it.effect("compares production operations across adjacent hour windows, ignoring staging and older counts", () =>
    inProject(
      "today-production-items",
      now,
      Effect.gen(function* () {
        const projects = yield* Projects
        yield* projects.create(actor, ProjectName.make("Notes"))
        yield* projects.addComponent(actor, { key: api, name: ComponentName.make("Notes API") })
        yield* projects.updateSettings(actor, { productionEnvironments: [blue] })
        yield* record([
          operation(currentHour - 24 * hour, 10, 0, 100, blue),
          operation(currentHour - 23 * hour, 10, 0, 800, blue),
          operation(currentHour, 10, 0, 800, blue),
          operation(currentHour - 24 * hour, 10, 0, 10, staging),
          operation(currentHour, 10, 0, 900, staging),
        ])
        const today = yield* Today
        const items = yield* today.items
        assert.strictEqual(items.length, 1)
        const [slower] = items
        assert.strictEqual(slower?._tag, "slower")
        if (slower?._tag === "slower") {
          assert.deepStrictEqual(
            [slower.project, slower.component, slower.environment, slower.operation],
            ["today-production-items", api, blue, "GET /notes"],
          )
          // Sketch percentiles are approximate, but these separated ranges cannot overlap.
          assert.isAbove(slower.p95Ms, 700)
          assert.isBelow(slower.p95Ms, 900)
          assert.isAbove(slower.usualP95Ms, 90)
          assert.isBelow(slower.usualP95Ms, 110)
        }
        yield* projects.updateSettings(actor, { productionEnvironments: [green] })
        assert.deepStrictEqual(yield* today.items, [
          {
            _tag: "silent",
            project: ProjectKey.make("today-production-items"),
            lastDataAt: at(currentHour - 23 * hour),
          },
        ])
      }),
    ),
  )
})
