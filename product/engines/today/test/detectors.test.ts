import {
  ComponentKey,
  EnvelopeName,
  EnvironmentKey,
  Period,
  ProjectKey,
  ReleaseVersion,
  Uuidv7,
} from "@cluenori/foundation"
import type { IncidentList } from "@cluenori/incidents"
import { Incident, IncidentId } from "@cluenori/incidents"
import type { ErrorGroup, OperationRow, OperationTable } from "@cluenori/signals"
import { ErrorGroupId } from "@cluenori/signals"
import { assert, describe, it } from "@effect/vitest"
import { DateTime } from "effect"

import type { ProjectState, TodayItem } from "../src/index.ts"
import { itemsOf, sortToday } from "../src/index.ts"

// 2026-10-21T10:00:00Z.
const now = 1792576800000
const minute = 60_000
const hour = 60 * minute
const at = (millis: number) => DateTime.makeUnsafe(millis)
const notes = ProjectKey.make("notes")
const api = ComponentKey.make("notes-api")

const row = (operation: string, p95Ms: number): OperationRow => ({
  component: api,
  environment: EnvironmentKey.make("production"),
  operation: EnvelopeName.make(operation),
  count: 100,
  errors: 0,
  averageMs: p95Ms / 2,
  p50Ms: p95Ms / 2,
  p80Ms: p95Ms * 0.8,
  p95Ms,
  p99Ms: p95Ms * 1.2,
})

const table = (rows: ReadonlyArray<OperationRow>, dataUntil?: number): OperationTable => ({
  covered: new Period({ from: at(now - 8 * 24 * hour), to: at(now) }),
  rows,
  count: rows.reduce((sum, each) => sum + each.count, 0),
  errors: 0,
  ...(dataUntil === undefined ? {} : { dataUntil: at(dataUntil) }),
})

const error = (id: string, firstSeen: number, lastSeen: number): ErrorGroup => ({
  id: ErrorGroupId.make(id),
  kind: "exception",
  title: "NpgsqlException: Failed to connect",
  culprit: "Notes.Api.Exports.ExportStore.SaveAsync",
  occurrences: 12,
  firstSeen: at(firstSeen),
  lastSeen: at(lastSeen),
  lastComponent: api,
})

const incident = (id: string, openedAt: number, acknowledgedAt?: number) =>
  new Incident({
    id: IncidentId.make(`019a0f2e-5c1e-7d3a-9b2f-4e8a1c6d0f5${id}`),
    component: api,
    subject: "POST /api/export",
    title: "POST /api/export: 18% failed, usually 0.1%",
    evidence: {
      _tag: "failing",
      operation: EnvelopeName.make("POST /api/export"),
      failed: 18,
      count: 100,
      usualRate: 0.001,
    },
    openedAt: at(openedAt),
    ...(acknowledgedAt === undefined ? {} : { acknowledgedAt: at(acknowledgedAt) }),
  })

const quiet: ProjectState = {
  project: notes,
  incidents: { open: [], resolved: [], quiet: [] } satisfies IncidentList,
  errors: { groups: [], occurrences: 0 },
  operations: { lastDay: table([row("GET /api/notes", 80)], now), usual: table([row("GET /api/notes", 80)]) },
  components: 1,
  now,
}

// An operation that usually ran every 31 minutes, quiet since `lastRanAt`.
const quietOperation = (operation: string, lastRanAt: number) => ({
  component: ComponentKey.make("notes-api"),
  environment: EnvironmentKey.make("production"),
  operation: EnvelopeName.make(operation),
  usualGapMs: 31 * minute,
  lastRanAt: at(lastRanAt),
})

// A promotion of notes-ios to production, needing a member as `state` says.
const promotion = (
  id: string,
  state: "approved" | "waiting" | "failed" | "rejected" | "lost",
  startedAt: number,
  endedAt?: number,
): TodayItem => ({
  _tag: "promotion",
  project: notes,
  component: ComponentKey.make("notes-ios"),
  environment: EnvironmentKey.make("production"),
  release: ReleaseVersion.make("2.5.0+31"),
  promotion: Uuidv7.make(`019a0f2e-5c1e-7d3a-9b2f-4e8a1c6d0f6${id}`),
  state,
  startedAt: at(startedAt),
  ...(endedAt === undefined ? {} : { endedAt: at(endedAt) }),
})

const tags = (items: ReadonlyArray<TodayItem>) =>
  items.map((item) => {
    switch (item._tag) {
      case "incident":
        return `incident ${item.incident.id.slice(-1)}`
      case "promotion":
        return `promotion ${item.state}`
      case "quiet":
        return `quiet ${item.operation}`
      case "error":
      case "slower":
      case "silent":
        return `${item._tag} ${item.project}`
    }
  })

describe("itemsOf", () => {
  it("has nothing for a project going as usual", () => {
    assert.deepStrictEqual(itemsOf(quiet), [])
  })

  it("names an error new in the last day or seen in the last 15 minutes, and no older one", () => {
    const items = itemsOf({
      ...quiet,
      errors: {
        groups: [
          error("0000000000000001", now - 2 * hour, now - hour),
          error("0000000000000002", now - 3 * 24 * hour, now - 5 * minute),
          error("0000000000000003", now - 3 * 24 * hour, now - hour),
        ],
        occurrences: 36,
      },
    })
    assert.deepStrictEqual(
      items.map((item) => (item._tag === "error" ? [item.error.id, item.isNew, item.ongoing] : [])),
      [
        ["0000000000000001", true, false],
        ["0000000000000002", false, true],
      ],
    )
  })

  it("names an operation slower than over the 7 days before, by the rule's measure", () => {
    const items = itemsOf({
      ...quiet,
      operations: {
        lastDay: table([row("POST /api/export", 900), row("GET /api/notes", 30)], now),
        usual: table([row("POST /api/export", 300), row("GET /api/notes", 10)]),
      },
    })
    assert.deepStrictEqual(items, [
      {
        _tag: "slower",
        project: notes,
        component: api,
        environment: EnvironmentKey.make("production"),
        operation: EnvelopeName.make("POST /api/export"),
        p95Ms: 900,
        usualP95Ms: 300,
      },
    ])
  })

  it("names a project with components that sent nothing in the last day, with when it last did", () => {
    const silent = {
      ...quiet,
      operations: { lastDay: table([]), usual: table([row("GET /api/notes", 80)], now - 30 * hour) },
    }
    assert.deepStrictEqual(itemsOf(silent), [{ _tag: "silent", project: notes, lastDataAt: at(now - 30 * hour) }])
    // Without components, nothing is expected yet.
    assert.deepStrictEqual(itemsOf({ ...silent, components: 0 }), [])
  })
})

describe("sortToday", () => {
  it("puts incidents not acknowledged and errors happening now first, promotions before silence, the latest first", () => {
    const atlas = ProjectKey.make("atlas")
    const items = sortToday([
      { _tag: "silent", project: atlas },
      promotion("1", "approved", now - 3 * hour),
      promotion("2", "waiting", now - hour),
      promotion("3", "failed", now - 2 * hour, now - 30 * minute),
      ...itemsOf({
        ...quiet,
        incidents: {
          open: [incident("a", now - hour, now - minute), incident("b", now - 2 * hour), incident("c", now - minute)],
          resolved: [],
          quiet: [
            quietOperation("GET /api/sync", now - 3 * hour),
            quietOperation("POST /jobs/cleanup", now - 9 * hour),
          ],
        },
        errors: {
          groups: [
            error("0000000000000004", now - 2 * hour, now - hour),
            error("0000000000000005", now - 3 * 24 * hour, now - minute),
          ],
          occurrences: 24,
        },
        operations: {
          lastDay: table([row("POST /api/export", 900)], now),
          usual: table([row("POST /api/export", 300)]),
        },
      }),
    ])
    assert.deepStrictEqual(tags(items), [
      "incident c",
      "incident b",
      "error notes",
      "incident a",
      "error notes",
      "slower notes",
      // Quiet operations, guesses, after slower ones: the longest quiet first.
      "quiet POST /jobs/cleanup",
      "quiet GET /api/sync",
      // Then the promotion that ended or started latest first.
      "promotion failed",
      "promotion waiting",
      "promotion approved",
      "silent atlas",
    ])
  })
})
