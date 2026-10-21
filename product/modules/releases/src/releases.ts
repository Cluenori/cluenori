import { Period } from "@cluenori/foundation"
import { Incidents } from "@cluenori/incidents"
import type { ErrorGroup, OperationTable, ReleaseRow } from "@cluenori/signals"
import { hourlyRetention, Signals } from "@cluenori/signals"
import { DateTime, Effect, Option } from "effect"

import type { ReleaseDetail, ReleaseKey, ReleaseList, ReleaseListQuery, ReleaseSummary } from "./release.ts"
import { ReleaseNotFound } from "./release.ts"
import type { Comparison } from "./verdict.ts"
import { compare, verdictOf } from "./verdict.ts"

// The most releases one list compares, the latest first seen first.
const listed = 30

const spanOf = (row: ReleaseRow) => new Period({ from: row.firstSeen, to: row.lastSeen })

const sameStream = (left: ReleaseRow, right: ReleaseRow) =>
  left.component === right.component && left.environment === right.environment

// Every release Signals keeps, the latest first seen first: one row each, so reading all of them to
// find each one's previous costs little.
const everyRelease = Effect.gen(function* () {
  const signals = yield* Signals
  const now = yield* DateTime.now
  const kept = new Period({ from: DateTime.subtractDuration(now, hourlyRetention), to: now })
  const table = yield* signals.releases({ period: kept })
  return table.rows
})

// The release before `row`: the latest first seen before it, of the same component and environment.
// Not handled: a release deployed again after a later one stays where it first ran; telling a
// rollback apart takes knowing deploys, which come with releases from git tags and stores.
const previousOf = (rows: ReadonlyArray<ReleaseRow>, row: ReleaseRow) =>
  rows.find(
    (other) =>
      sameStream(other, row) && DateTime.toEpochMillis(other.firstSeen) < DateTime.toEpochMillis(row.firstSeen),
  )

// A release's operations, and, beside the release before it, what moved and the errors first seen
// in it.
interface Compared {
  readonly current: OperationTable
  readonly comparison: Option.Option<Comparison>
  readonly newErrors: ReadonlyArray<ErrorGroup>
}

// One release compared with the one before it: its operations, what moved, and the errors first
// seen in it. Not handled: a component that reports no environment beside one that does, whose
// release would count both; that takes counts that filter by "no environment".
const compareRelease = Effect.fn("Releases.compareRelease")(function* (
  row: ReleaseRow,
  previous: ReleaseRow | undefined,
) {
  const signals = yield* Signals
  const scope = {
    component: row.component,
    ...(row.environment === undefined ? {} : { environment: row.environment }),
  }
  const current = yield* signals.operations({ period: spanOf(row), ...scope, release: row.release })
  if (previous === undefined) {
    const alone: Compared = { current, comparison: Option.none(), newErrors: [] }
    return alone
  }
  const before = yield* signals.operations({ period: spanOf(previous), ...scope, release: previous.release })
  const errors = yield* signals.errors({ period: spanOf(row), ...scope })
  const compared: Compared = {
    current,
    comparison: Option.some(compare(current, before)),
    newErrors: errors.groups.filter((group) => group.firstRelease === row.release),
  }
  return compared
})

const summaryOf = (row: ReleaseRow, previous: ReleaseRow | undefined, compared: Compared): ReleaseSummary => {
  const comparison = Option.getOrUndefined(compared.comparison)
  const ranMs = DateTime.toEpochMillis(row.lastSeen) - DateTime.toEpochMillis(row.firstSeen)
  return {
    component: row.component,
    ...(row.environment === undefined ? {} : { environment: row.environment }),
    release: row.release,
    firstSeen: row.firstSeen,
    lastSeen: row.lastSeen,
    count: compared.current.count,
    errors: compared.current.errors,
    ...(previous === undefined ? {} : { previous: previous.release }),
    verdict: verdictOf(comparison, compared.newErrors.length, ranMs),
    slower: comparison?.slower.length ?? 0,
    failingMore: comparison?.failingMore.length ?? 0,
    newErrors: compared.newErrors.length,
  }
}

/**
 * The releases that ran in the query's period, the latest first seen first, at most 30, each
 * compared with the release before it. Reads only: two operation tables and an error table a
 * release.
 */
export const listReleases = Effect.fn("Releases.list")(function* (query: ReleaseListQuery) {
  const rows = yield* everyRelease
  const from = DateTime.toEpochMillis(query.period.from)
  const to = DateTime.toEpochMillis(query.period.to)
  const inPeriod = rows
    .filter(
      (row) =>
        DateTime.toEpochMillis(row.lastSeen) > from &&
        DateTime.toEpochMillis(row.firstSeen) < to &&
        (query.component === undefined || row.component === query.component) &&
        (query.environment === undefined || row.environment === query.environment),
    )
    .slice(0, listed)
  const releases = yield* Effect.forEach(inPeriod, (row) => {
    const previous = previousOf(rows, row)
    return compareRelease(row, previous).pipe(Effect.map((compared) => summaryOf(row, previous, compared)))
  })
  const list: ReleaseList = { releases }
  return list
})

/**
 * One release compared with the one before it: what moved, the errors first seen in it, and the
 * incidents that opened while it ran; without an environment, of the one it last ran in. Fails with
 * `ReleaseNotFound` for a release Signals doesn't keep. Reads only.
 */
export const releaseDetail = Effect.fn("Releases.detail")(function* (key: ReleaseKey) {
  const rows = yield* everyRelease
  // Without an environment, the one it last ran in.
  const row = rows
    .filter(
      (each) =>
        each.component === key.component &&
        each.release === key.release &&
        (key.environment === undefined || each.environment === key.environment),
    )
    .reduce<ReleaseRow | undefined>(
      (latest, each) =>
        latest === undefined || DateTime.toEpochMillis(each.lastSeen) > DateTime.toEpochMillis(latest.lastSeen)
          ? each
          : latest,
      undefined,
    )
  if (row === undefined) {
    return yield* new ReleaseNotFound({ component: key.component, release: key.release })
  }
  const previous = previousOf(rows, row)
  const compared = yield* compareRelease(row, previous)
  const comparison = Option.getOrUndefined(compared.comparison)
  const incidents = yield* Incidents
  const list = yield* incidents.incidents
  const from = DateTime.toEpochMillis(row.firstSeen)
  const to = DateTime.toEpochMillis(row.lastSeen)
  const detail: ReleaseDetail = {
    summary: summaryOf(row, previous, compared),
    slower: comparison?.slower ?? [],
    failingMore: comparison?.failingMore ?? [],
    faster: comparison?.faster ?? [],
    failingLess: comparison?.failingLess ?? [],
    newOperations: comparison?.newOperations ?? [],
    newErrors: compared.newErrors,
    incidents: [...list.open, ...list.resolved].filter(
      (incident) =>
        incident.component === row.component &&
        // A monitor's incident has no environment: it is about the component wherever it runs.
        (incident.environment === undefined || incident.environment === row.environment) &&
        DateTime.toEpochMillis(incident.openedAt) >= from &&
        DateTime.toEpochMillis(incident.openedAt) < to,
    ),
  }
  return detail
})
