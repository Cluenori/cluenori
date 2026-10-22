import { Period } from "@cluenori/foundation"
import { Incidents } from "@cluenori/incidents"
import { defaultProjectSettings, isProduction, Projects } from "@cluenori/projects"
import type { ErrorGroup, OperationTable, ReleaseRow } from "@cluenori/signals"
import { Signals } from "@cluenori/signals"
import { DateTime, Effect, Option } from "effect"

import type { KnownRelease } from "./catalog.ts"
import { knownReleases, previousOf } from "./catalog.ts"
import { ReleaseRecords } from "./records.ts"
import type {
  ReleaseDetail,
  ReleaseKey,
  ReleaseList,
  ReleaseListQuery,
  ReleaseSummary,
  SourceProblem,
} from "./release.ts"
import { ReleaseNotFound } from "./release.ts"
import type { Comparison } from "./verdict.ts"
import { compare, verdictOf } from "./verdict.ts"

// The most releases one list compares, the latest first.
const listed = 30

const spanOf = (ran: ReleaseRow) => new Period({ from: ran.firstSeen, to: ran.lastSeen })

// A release's operations, and, beside the release before it, what moved and the errors first seen
// in it; nothing for a release without telemetry.
interface Compared {
  readonly current: Option.Option<OperationTable>
  readonly comparison: Option.Option<Comparison>
  readonly newErrors: ReadonlyArray<ErrorGroup>
}

const unmeasured: Compared = { current: Option.none(), comparison: Option.none(), newErrors: [] }

// One release compared with the one before it that ran. Not handled: a component that reports no
// environment beside one that does, whose release would count both; that takes counts that filter
// by "no environment".
const compareRelease = Effect.fn("Releases.compareRelease")(function* (
  release: KnownRelease,
  baseline: KnownRelease | undefined,
) {
  const ran = release.ran
  if (ran === undefined) {
    return unmeasured
  }
  const signals = yield* Signals
  const scope = {
    component: release.component,
    ...(release.environment === undefined ? {} : { environment: release.environment }),
  }
  const current = yield* signals.operations({ period: spanOf(ran), ...scope, release: release.release })
  const before = baseline?.ran
  if (baseline === undefined || before === undefined) {
    const alone: Compared = { current: Option.some(current), comparison: Option.none(), newErrors: [] }
    return alone
  }
  const previous = yield* signals.operations({ period: spanOf(before), ...scope, release: baseline.release })
  const errors = yield* signals.errors({ period: spanOf(ran), ...scope, release: release.release })
  const compared: Compared = {
    current: Option.some(current),
    comparison: Option.some(compare(current, previous)),
    newErrors: errors.groups.filter((group) => group.firstRelease === release.release),
  }
  return compared
})

// The release before `release` that ran, which its telemetry compares with; none for one that
// didn't run.
const baselineOf = (releases: ReadonlyArray<KnownRelease>, release: KnownRelease) =>
  release.ran === undefined
    ? undefined
    : previousOf(
        releases.filter((each) => each.ran !== undefined),
        release,
      )

const summaryOf = Effect.fn("Releases.summaryOf")(function* (
  releases: ReadonlyArray<KnownRelease>,
  release: KnownRelease,
) {
  const records = yield* ReleaseRecords
  const baseline = baselineOf(releases, release)
  const previous = baseline ?? previousOf(releases, release)
  const compared = yield* compareRelease(release, baseline)
  const commits = yield* records.commits(release.component)
  const commit = commits.get(release.release)
  const comparison = Option.getOrUndefined(compared.comparison)
  const ran = release.ran
  const current = Option.getOrUndefined(compared.current)
  const summary: ReleaseSummary = {
    component: release.component,
    ...(release.environment === undefined ? {} : { environment: release.environment }),
    release: release.release,
    ...(ran === undefined ? {} : { firstSeen: ran.firstSeen, lastSeen: ran.lastSeen }),
    ...(current === undefined ? {} : { count: current.count, errors: current.errors }),
    ...(previous === undefined ? {} : { previous: previous.release }),
    verdict:
      ran === undefined
        ? "unmeasured"
        : verdictOf(
            comparison,
            compared.newErrors.length,
            DateTime.toEpochMillis(ran.lastSeen) - DateTime.toEpochMillis(ran.firstSeen),
          ),
    slower: comparison?.slower.length ?? 0,
    failingMore: comparison?.failingMore.length ?? 0,
    newErrors: compared.newErrors.length,
    ...(commit === undefined ? {} : { commit }),
    ...(release.store === undefined ? {} : { store: release.store }),
    ...(release.deploy === undefined ? {} : { deployedAt: release.deploy.deployedAt }),
  }
  return { summary, compared, previous }
})

// Whether a release did anything in [from, to): ran, was deployed, or was uploaded then.
const activeIn = (release: KnownRelease, from: number, to: number) => {
  const within = (time: DateTime.Utc | undefined) =>
    time !== undefined && DateTime.toEpochMillis(time) >= from && DateTime.toEpochMillis(time) < to
  const ran = release.ran
  return (
    (ran !== undefined && DateTime.toEpochMillis(ran.lastSeen) > from && DateTime.toEpochMillis(ran.firstSeen) < to) ||
    within(release.deploy?.deployedAt) ||
    within(release.store?.uploadedAt)
  )
}

/**
 * The releases that ran, were deployed, or were uploaded in the query's period, the latest first,
 * at most 30, in the query's environment, where those naming none count as production: each compared with the release before it that ran, with its commit and store build
 * when found; and the sources that couldn't be read lately. Reads only: two operation tables and an
 * error table a release that ran.
 */
export const listReleases = Effect.fn("Releases.list")(function* (query: ReleaseListQuery) {
  const releases = yield* knownReleases
  const records = yield* ReleaseRecords
  const projects = yield* Projects
  const settings = yield* projects.settings.pipe(
    Effect.catchTag("ProjectNotFound", () => Effect.succeed(defaultProjectSettings)),
  )
  // A release that names no environment, such as a build only App Store Connect knows, belongs to
  // production, as telemetry without one does.
  const inEnvironment = (release: KnownRelease) =>
    query.environment === undefined ||
    release.environment === query.environment ||
    (release.environment === undefined && isProduction(settings, query.environment))
  const from = DateTime.toEpochMillis(query.period.from)
  const to = DateTime.toEpochMillis(query.period.to)
  const inPeriod = releases
    .filter(
      (release) =>
        activeIn(release, from, to) &&
        (query.component === undefined || release.component === query.component) &&
        inEnvironment(release),
    )
    .slice(0, listed)
  const summaries = yield* Effect.forEach(inPeriod, (release) =>
    summaryOf(releases, release).pipe(Effect.map((summarized) => summarized.summary)),
  )
  const syncs = yield* records.syncs
  const problems = syncs.flatMap((sync): ReadonlyArray<SourceProblem> =>
    sync.problem === undefined || (query.component !== undefined && sync.component !== query.component)
      ? []
      : [{ component: sync.component, source: sync.source, problem: sync.problem, at: sync.at }],
  )
  const list: ReleaseList = { releases: summaries, problems }
  return list
})

/**
 * One release compared with the one before it: what moved, the errors first seen in it, the
 * incidents that opened while it ran, and what changed in its repository since; without an
 * environment, of the one it last ran in. Fails with `ReleaseNotFound` for a release the module
 * doesn't know. Reads only.
 */
export const releaseDetail = Effect.fn("Releases.detail")(function* (key: ReleaseKey) {
  const releases = yield* knownReleases
  const records = yield* ReleaseRecords
  // Without an environment, the one it last ran in; else any it is known in.
  const matching = releases.filter(
    (each) =>
      each.component === key.component &&
      each.release === key.release &&
      (key.environment === undefined || each.environment === key.environment),
  )
  const release =
    matching.reduce<KnownRelease | undefined>(
      (latest, each) =>
        each.ran !== undefined &&
        (latest?.ran === undefined ||
          DateTime.toEpochMillis(each.ran.lastSeen) > DateTime.toEpochMillis(latest.ran.lastSeen))
          ? each
          : latest,
      undefined,
    ) ?? matching[0]
  if (release === undefined) {
    return yield* new ReleaseNotFound({ component: key.component, release: key.release })
  }
  const { summary, compared, previous } = yield* summaryOf(releases, release)
  const comparison = Option.getOrUndefined(compared.comparison)
  const changes =
    previous === undefined
      ? Option.none()
      : yield* records.changes(release.component, release.release, previous.release)
  const incidents = yield* Incidents
  const list = yield* incidents.incidents
  const ran = release.ran
  const detail: ReleaseDetail = {
    summary,
    slower: comparison?.slower ?? [],
    failingMore: comparison?.failingMore ?? [],
    faster: comparison?.faster ?? [],
    failingLess: comparison?.failingLess ?? [],
    newOperations: comparison?.newOperations ?? [],
    newErrors: compared.newErrors,
    incidents:
      ran === undefined
        ? []
        : [...list.open, ...list.resolved].filter(
            (incident) =>
              incident.component === release.component &&
              // A monitor's incident has no environment: it is about the component wherever it runs.
              (incident.environment === undefined || incident.environment === release.environment) &&
              DateTime.toEpochMillis(incident.openedAt) >= DateTime.toEpochMillis(ran.firstSeen) &&
              DateTime.toEpochMillis(incident.openedAt) < DateTime.toEpochMillis(ran.lastSeen),
          ),
    ...(Option.isNone(changes) ? {} : { changes: changes.value }),
    problems: (yield* records.syncs).flatMap((sync): ReadonlyArray<SourceProblem> =>
      sync.problem === undefined || sync.component !== release.component
        ? []
        : [{ component: sync.component, source: sync.source, problem: sync.problem, at: sync.at }],
    ),
  }
  return detail
})
