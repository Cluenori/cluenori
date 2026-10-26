import {
  ComponentKey,
  EnvelopeName,
  EnvironmentKey,
  FeatureKey,
  InstallationId,
  ReleaseVersion,
  SessionId,
} from "@cluenori/foundation"
import { SdkKey } from "@cluenori/projects"
import type { LogExport, TraceExport } from "@cluenori/signals"
import { AppSignalId, AppSignals, BatchDigest, ErrorGroupId, Signals } from "@cluenori/signals"
import { assert, describe, it } from "@effect/vitest"
import { DateTime, Effect } from "effect"

import { analyticsModule } from "../src/index.ts"
import { inProject } from "./in-object.ts"

// Thursday 2026-10-22, noon UTC.
const now = 1792670400000
const hour = 3_600_000
const day = 24 * hour
const ios = ComponentKey.make("notes-ios")
const api = ComponentKey.make("notes-api")
const production = EnvironmentKey.make("production")
const exportFeature = FeatureKey.make("editor.export")
const key = SdkKey.make("cluenori-sdk.notes.notes-ios.R2d2C3poBb8Wq0Lk5Xz7Aa")

const uuidAt = (millis: number, n: number) => {
  const time = millis.toString(16).padStart(12, "0")
  return `${time.slice(0, 8)}-${time.slice(8)}-7000-8000-${n.toString(16).padStart(12, "0")}`
}

const story = (feature: FeatureKey) => analyticsModule.queries.feature.run({ feature })

// One app event of editor.export at `at`, by installation `n`.
const useAt = (at: number, n: number) =>
  Effect.gen(function* () {
    const apps = yield* AppSignals
    yield* apps.record(
      { component: ios, key },
      {
        installation: InstallationId.make(uuidAt(now - 400 * day, n)),
        environment: production,
        release: ReleaseVersion.make("0.3.0+20"),
        device: { model: "iPhone17,2", platform: "iOS", osVersion: "27.2", locale: "uk-UA", timeZone: "Europe/Kyiv" },
        sdk: { name: "cluenori-swift", version: "0.1.0" },
        sentAt: DateTime.makeUnsafe(now),
        signals: [
          {
            _tag: "event",
            id: AppSignalId.make(uuidAt(at, n)),
            at: DateTime.makeUnsafe(at),
            session: SessionId.make(uuidAt(at, n + 100)),
            name: EnvelopeName.make("export.done"),
            feature: exportFeature,
          },
        ],
      },
    )
  })

describe("A feature's story", () => {
  it.effect("tells a feature only apps marked, with its services' parts empty, not missing", () =>
    inProject(
      "story-apps-only",
      now,
      Effect.gen(function* () {
        yield* useAt(now - 2 * day, 1)
        yield* useAt(now - hour, 2)
        const told = yield* story(exportFeature)
        assert.deepStrictEqual(
          told.use.days.map((each) => [each.day, each.people]),
          [
            ["2026-10-20", 1],
            ["2026-10-22", 1],
          ],
        )
        assert.strictEqual(told.use.people, 2)
        assert.deepStrictEqual([told.logs.days, told.logs.errors, told.operations], [[], [], []])
        assert.isDefined(told.logs.covered, "the 90 days of warnings and errors were looked at")
      }),
    ),
  )

  it.effect("tells a feature only services named: its warnings and errors by day, its errors, its operations", () =>
    inProject(
      "story-services-only",
      now,
      Effect.gen(function* () {
        const signals = yield* Signals
        const error = ErrorGroupId.make("4f1c9a2e7b3d5068")
        const named = { "cluenori.feature": exportFeature }
        const logs: LogExport = {
          digest: BatchDigest.make("a".repeat(64)),
          archive: new Uint8Array(0),
          from: DateTime.makeUnsafe(now - 3 * day),
          to: DateTime.makeUnsafe(now - hour),
          records: 4,
          entries: [
            {
              time: DateTime.makeUnsafe(now - 3 * day),
              level: "warn",
              category: "Export",
              message: "Slow",
              attributes: named,
            },
            {
              time: DateTime.makeUnsafe(now - hour),
              level: "error",
              category: "Export",
              message: "Export failed",
              error,
              attributes: named,
            },
            {
              time: DateTime.makeUnsafe(now - hour),
              level: "warn",
              category: "Export",
              message: "Retried",
              attributes: named,
            },
            // Another feature's, and one that named none.
            {
              time: DateTime.makeUnsafe(now - hour),
              level: "error",
              category: "Sync",
              message: "Sync failed",
              attributes: { "cluenori.feature": "cards.sync" },
            },
            { time: DateTime.makeUnsafe(now - hour), level: "warn", category: "Sync", message: "Slow", attributes: {} },
          ],
          errors: [{ id: error, kind: "log", title: "Export failed", culprit: "Export" }],
          traces: [],
        }
        yield* signals.recordLogs(api, logs)
        const traces: TraceExport = {
          digest: BatchDigest.make("b".repeat(64)),
          archive: new Uint8Array(0),
          from: DateTime.makeUnsafe(now - hour),
          to: DateTime.makeUnsafe(now - hour),
          spans: 3,
          counts: [],
          features: [
            {
              day: 20748,
              feature: exportFeature,
              operation: EnvelopeName.make("POST /api/exports"),
              count: 3,
              errors: 1,
            },
          ],
          kept: [],
          traces: [],
        }
        yield* signals.recordTraces(api, traces)

        const told = yield* story(exportFeature)
        assert.deepStrictEqual(told.use.days, [])
        assert.deepStrictEqual(
          told.logs.days.map((each) => [each.day, each.warnings, each.errors]),
          [
            ["2026-10-19", 1, 0],
            ["2026-10-22", 1, 1],
          ],
        )
        assert.deepStrictEqual(
          told.logs.errors.map((each) => [each.id, each.occurrences]),
          [[error, 1]],
        )
        assert.deepStrictEqual(
          told.operations.map((each) => [each.day, each.component, each.count, each.errors]),
          [["2026-10-22", api, 3, 1]],
        )
      }),
    ),
  )

  it.effect("says nothing kept names a feature, rather than telling an empty story", () =>
    inProject(
      "story-none",
      now,
      Effect.gen(function* () {
        yield* useAt(now - hour, 1)
        // editor.export was used; editor is another key.
        const missing = yield* story(FeatureKey.make("editor")).pipe(Effect.flip)
        assert.deepStrictEqual([missing._tag, missing.feature], ["FeatureNotFound", "editor"])
      }),
    ),
  )
})
