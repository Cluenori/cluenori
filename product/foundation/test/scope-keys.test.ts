import { assert, describe, it } from "@effect/vitest"
import { Schema } from "effect"

import {
  ActivityName,
  CalendarDay,
  EnvelopeName,
  FeatureKey,
  ModuleKind,
  PersonId,
  ProcessName,
  ProjectKey,
  ReleaseVersion,
  Source,
  TraceId,
} from "../src/index.ts"

// Each rule, by the values it must accept and the ones it must refuse.
const rules = [
  {
    name: "ProjectKey",
    schema: ProjectKey,
    accepts: ["notes", "notes-ios", "v2", "x".repeat(40)],
    // "ıos" has the dotless ı that a Turkish locale makes of "I"; keys never depend on a locale.
    refuses: [
      "",
      "Notes",
      "1notes",
      "-notes",
      "notes-",
      "notes--ios",
      "notes_ios",
      "notes.ios",
      "notes ios",
      "ıos",
      "x".repeat(41),
    ],
  },
  {
    name: "FeatureKey",
    schema: FeatureKey,
    accepts: ["editor", "editor.export", "billing.trial-reminder.email"],
    refuses: ["", "editor.", ".editor", "editor..export", "Editor.export", "editor.export-", "x".repeat(101)],
  },
  {
    name: "ReleaseVersion",
    schema: ReleaseVersion,
    accepts: ["2.4.0", "2.4.0+312", "1.0.0-rc.1", "a1b2c3d", "2026.10.19", "V2"],
    refuses: ["", "2.4 beta", "-1.0", "notes-ios@2.4.0", "2.4/1", "x".repeat(65)],
  },
  {
    name: "TraceId",
    schema: TraceId,
    accepts: ["4bf92f3577b34da6a3ce929d0e0e4736"],
    refuses: [
      "0".repeat(32),
      "4BF92F3577B34DA6A3CE929D0E0E4736",
      "4bf92f3577b34da6a3ce929d0e0e473",
      "4bf92f35-77b3-4da6-a3ce-929d0e0e4736",
      "!4bf92f3577b34da6a3ce929d0e0e4736",
      "4bf92f3577b34da6a3ce929d0e0e4736!",
    ],
  },
  {
    name: "PersonId, like every ID",
    schema: PersonId,
    accepts: ["0199f7a2-5c1e-7d3a-9b2f-4e8a1c6d0f53"],
    refuses: [
      "0199F7A2-5C1E-7D3A-9B2F-4E8A1C6D0F53",
      "9b2f4e8a-1c6d-4f53-9b2f-4e8a1c6d0f53",
      "00000000-0000-0000-0000-000000000000",
      "user-42",
      "!0199f7a2-5c1e-7d3a-9b2f-4e8a1c6d0f53",
      "0199f7a2-5c1e-7d3a-9b2f-4e8a1c6d0f53!",
    ],
  },
  {
    name: "Source",
    schema: Source,
    accepts: ["otel", "sdk-ios", "module:releases"],
    refuses: ["", "module:", ":releases", "Module:releases", "module:releases:extra", "sdk ios"],
  },
  {
    name: "ActivityName",
    schema: ActivityName,
    accepts: ["release.published", "feedback.status_changed", "agent_run.finished"],
    refuses: ["release", "release.published.again", "Release.published", "feedback.status-changed", "x.".repeat(33)],
  },
  {
    name: "EnvelopeName",
    schema: EnvelopeName,
    accepts: ["export.completed", "POST /api/export/{id}", "Notes.Export"],
    refuses: ["", " export.completed", "export.completed ", "line\nbreak", "x".repeat(257)],
  },
  {
    name: "CalendarDay",
    schema: CalendarDay,
    accepts: ["1970-01-01", "2026-09-09", "2026-10-20", "2026-11-29", "2026-12-30", "2026-12-31"],
    refuses: [
      "!2026-10-21",
      "2026-10-21!",
      "6-10-21",
      "yyyy-10-21",
      "2026-00-21",
      "2026-13-21",
      "2026-10-00",
      "2026-10-40",
      "2026-10-2x",
      "2026-10-32",
    ],
  },
  {
    name: "ProcessName",
    schema: ProcessName,
    accepts: ["releases.store-sync", "incidents", "a".repeat(100)],
    refuses: ["", "Releases.store-sync", "releases..sync", "releases.sync-", "a".repeat(101)],
  },
  {
    name: "ModuleKind",
    schema: ModuleKind,
    accepts: ["uptime.check", "feedback.status_changed", `a.${"b".repeat(62)}`],
    refuses: ["", "metric", "Uptime.check", "uptime.check.again", `a.${"b".repeat(63)}`],
  },
]

describe("scope keys, IDs and names", () => {
  for (const rule of rules) {
    it(`${rule.name} accepts ${rule.accepts.join(", ")}`, () => {
      const is = Schema.is(rule.schema)
      for (const value of rule.accepts) {
        assert.isTrue(is(value), value)
      }
    })

    it(`${rule.name} refuses what breaks its rule`, () => {
      const is = Schema.is(rule.schema)
      for (const value of rule.refuses) {
        assert.isFalse(is(value), value)
      }
    })
  }
})
