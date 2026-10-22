import type { Actor } from "@cluenori/foundation"
import { ComponentKey, EnvelopeName, EnvironmentKey, MemberId, Period, ReleaseVersion } from "@cluenori/foundation"
import { Incidents, MonitorUrl } from "@cluenori/incidents"
import { ComponentName, ProjectName, Projects } from "@cluenori/projects"
import { SketchValue, sketchOf } from "@cluenori/quantile-sketch"
import type { OperationCounts } from "@cluenori/signals"
import { BatchDigest, ErrorGroupId, Signals } from "@cluenori/signals"
import { assert, describe, it } from "@effect/vitest"
import { DateTime, Effect } from "effect"
import { TestClock } from "effect/testing"

import { ReleaseNotFound, releasesModule } from "../src/index.ts"
import { inProject } from "./in-object.ts"

// 2026-10-21T10:00:00Z, on a minute.
const start = 1792576800000
const minute = 60_000
const hour = 60 * minute

const api = ComponentKey.make("notes-api")
const production = EnvironmentKey.make("production")
const older = ReleaseVersion.make("2026.10.20-a1b2c3d")
const newer = ReleaseVersion.make("2026.10.21-e91f09c")
const member: Actor = { _tag: "Member", id: MemberId.make("0199f7a2-5c1e-7d3a-9b2f-4e8a1c6d0f53") }

// `count` runs of `operation` by `release`, each taking `ms`, `errors` of them failed, in the
// minute starting at `at`.
const counts = (
  release: ReleaseVersion,
  operation: string,
  at: number,
  count: number,
  { ms = 20, errors = 0 }: { readonly ms?: number; readonly errors?: number } = {},
): OperationCounts => ({
  bucket: DateTime.makeUnsafe(at - (at % minute)),
  operation: EnvelopeName.make(operation),
  environment: production,
  release,
  count,
  errors,
  totalMs: count * ms,
  durations: sketchOf(Array.from({ length: count }, () => SketchValue.make(ms))),
})

let batches = 0
const digest = () => {
  batches += 1
  return BatchDigest.make(batches.toString(16).padStart(64, "0"))
}

// Records counts as a trace export of the API brings them.
const record = (entries: ReadonlyArray<OperationCounts>) =>
  Effect.gen(function* () {
    const signals = yield* Signals
    const at = yield* DateTime.now
    yield* signals.recordTraces(api, {
      digest: digest(),
      archive: new Uint8Array(0),
      from: at,
      to: at,
      spans: entries.length,
      counts: entries,
      kept: [],
      traces: [],
    })
  })

// Records an error that `release` logged at `at`, of the group `id`.
const recordError = (release: ReleaseVersion, id: string, at: number) =>
  Effect.gen(function* () {
    const signals = yield* Signals
    const time = DateTime.makeUnsafe(at)
    const error = ErrorGroupId.make(id)
    yield* signals.recordLogs(api, {
      digest: digest(),
      archive: new Uint8Array(0),
      from: time,
      to: time,
      records: 1,
      entries: [
        {
          time,
          level: "error",
          category: "Notes.Export",
          message: "Export failed",
          environment: production,
          release,
          error,
          attributes: {},
        },
      ],
      errors: [{ id: error, kind: "log", title: "Export failed", culprit: "Notes.Export" }],
      traces: [],
    })
  })

// Two hours of the older release, then `then` from the newer one, an hour after.
const twoReleases = (then: ReadonlyArray<OperationCounts>) =>
  record([
    counts(older, "GET /api/notes", start - 3 * hour, 300),
    counts(older, "GET /api/notes", start - 2 * hour, 300),
    counts(older, "POST /api/export", start - 2 * hour, 200),
    ...then,
  ])

const today = new Period({ from: DateTime.makeUnsafe(start - 6 * hour), to: DateTime.makeUnsafe(start) })
const list = releasesModule.queries.list.run({ period: today })
const detail = releasesModule.queries.release.run({ component: api, environment: production, release: newer })

describe("Releases", () => {
  it.effect("calls a release worse when an operation got slower than in the release before it", () =>
    inProject(
      "slower",
      start,
      Effect.gen(function* () {
        yield* twoReleases([
          counts(newer, "GET /api/notes", start - hour, 300, { ms: 250 }),
          counts(newer, "GET /api/notes", start - 10 * minute, 300, { ms: 250 }),
          counts(newer, "POST /api/export", start - 10 * minute, 200),
        ])
        const { releases } = yield* list
        const compared = yield* detail

        assert.deepStrictEqual(
          releases.map((release) => [release.release, release.previous, release.verdict, release.slower]),
          [
            [newer, older, "worse", 1],
            [older, undefined, "first", 0],
          ],
        )
        assert.deepInclude(releases[0], { count: 800, errors: 0, component: api, environment: production })
        assert.deepStrictEqual(
          compared.slower.map((row) => [row.operation, row.count, row.previousCount]),
          [[EnvelopeName.make("GET /api/notes"), 600, 600]],
        )
        assert.closeTo(compared.slower[0]?.p95Ms ?? 0, 250, 5)
        assert.closeTo(compared.slower[0]?.previousP95Ms ?? 0, 20, 1)
      }),
    ),
  )

  it.effect("calls a release worse when an operation fails three times as often", () =>
    inProject(
      "failing-more",
      start,
      Effect.gen(function* () {
        yield* twoReleases([
          counts(newer, "GET /api/notes", start - hour, 600),
          counts(newer, "POST /api/export", start - 10 * minute, 200, { errors: 12 }),
        ])
        const { releases } = yield* list
        const compared = yield* detail

        assert.deepInclude(releases[0], { verdict: "worse", failingMore: 1, slower: 0 })
        assert.deepStrictEqual(
          compared.failingMore.map((row) => [row.operation, row.errors, row.previousErrors]),
          [[EnvelopeName.make("POST /api/export"), 12, 0]],
        )
      }),
    ),
  )

  it.effect("calls a release worse for an error first seen in it, and lists the error", () =>
    inProject(
      "new-error",
      start,
      Effect.gen(function* () {
        yield* twoReleases([
          counts(newer, "GET /api/notes", start - hour, 300),
          counts(newer, "GET /api/notes", start - 10 * minute, 300),
        ])
        // One error the older release logged too, and one only the newer one did.
        yield* recordError(older, "aaaaaaaaaaaaaaaa", start - 2 * hour)
        yield* recordError(newer, "aaaaaaaaaaaaaaaa", start - 30 * minute)
        yield* recordError(newer, "bbbbbbbbbbbbbbbb", start - 20 * minute)
        const { releases } = yield* list
        const compared = yield* detail

        assert.deepInclude(releases[0], { verdict: "worse", newErrors: 1 })
        assert.deepStrictEqual(
          compared.newErrors.map((error) => [error.id, error.occurrences]),
          [[ErrorGroupId.make("bbbbbbbbbbbbbbbb"), 1]],
        )
      }),
    ),
  )

  it.effect("says the same when nothing moved, and better when an operation got faster", () =>
    Effect.gen(function* () {
      const same = yield* inProject(
        "same",
        start,
        twoReleases([
          counts(newer, "GET /api/notes", start - 90 * minute, 300, { ms: 22 }),
          counts(newer, "GET /api/notes", start - 10 * minute, 300, { ms: 22 }),
        ]).pipe(Effect.andThen(list)),
      )
      const better = yield* inProject(
        "better",
        start,
        Effect.gen(function* () {
          yield* record([
            counts(older, "GET /api/notes", start - 4 * hour, 300, { ms: 400 }),
            counts(older, "GET /api/notes", start - 3 * hour, 300, { ms: 400 }),
          ])
          yield* record([
            counts(newer, "GET /api/notes", start - 90 * minute, 300, { ms: 40 }),
            counts(newer, "GET /api/notes", start - 10 * minute, 300, { ms: 40 }),
          ])
          return yield* list
        }),
      )

      assert.strictEqual(same.releases[0]?.verdict, "same")
      assert.strictEqual(better.releases[0]?.verdict, "better")
    }),
  )

  it.effect("says it is too early for a release that ran under an hour, or whose operations ran too little", () =>
    Effect.gen(function* () {
      const young = yield* inProject(
        "young",
        start,
        twoReleases([counts(newer, "GET /api/notes", start - 10 * minute, 600)]).pipe(Effect.andThen(list)),
      )
      const quiet = yield* inProject(
        "quiet",
        start,
        twoReleases([
          counts(newer, "GET /api/notes", start - 2 * hour, 30),
          counts(newer, "GET /api/notes", start - 10 * minute, 30),
        ]).pipe(Effect.andThen(list)),
      )

      assert.deepStrictEqual([young.releases[0]?.verdict, quiet.releases[0]?.verdict], ["tooEarly", "tooEarly"])
    }),
  )

  it.effect("lists the incidents that opened while a release ran", () =>
    inProject(
      "incidents",
      start - 30 * minute,
      Effect.gen(function* () {
        const projects = yield* Projects
        const incidents = yield* Incidents
        yield* projects.create(member, ProjectName.make("Notes"))
        yield* projects.addComponent(member, { key: api, name: ComponentName.make("Notes API") })
        yield* twoReleases([
          counts(newer, "GET /api/notes", start - hour, 300),
          counts(newer, "GET /api/notes", start - 5 * minute, 300),
        ])
        yield* incidents.addMonitor(member, { component: api, url: MonitorUrl.make("https://notes.test/health") })
        yield* incidents.check
        yield* TestClock.setTime(start - 29 * minute)
        yield* incidents.check
        yield* TestClock.setTime(start)
        const compared = yield* detail

        assert.deepStrictEqual(
          compared.incidents.map((incident) => incident.subject),
          ["https://notes.test/health"],
        )
      }),
    ),
  )

  it.effect("fails with ReleaseNotFound for a release it never counted", () =>
    inProject(
      "unknown",
      start,
      Effect.gen(function* () {
        yield* twoReleases([])
        const unknown = yield* Effect.flip(
          releasesModule.queries.release.run({ component: api, release: ReleaseVersion.make("9.9.9") }),
        )
        // Without an environment, a release is the one it ran in.
        const anywhere = yield* releasesModule.queries.release.run({ component: api, release: older })

        assert.instanceOf(unknown, ReleaseNotFound)
        assert.strictEqual(anywhere.summary.environment, production)
      }),
    ),
  )
})
