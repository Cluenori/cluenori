// The dashboard's data: one atom for each question it asks the public API, each run on the API
// client's runtime. The period is an atom too, so a question re-runs when it changes, keeping its
// last answer, marked waiting, until the new one arrives. This is the one file that knows where data
// comes from; pages and views ask it (PATTERNS.md, "Dashboard views").

import type { FeedId, FeedInput } from "@cluenori/feeds"
import type {
  ComponentKey,
  EnvelopeName,
  EnvironmentKey,
  FeatureKey,
  MemberId,
  PersonId,
  ProjectKey,
  ReleaseVersion,
  TraceId,
} from "@cluenori/foundation"
import type { ConnectGitHub } from "@cluenori/github-app"
import type { AddMonitor, IncidentId, MonitorId } from "@cluenori/incidents"
import type { Email, InviteCode, SignInId } from "@cluenori/members"
import type { PhoneId } from "@cluenori/phones"
import type { ComponentLinks, IngestKeyId, IngestKeyName, ProjectSettings, SdkKey } from "@cluenori/projects"
import type {
  AppStoreSubmission,
  ReleaseCommit,
  BuildNumber,
  NotesStyle,
  PromotionId,
  PromotionReason,
  ReleaseNote,
  Runner,
  SemanticVersion,
  VersionPolicyTo,
} from "@cluenori/releases"
import type { AppUserId, ErrorGroupId, IndexedLevel, LogCountsBy, LogMessageId, SeriesStep } from "@cluenori/signals"
import type { SetWatcher } from "@cluenori/watcher"
import type { CluenoriApi } from "@cluenori/worker"
import { useAtomValue } from "@effect/atom-react"
import { DateTime, Duration, Effect, Option, Redacted } from "effect"
import { Atom, AsyncResult } from "effect/reactivity"

import { CluenoriClient } from "@/api-client"
import { askForPasskey, makePasskey } from "@/passkeys"

/** How far back a page looks. */
export type PeriodKey = "1h" | "24h" | "7d" | "30d" | "90d"

/** Every period, shortest first, as the period switch shows them. */
export const periods: ReadonlyArray<{ readonly key: PeriodKey; readonly label: string }> = [
  { key: "1h", label: "1h" },
  { key: "24h", label: "24h" },
  { key: "7d", label: "7d" },
  { key: "30d", label: "30d" },
  { key: "90d", label: "90d" },
]

const hour = 3_600_000
const day = 24 * hour

/** How long each period is: it ends when its question is asked. */
export const periodMillis: Readonly<Record<PeriodKey, number>> = {
  "1h": hour,
  "24h": day,
  "7d": 7 * day,
  "30d": 30 * day,
  "90d": 90 * day,
}

/** How wide a period's points are: as fine as its counts are kept, about 30 to 300 points. */
export const stepOf: Readonly<Record<PeriodKey, SeriesStep>> = {
  "1h": "1m",
  "24h": "5m",
  "7d": "1h",
  "30d": "1d",
  "90d": "1d",
}

/** The period every page shows; one choice, kept as the viewer moves between pages and projects. */
export const periodAtom = Atom.make<PeriodKey>("24h").pipe(Atom.keepAlive)

// A period that ends now, as the API asks for one: worked out when a question runs, so asking again
// moves it.
const lastOf = (millis: number) =>
  DateTime.now.pipe(Effect.map((now) => ({ from: DateTime.subtract(now, { milliseconds: millis }), to: now })))

/**
 * A question's answer, kept 5 minutes after the last page showing it closes, so going back shows
 * it at once; an answer older than 30 seconds is asked again as it is shown and when the tab comes
 * back into view, the old one shown, marked waiting, until the new one arrives.
 */
const kept = <A, E>(question: Atom.Atom<AsyncResult.AsyncResult<A, E>>) =>
  Atom.swr(Atom.setIdleTTL(question, Duration.minutes(5)), fresh)

const fresh = {
  staleTime: Duration.seconds(30),
  revalidateOnMount: true,
  revalidateOnFocus: true,
  focusSignal: Atom.windowFocusSignal,
}

/**
 * `kept` for a family of questions. The question is its own family: the registry holds a kept answer
 * until it expires, so the same one is found again even after the browser collects the atom a page
 * read it through, which a family holds only weakly.
 */
const keptFamily = <Arg, A, E>(question: (arg: Arg) => Atom.Atom<AsyncResult.AsyncResult<A, E>>) => {
  const questions = Atom.family((arg: Arg) => Atom.setIdleTTL(question(arg), Duration.minutes(5)))
  return Atom.family((arg: Arg) => Atom.swr(questions(arg), fresh))
}

/**
 * What a question is about: a project, and optionally one of its components, environments,
 * operations, or releases.
 */
export type Scope = {
  readonly project: ProjectKey
  readonly component?: ComponentKey
  readonly environment?: EnvironmentKey
  readonly operation?: EnvelopeName
  readonly release?: ReleaseVersion
}

const filtersOf = (scope: Scope) => ({
  ...(scope.component === undefined ? {} : { component: scope.component }),
  ...(scope.environment === undefined ? {} : { environment: scope.environment }),
  ...(scope.operation === undefined ? {} : { operation: scope.operation }),
  ...(scope.release === undefined ? {} : { release: scope.release }),
})

/**
 * The environment last picked on each project's pages, while the dashboard is open: a page whose
 * address names none shows it, so a choice holds across pages and projects.
 */
export const chosenEnvironmentAtom = Atom.family((_project: ProjectKey) =>
  Atom.make<EnvironmentKey | undefined>(undefined).pipe(Atom.keepAlive),
)

/** The workspace's projects. */
export const projectsAtom = kept(
  CluenoriClient.runtime.atom(
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      return yield* client.projects.listProjects()
    }),
  ),
)

/** Who is signed in, and what they see: an owner every project, a member those listed. */
export const meAtom = kept(
  CluenoriClient.runtime.atom(
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      return yield* client.members.me()
    }),
  ),
)

/**
 * Today's answer, as the public API defines it: what needs attention now across every project the
 * member sees, the most urgent first, in the environments each calls production, and the projects
 * that didn't answer. The dashboard knows Today only through the API's definition.
 */
export type TodayList = (typeof CluenoriApi)["groups"]["today"]["endpoints"]["today"]["~Success"]["Type"]
export type TodayItem = TodayList["items"][number]
/**
 * How a project is going now, in the environments it calls production: its load by the hour over the
 * last 24 hours, and its apps' people on the latest whole UTC day and a week before.
 */
export type ProjectPulse = NonNullable<TodayList["pulses"]>[number]

/**
 * What needs attention now across every project the member sees (Today): open incidents, errors
 * new or happening now, slower operations, releases that need a member, and projects that sent
 * nothing in a day; and each project's pulse. One question, which the API asks each project.
 */
export const todayAtom = kept(
  CluenoriClient.runtime.atom(
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      return yield* client.today.today()
    }),
  ),
)

/** The phones paired with the deployment, the latest paired first. */
export const phonesAtom = kept(
  CluenoriClient.runtime.atom(
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      return yield* client.phones.phones()
    }),
  ),
)

/** Starts pairing a phone: a link to show as a QR code, good once for 10 minutes. */
export const startPairingAtom = CluenoriClient.runtime.fn(() =>
  Effect.gen(function* () {
    const client = yield* CluenoriClient
    return yield* client.phones.startPairing()
  }),
)

/** Removes a phone, whose key stops working at once, and asks for the phones again. */
export const removePhoneAtom = CluenoriClient.runtime.fn((phone: PhoneId) =>
  Effect.gen(function* () {
    const client = yield* CluenoriClient
    yield* client.phones.removePhone({ params: { phone } })
    yield* Atom.refresh(phonesAtom)
  }),
)

/**
 * The workspace's feeds the member sees, by name, each with its counts of the last 24 hours and 7
 * days; with `asOf`, when it was asked, which "ago" is measured from.
 */
export const feedsAtom = kept(
  CluenoriClient.runtime.atom(
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      const asOf = yield* DateTime.now
      const { feeds } = yield* client.feeds.feeds()
      return { feeds, asOf: DateTime.toEpochMillis(asOf) }
    }),
  ),
)

/**
 * A page of one feed's entries, newest first: the latest page without `before`, an older one from an
 * earlier page's `next`. The feed's page asks for the latest again each minute.
 */
export const feedAtom = keptFamily((key: { readonly feed: FeedId; readonly before?: number }) =>
  CluenoriClient.runtime.atom(
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      return yield* client.feeds.feed({
        params: { feed: key.feed },
        query: key.before === undefined ? {} : { before: key.before },
      })
    }),
  ),
)

/** Makes a feed, or changes feed `feed`, for an owner, and asks for the feeds again: answers the feed. */
export const saveFeedAtom = CluenoriClient.runtime.fn((change: { readonly feed?: FeedId; readonly input: FeedInput }) =>
  Effect.gen(function* () {
    const client = yield* CluenoriClient
    const saved =
      change.feed === undefined
        ? yield* client.feeds.createFeed({ payload: change.input })
        : yield* client.feeds.saveFeed({ params: { feed: change.feed }, payload: change.input })
    yield* Atom.refresh(feedsAtom)
    yield* Atom.refresh(feedAtom({ feed: saved.id }))
    return saved
  }),
)

/** Deletes a feed and its entries, for an owner, and asks for the feeds again. */
export const removeFeedAtom = CluenoriClient.runtime.fn((feed: FeedId) =>
  Effect.gen(function* () {
    const client = yield* CluenoriClient
    yield* client.feeds.removeFeed({ params: { feed } })
    yield* Atom.refresh(feedsAtom)
  }),
)

/** A project's incidents: the open ones, and those resolved in the last 7 days, whatever the period. */
export const incidentsAtom = keptFamily((project: ProjectKey) =>
  CluenoriClient.runtime.atom(
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      return yield* client.incidents.incidents({ params: { project } })
    }),
  ),
)

/** One project and its components. */
export const projectAtom = keptFamily((project: ProjectKey) =>
  CluenoriClient.runtime.atom(
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      return yield* client.projects.project({ params: { project } })
    }),
  ),
)

/**
 * A project's components' keys, in the order that gives each its color; none until the project's
 * answer arrives, so a page's component switch appears with it.
 */
export const useComponentKeys = (project: ProjectKey): ReadonlyArray<ComponentKey> => {
  const detail = useAtomValue(projectAtom(project))
  return AsyncResult.isSuccess(detail) ? detail.value.components.map((component) => component.key) : []
}

/** Every operation over the period, or one component's, or one operation. */
export const operationsAtom = keptFamily((scope: Scope) =>
  CluenoriClient.runtime.atom((get) =>
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      const period = yield* lastOf(periodMillis[get(periodAtom)])
      return yield* client.signals.operations({
        params: { project: scope.project },
        query: { ...period, ...filtersOf(scope) },
      })
    }),
  ),
)

/**
 * The period's operations split by the client that asked for them, of one operation or every one:
 * origins aren't counted by release, so a scope's release is left out.
 */
export const originsAtom = keptFamily((scope: Scope) =>
  CluenoriClient.runtime.atom((get) =>
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      const period = yield* lastOf(periodMillis[get(periodAtom)])
      const { release: _release, ...filters } = filtersOf(scope)
      return yield* client.signals.origins({ params: { project: scope.project }, query: { ...period, ...filters } })
    }),
  ),
)

/** The slowest and the failed of the traces kept over the period, of one operation or every one. */
export const keptTracesAtom = keptFamily((scope: Scope) =>
  CluenoriClient.runtime.atom((get) =>
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      const period = yield* lastOf(periodMillis[get(periodAtom)])
      return yield* client.signals.keptTraces({
        params: { project: scope.project },
        query: { ...period, ...filtersOf(scope) },
      })
    }),
  ),
)

/**
 * The slowest and the failed of the traces kept in one moment, `from` to `to` in Unix milliseconds,
 * whatever the period: the requests of a step a chart opened.
 */
export const momentTracesAtom = keptFamily((key: Scope & { readonly from: number; readonly to: number }) =>
  CluenoriClient.runtime.atom(
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      return yield* client.signals.keptTraces({
        params: { project: key.project },
        query: { from: DateTime.makeUnsafe(key.from), to: DateTime.makeUnsafe(key.to), ...filtersOf(key) },
      })
    }),
  ),
)

/** Whether the one signed in is an owner, who manages projects, components and keys; false until known. */
export const useIsOwner = () => {
  const me = useAtomValue(meAtom)
  return AsyncResult.isSuccess(me) && me.value.role === "owner"
}

/**
 * The operations over the last day and over the 7 days before, whatever the period: what "slower"
 * compares (`slowerOf` in `@cluenori/signals`). Both questions go at once.
 */
export const usualOperationsAtom = keptFamily((scope: Scope) =>
  CluenoriClient.runtime.atom(
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      const now = yield* DateTime.now
      const lastDay = { from: DateTime.subtract(now, { days: 1 }), to: now }
      const weekBefore = { from: DateTime.subtract(now, { days: 8 }), to: lastDay.from }
      const ask = (period: typeof lastDay) =>
        client.signals.operations({ params: { project: scope.project }, query: { ...period, ...filtersOf(scope) } })
      const [last, usual] = yield* Effect.all([ask(lastDay), ask(weekBefore)], { concurrency: 2 })
      return { lastDay: last, usual }
    }),
  ),
)

/** The load over the period: how many operations ran and failed, with their percentiles, in the period's steps. */
export const loadAtom = keptFamily((scope: Scope) =>
  CluenoriClient.runtime.atom((get) =>
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      const key = get(periodAtom)
      const period = yield* lastOf(periodMillis[key])
      return yield* client.signals.load({
        params: { project: scope.project },
        query: { ...period, ...filtersOf(scope), step: stepOf[key] },
      })
    }),
  ),
)

/** One incident, whatever any period: its life, and the releases that ran when it opened. */
export const incidentAtom = keptFamily((key: { readonly project: ProjectKey; readonly incident: IncidentId }) =>
  CluenoriClient.runtime.atom(
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      return yield* client.incidents.incident({ params: key })
    }),
  ),
)

/** Says the member is on an incident, then asks for it, and the incidents, again. */
export const acknowledgeAtom = CluenoriClient.runtime.fn(
  (key: { readonly project: ProjectKey; readonly incident: IncidentId }) =>
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      yield* client.incidents.acknowledge({ params: key })
      yield* Atom.refresh(incidentAtom(key))
      yield* Atom.refresh(incidentsAtom(key.project))
    }),
)

/** One monitor, whatever any period: how it is now, its days, its last 24 hours, and its incidents. */
export const monitorAtom = keptFamily((key: { readonly project: ProjectKey; readonly monitor: MonitorId }) =>
  CluenoriClient.runtime.atom(
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      return yield* client.incidents.monitor({ params: key })
    }),
  ),
)

/** The project's monitors, oldest first, each with its last check and its last 90 days: Uptime. */
export const monitorsAtom = keptFamily((project: ProjectKey) =>
  CluenoriClient.runtime.atom(
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      return yield* client.incidents.monitors({ params: { project } })
    }),
  ),
)

/** Adds a monitor, then asks for the monitors, and the incidents, again; returns it. */
export const addMonitorAtom = CluenoriClient.runtime.fn(
  (key: { readonly project: ProjectKey; readonly monitor: AddMonitor }) =>
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      const added = yield* client.incidents.addMonitor({ params: { project: key.project }, payload: key.monitor })
      yield* Atom.refresh(monitorsAtom(key.project))
      return added
    }),
)

/** Removes a monitor, which resolves its open incident, then asks for the monitors and incidents again. */
export const removeMonitorAtom = CluenoriClient.runtime.fn(
  (key: { readonly project: ProjectKey; readonly monitor: MonitorId }) =>
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      yield* client.incidents.removeMonitor({ params: key })
      yield* Atom.refresh(monitorsAtom(key.project))
      yield* Atom.refresh(incidentsAtom(key.project))
    }),
)

/** The errors of the period, most frequent first, of a project or one component. */
export const errorsAtom = keptFamily((scope: Scope) =>
  CluenoriClient.runtime.atom((get) =>
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      const period = yield* lastOf(periodMillis[get(periodAtom)])
      return yield* client.signals.errors({
        params: { project: scope.project },
        query: { ...period, ...filtersOf(scope) },
      })
    }),
  ),
)

/** One error and its latest occurrences in the period, of one component, environment, or release when the key names it. */
export const errorAtom = keptFamily((key: Scope & { readonly error: ErrorGroupId }) =>
  CluenoriClient.runtime.atom((get) =>
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      const period = yield* lastOf(periodMillis[get(periodAtom)])
      return yield* client.signals.error({
        params: { project: key.project, error: key.error },
        query: { ...period, ...filtersOf(key) },
      })
    }),
  ),
)

/**
 * One warning or error by its ID, whenever it happened: an occurrence of an error, as its own page
 * shows it, with no period.
 */
export const logLineAtom = keptFamily((key: { readonly project: ProjectKey; readonly line: number }) =>
  CluenoriClient.runtime.atom(
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      return yield* client.signals.logLine({ params: { project: key.project, line: key.line } })
    }),
  ),
)

/**
 * Warnings and errors counted over the period, a series for each level, component, or error group;
 * of one component, environment, release, or error group, when the key names it.
 */
export const logCountsAtom = keptFamily(
  (
    key: Scope & {
      readonly by: LogCountsBy
      readonly level?: IndexedLevel
      readonly error?: ErrorGroupId
      readonly message?: LogMessageId
    },
  ) =>
    CluenoriClient.runtime.atom((get) =>
      Effect.gen(function* () {
        const client = yield* CluenoriClient
        const period = get(periodAtom)
        const range = yield* lastOf(periodMillis[period])
        return yield* client.signals.logCounts({
          params: { project: key.project },
          query: {
            ...range,
            step: stepOf[period],
            by: key.by,
            ...(key.component === undefined ? {} : { component: key.component }),
            ...(key.environment === undefined ? {} : { environment: key.environment }),
            ...(key.release === undefined ? {} : { release: key.release }),
            ...(key.level === undefined ? {} : { level: key.level }),
            ...(key.error === undefined ? {} : { error: key.error }),
            ...(key.message === undefined ? {} : { message: key.message }),
          },
        })
      }),
    ),
)

/**
 * A page of the period's warnings and errors, newest first, 100 at a time, of one component,
 * environment, or release when the key names it: `before` continues from an earlier page's `next`.
 */
export const logsAtom = keptFamily(
  (
    key: Scope & {
      readonly level?: IndexedLevel
      readonly search?: string
      readonly message?: LogMessageId
      readonly before?: number
    },
  ) =>
    CluenoriClient.runtime.atom((get) =>
      Effect.gen(function* () {
        const client = yield* CluenoriClient
        const period = yield* lastOf(periodMillis[get(periodAtom)])
        return yield* client.signals.logs({
          params: { project: key.project },
          query: {
            ...period,
            ...(key.component === undefined ? {} : { component: key.component }),
            ...(key.environment === undefined ? {} : { environment: key.environment }),
            ...(key.release === undefined ? {} : { release: key.release }),
            ...(key.level === undefined ? {} : { level: key.level }),
            ...(key.search === undefined ? {} : { search: key.search }),
            ...(key.message === undefined ? {} : { message: key.message }),
            ...(key.before === undefined ? {} : { before: key.before }),
          },
        })
      }),
    ),
)

/**
 * The period's log messages, those with the most lines first, of one component, environment, or
 * release when the key names it: each counting its lines at `level` and with `search`.
 */
export const logMessagesAtom = keptFamily((key: Scope & { readonly level?: IndexedLevel; readonly search?: string }) =>
  CluenoriClient.runtime.atom((get) =>
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      const period = yield* lastOf(periodMillis[get(periodAtom)])
      return yield* client.signals.logMessages({
        params: { project: key.project },
        query: {
          ...period,
          ...filtersOf(key),
          ...(key.level === undefined ? {} : { level: key.level }),
          ...(key.search === undefined ? {} : { search: key.search }),
        },
      })
    }),
  ),
)

/** One log message, whatever the period, with how many of its lines the period holds, and its errors. */
export const logMessageAtom = keptFamily((key: Scope & { readonly message: LogMessageId }) =>
  CluenoriClient.runtime.atom((get) =>
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      const period = yield* lastOf(periodMillis[get(periodAtom)])
      return yield* client.signals.logMessage({
        params: { project: key.project, message: key.message },
        query: { ...period, ...filtersOf(key) },
      })
    }),
  ),
)

/**
 * The releases that ran or were uploaded over the period, the latest first, at most 30, of a project
 * or one component, in every environment, with the sources that couldn't be read lately; with
 * `asOf`, the end of the period asked about, which "live" is measured from. Not by environment: the
 * API's filter leaves out builds that don't say one, such as those only App Store Connect knows,
 * which a production page shows (`isShownIn` in `src/project-facts.ts`).
 */
export const releasesAtom = keptFamily((scope: Scope) =>
  CluenoriClient.runtime.atom((get) =>
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      const period = yield* lastOf(periodMillis[get(periodAtom)])
      const list = yield* client.releases.releases({
        params: { project: scope.project },
        query: { ...period, ...(scope.component === undefined ? {} : { component: scope.component }) },
      })
      return { releases: list.releases, problems: list.problems, asOf: period.to }
    }),
  ),
)

/** A release of a component, in an environment when it has one: by its component and version. */
export type ReleaseScope = {
  readonly project: ProjectKey
  readonly component: ComponentKey
  readonly release: ReleaseVersion
  readonly environment?: EnvironmentKey
}

/**
 * One release compared with the one before it, whatever the period; with `asOf`, when it was asked,
 * which "live" is measured from. Fails with `ReleaseNotFound` for a release never counted.
 */
export const releaseAtom = keptFamily((key: ReleaseScope) =>
  CluenoriClient.runtime.atom(
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      const asOf = yield* DateTime.now
      const detail = yield* client.releases.release({
        params: { project: key.project, component: key.component, release: key.release },
        query: key.environment === undefined ? {} : { environment: key.environment },
      })
      return { detail, asOf }
    }),
  ),
)

/**
 * How each of a project's components' releases reach its environments, whatever the period: in each,
 * the release there now and since when, a promotion under way, and the one next step; with `asOf`,
 * when it was asked, which "how long" is measured from.
 */
export const deliveryAtom = keptFamily((project: ProjectKey) =>
  CluenoriClient.runtime.atom(
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      const asOf = yield* DateTime.now
      const delivery = yield* client.releases.delivery({ params: { project } })
      return { delivery, asOf }
    }),
  ),
)

/**
 * Promotes a release to an environment by its component's deploy target there, for the member
 * signed in: its workflow on `runner`, then, for an app, App Store Connect, submitted to review as
 * `submission` says; and asks for the release and the delivery again, whose promotions then have it. Each call that
 * succeeds starts a run. Fails with `PromotionRefused` until someone fixes what its reason says,
 * where its `fix` says; `PromotionInProgress` while the last promotion to the environment runs;
 * and `PromotionUnavailable` when GitHub didn't answer, so nothing started.
 */
export const promoteAtom = CluenoriClient.runtime.fn(
  (input: {
    readonly release: ReleaseScope
    readonly environment: EnvironmentKey
    readonly reason?: PromotionReason
    readonly runner?: Runner
    readonly submission?: AppStoreSubmission
  }) =>
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      const promotion = yield* client.releases.promote({
        params: { project: input.release.project, component: input.release.component, release: input.release.release },
        payload: {
          environment: input.environment,
          ...(input.reason === undefined ? {} : { reason: input.reason }),
          ...(input.runner === undefined ? {} : { runner: input.runner }),
          ...(input.submission === undefined ? {} : { submission: input.submission }),
        },
      })
      yield* Atom.refresh(releaseAtom(input.release))
      yield* Atom.refresh(deliveryAtom(input.release.project))
      return promotion
    }),
)

/**
 * Promotes a component's commit that has no release yet: `commit`, or the newest on its
 * repository's default branch. Cluenori numbers it as the component's next release, then promotes
 * that release as `promoteAtom` does, with the same failures, and `PromotionRefused` with the fix
 * `version` until the component's version is set. Asks for the delivery again, whose version this
 * numbers on and whose environment this promotes to.
 */
export const promoteLatestAtom = CluenoriClient.runtime.fn(
  (input: {
    readonly project: ProjectKey
    readonly component: ComponentKey
    readonly environment: EnvironmentKey
    readonly commit?: ReleaseCommit["sha"]
    readonly reason?: PromotionReason
    readonly runner?: Runner
    readonly submission?: AppStoreSubmission
  }) =>
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      const { project, component, ...payload } = input
      const promotion = yield* client.releases.promoteLatest({ params: { project, component }, payload })
      yield* Atom.refresh(deliveryAtom(project))
      return promotion
    }),
)

/**
 * Releases a promotion App Store review approved, which waits for a member: App Store Connect makes
 * it live, and the promotion ends once it is. Asks for the release and the delivery again. Fails
 * with `PromotionNotFound` when it isn't waiting any more.
 */
export const releaseApprovedAtom = CluenoriClient.runtime.fn(
  (input: { readonly release: ReleaseScope; readonly promotion: PromotionId }) =>
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      const promotion = yield* client.releases.releaseApproved({
        params: { project: input.release.project, promotion: input.promotion },
      })
      yield* Atom.refresh(releaseAtom(input.release))
      yield* Atom.refresh(deliveryAtom(input.release.project))
      return promotion
    }),
)

/**
 * Replaces a release's notes, one for each language given and none in others, and asks for the
 * release again, whose notes then are these.
 */
export const saveNotesAtom = CluenoriClient.runtime.fn(
  (input: { readonly release: ReleaseScope; readonly notes: ReadonlyArray<ReleaseNote> }) =>
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      const saved = yield* client.releases.saveNotes({
        params: { project: input.release.project, component: input.release.component, release: input.release.release },
        payload: { notes: input.notes },
      })
      yield* Atom.refresh(releaseAtom(input.release))
      return saved
    }),
)

/**
 * A draft of a release's notes for where `environment`'s builds go, written by the project's
 * language model from the commits since the release current there. Saves nothing. Fails with
 * `DraftUnavailable`, saying why, when no draft could be written.
 */
export const draftNotesAtom = CluenoriClient.runtime.fn(
  (input: { readonly release: ReleaseScope; readonly environment: EnvironmentKey }) =>
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      return yield* client.releases.draftNotes({
        params: { project: input.release.project, component: input.release.component, release: input.release.release },
        payload: { environment: input.environment },
      })
    }),
)

/**
 * Sets a component's version, the same or higher, its builds continuing, or from `firstBuild`; asks
 * for the delivery again, which says each component's version. Fails with `VersionRefused`, saying
 * why, for a lower version.
 */
export const setVersionAtom = CluenoriClient.runtime.fn(
  (input: {
    readonly project: ProjectKey
    readonly component: ComponentKey
    readonly version: SemanticVersion
    readonly firstBuild?: BuildNumber
  }) =>
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      const set = yield* client.releases.setVersion({
        params: { project: input.project, component: input.component },
        payload: {
          version: input.version,
          ...(input.firstBuild === undefined ? {} : { firstBuild: input.firstBuild }),
        },
      })
      yield* Atom.refresh(deliveryAtom(input.project))
      return set
    }),
)

/** How the project's release notes read, which drafts follow: its own, or Cluenori's default. */
export const notesStyleAtom = keptFamily((project: ProjectKey) =>
  CluenoriClient.runtime.atom(
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      return yield* client.releases.notesStyle({ params: { project } })
    }),
  ),
)

/** Sets how the project's release notes read, and asks for it again. */
export const setNotesStyleAtom = CluenoriClient.runtime.fn(
  (input: { readonly project: ProjectKey; readonly style: NotesStyle }) =>
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      const set = yield* client.releases.setNotesStyle({ params: { project: input.project }, payload: input.style })
      yield* Atom.refresh(notesStyleAtom(input.project))
      return set
    }),
)

/**
 * Replaces a component's links, its GitHub repository, its deploy targets and the component it ships
 * with, one left out unlinked, and asks for the project and the delivery again, which show them, and
 * for the `release` a page shows, whose deploy targets are its component's. Fails with
 * `ComponentNotFound` for a component the project no longer has, or one it ships with that it lacks.
 */
export const linkComponentAtom = CluenoriClient.runtime.fn(
  (input: {
    readonly project: ProjectKey
    readonly component: ComponentKey
    readonly links: ComponentLinks
    readonly release?: ReleaseScope
  }) =>
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      const linked = yield* client.projects.linkComponent({
        params: { project: input.project, component: input.component },
        payload: input.links,
      })
      yield* Atom.refresh(projectAtom(input.project))
      yield* Atom.refresh(deliveryAtom(input.project))
      if (input.release !== undefined) {
        yield* Atom.refresh(releaseAtom(input.release))
      }
      return linked
    }),
)

/**
 * Replaces a project's settings, the environments it calls production, and asks for the project
 * again, whose pages start there.
 */
export const updateSettingsAtom = CluenoriClient.runtime.fn(
  (input: { readonly project: ProjectKey; readonly settings: ProjectSettings }) =>
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      const saved = yield* client.projects.updateSettings({
        params: { project: input.project },
        payload: input.settings,
      })
      yield* Atom.refresh(projectAtom(input.project))
      return saved
    }),
)

// ---- Apps: analytics, SDK keys, version policies ----------------------------------------------------

/**
 * How far back the analytics pages look. Apps are counted by UTC day, so their period is in days, a
 * choice of its own: the other pages' period is in minutes and hours.
 */
export type AppPeriodKey = "7d" | "30d" | "90d"

/** Every period of the analytics pages, shortest first, as their switch shows them. */
export const appPeriods: ReadonlyArray<{ readonly key: AppPeriodKey; readonly label: string; readonly days: number }> =
  [
    { key: "7d", label: "7d", days: 7 },
    { key: "30d", label: "30d", days: 30 },
    { key: "90d", label: "90d", days: 90 },
  ]

/** The period the analytics pages show: 30 days at first, kept as the viewer moves between them. */
export const appPeriodAtom = Atom.make<AppPeriodKey>("30d").pipe(Atom.keepAlive)

// The days an app period ends now with, as the API asks for one: worked out when a question runs.
const lastDaysOf = (key: AppPeriodKey) => lastOf((appPeriods.find((entry) => entry.key === key)?.days ?? 30) * day)

/** What an app question is about: a project, and optionally one component, environment, or release. */
export type AppScope = {
  readonly project: ProjectKey
  readonly component?: ComponentKey
  readonly environment?: EnvironmentKey
  readonly release?: ReleaseVersion
}

const appScopeOf = (scope: AppScope) => ({
  ...(scope.component === undefined ? {} : { component: scope.component }),
  ...(scope.environment === undefined ? {} : { environment: scope.environment }),
})

/**
 * How the project's apps were used over the analytics period, by UTC day, with the period asked
 * about: the days it covers are the chart's, those the answer doesn't list unknown.
 */
export const usageAtom = keptFamily((scope: AppScope) =>
  CluenoriClient.runtime.atom((get) =>
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      const period = yield* lastDaysOf(get(appPeriodAtom))
      const usage = yield* client.analytics.usage({
        params: { project: scope.project },
        query: {
          ...period,
          ...appScopeOf(scope),
          ...(scope.release === undefined ? {} : { release: scope.release }),
        },
      })
      return { usage, period }
    }),
  ),
)

/** Weekly cohorts of the people first seen over the analytics period, the oldest first. */
export const retentionAtom = keptFamily((scope: AppScope) =>
  CluenoriClient.runtime.atom((get) =>
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      const period = yield* lastDaysOf(get(appPeriodAtom))
      return yield* client.analytics.retention({
        params: { project: scope.project },
        query: { ...period, ...appScopeOf(scope) },
      })
    }),
  ),
)

/**
 * The app health of the releases that sent anything over the analytics period, the latest first
 * seen first, at most 30, each beside the release before it; with `asOf`, the end of the period,
 * which "live" is measured from.
 */
export const appHealthAtom = keptFamily((scope: AppScope) =>
  CluenoriClient.runtime.atom((get) =>
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      const period = yield* lastDaysOf(get(appPeriodAtom))
      const list = yield* client.analytics.appHealth({
        params: { project: scope.project },
        query: { ...period, ...appScopeOf(scope) },
      })
      return { releases: list.releases, asOf: period.to }
    }),
  ),
)

/**
 * One release's app health, whatever the period: found among the releases of its component and
 * environment that sent anything in the last 90 days, none when it sent nothing then; with `asOf`,
 * when it was asked, which "live" is measured from.
 */
export const releaseHealthAtom = keptFamily(
  (key: {
    readonly project: ProjectKey
    readonly component: ComponentKey
    readonly release: ReleaseVersion
    readonly environment?: EnvironmentKey
  }) =>
    CluenoriClient.runtime.atom(
      Effect.gen(function* () {
        const client = yield* CluenoriClient
        const period = yield* lastOf(90 * day)
        const list = yield* client.analytics.appHealth({
          params: { project: key.project },
          query: { ...period, ...appScopeOf(key) },
        })
        // Not handled: a release more than 30 releases back of its component and environment isn't
        // in the list, so it reads as having sent nothing lately; a route for one release would fix it.
        const found = list.releases.find((each) => each.release.release === key.release)
        return { health: Option.fromUndefinedOr(found), asOf: period.to }
      }),
    ),
)

/** How each feature key was used over the analytics period, the most people first. */
export const featureUseAtom = keptFamily((scope: AppScope) =>
  CluenoriClient.runtime.atom((get) =>
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      const period = yield* lastDaysOf(get(appPeriodAtom))
      return yield* client.analytics.featureUse({
        params: { project: scope.project },
        query: {
          ...period,
          ...appScopeOf(scope),
          ...(scope.release === undefined ? {} : { release: scope.release }),
        },
      })
    }),
  ),
)

/** Each screen's readiness, visits, CPU time, hitches and hangs over the analytics period, and the apps' timings. */
export const screensAtom = keptFamily((scope: AppScope) =>
  CluenoriClient.runtime.atom((get) =>
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      const period = yield* lastDaysOf(get(appPeriodAtom))
      return yield* client.analytics.screens({
        params: { project: scope.project },
        query: {
          ...period,
          ...appScopeOf(scope),
          ...(scope.release === undefined ? {} : { release: scope.release }),
        },
      })
    }),
  ),
)

/**
 * One person, by their ID or the app's own user ID linked to them: their installations, active days,
 * features and timeline. Fails with `PersonNotFound` when the apps never sent that person or user ID.
 */
export const personAtom = keptFamily(
  (key: { readonly project: ProjectKey } & ({ readonly person: PersonId } | { readonly user: AppUserId })) =>
    CluenoriClient.runtime.atom(
      Effect.gen(function* () {
        const client = yield* CluenoriClient
        const asOf = yield* DateTime.now
        const person =
          "person" in key
            ? yield* client.analytics.person({ params: { project: key.project, person: key.person } })
            : yield* client.analytics.personByUser({ params: { project: key.project }, query: { user: key.user } })
        return { person, asOf }
      }),
    ),
)

/**
 * One feature's story over everything kept of it, with no period, in one environment or every one.
 * Fails with `FeatureNotFound` when nothing kept names it.
 */
export const featureAtom = keptFamily(
  (key: {
    readonly project: ProjectKey
    readonly feature: FeatureKey
    readonly environment?: EnvironmentKey
    readonly component?: ComponentKey
  }) =>
    CluenoriClient.runtime.atom(
      Effect.gen(function* () {
        const client = yield* CluenoriClient
        return yield* client.analytics.feature({
          params: { project: key.project, feature: key.feature },
          query: {
            ...(key.environment === undefined ? {} : { environment: key.environment }),
            ...(key.component === undefined ? {} : { component: key.component }),
          },
        })
      }),
    ),
)

/** Each of the project's components' version policies; a component without one isn't listed. */
export const versionPoliciesAtom = keptFamily((project: ProjectKey) =>
  CluenoriClient.runtime.atom(
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      return yield* client.releases.versionPolicies({ params: { project } })
    }),
  ),
)

/**
 * Replaces a component's version policy, a field left out unset, and asks for the policies again.
 * Fails with `VersionPolicyRefused`, saying why: no version, a recommended one lower than the
 * minimum, or no store page given or found.
 */
export const setVersionPolicyAtom = CluenoriClient.runtime.fn(
  (input: { readonly project: ProjectKey; readonly component: ComponentKey; readonly policy: VersionPolicyTo }) =>
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      const set = yield* client.releases.setVersionPolicy({
        params: { project: input.project, component: input.component },
        payload: input.policy,
      })
      yield* Atom.refresh(versionPoliciesAtom(input.project))
      return set
    }),
)

/** Removes a component's version policy, and asks for the policies again; removing none does nothing. */
export const clearVersionPolicyAtom = CluenoriClient.runtime.fn(
  (input: { readonly project: ProjectKey; readonly component: ComponentKey }) =>
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      yield* client.releases.clearVersionPolicy({ params: { project: input.project, component: input.component } })
      yield* Atom.refresh(versionPoliciesAtom(input.project))
    }),
)

/** A component's SDK keys, the newest first, revoked ones too. */
export const sdkKeysAtom = keptFamily((key: { readonly project: ProjectKey; readonly component: ComponentKey }) =>
  CluenoriClient.runtime.atom(
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      return yield* client.projects.sdkKeys({ params: { project: key.project, component: key.component } })
    }),
  ),
)

/** Issues a new SDK key for a component, its others staying active, and asks for its keys again. */
export const issueSdkKeyAtom = CluenoriClient.runtime.fn(
  (input: { readonly project: ProjectKey; readonly component: ComponentKey }) =>
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      const issued = yield* client.projects.issueSdkKey({
        params: { project: input.project, component: input.component },
      })
      yield* Atom.refresh(sdkKeysAtom(input))
      return issued
    }),
)

/**
 * Revokes one of a component's SDK keys: builds that carry it are refused from then on. Asks for its
 * keys again. Revoking one revoked before changes nothing.
 */
export const revokeSdkKeyAtom = CluenoriClient.runtime.fn(
  (input: { readonly project: ProjectKey; readonly component: ComponentKey; readonly key: SdkKey }) =>
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      const revoked = yield* client.projects.revokeSdkKey({
        params: { project: input.project, component: input.component, key: input.key },
      })
      yield* Atom.refresh(sdkKeysAtom({ project: input.project, component: input.component }))
      return revoked
    }),
)

/** A component's ingest keys, the newest first: those that work, and those that ended in the last 30 days. */
export const ingestKeysAtom = keptFamily((key: { readonly project: ProjectKey; readonly component: ComponentKey }) =>
  CluenoriClient.runtime.atom(
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      return yield* client.projects.ingestKeys({ params: { project: key.project, component: key.component } })
    }),
  ),
)

/**
 * Adds an ingest key to a component, its others working on, that expires `days` days from now, or
 * never without them; asks for its keys again.
 */
export const addIngestKeyAtom = CluenoriClient.runtime.fn(
  (input: {
    readonly project: ProjectKey
    readonly component: ComponentKey
    readonly name: IngestKeyName
    readonly days?: number
  }) =>
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      const now = yield* DateTime.now
      const added = yield* client.projects.addIngestKey({
        params: { project: input.project, component: input.component },
        payload: {
          name: input.name,
          ...(input.days === undefined ? {} : { expiresAt: DateTime.add(now, { days: input.days }) }),
        },
      })
      yield* Atom.refresh(ingestKeysAtom({ project: input.project, component: input.component }))
      return added
    }),
)

/**
 * Revokes one of a component's ingest keys, now or `hours` hours from now; what is sent with it is
 * refused from then on. Asks for its keys again.
 */
export const revokeIngestKeyAtom = CluenoriClient.runtime.fn(
  (input: {
    readonly project: ProjectKey
    readonly component: ComponentKey
    readonly key: IngestKeyId
    readonly hours?: number
  }) =>
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      const now = yield* DateTime.now
      const revoked = yield* client.projects.revokeIngestKey({
        params: { project: input.project, component: input.component, key: input.key },
        payload: input.hours === undefined ? {} : { at: DateTime.add(now, { hours: input.hours }) },
      })
      yield* Atom.refresh(ingestKeysAtom({ project: input.project, component: input.component }))
      return revoked
    }),
)

/** One trace, read from the archive around when it happened. */
export const traceAtom = keptFamily(
  (key: { readonly project: ProjectKey; readonly trace: TraceId; readonly around?: DateTime.Utc }) =>
    CluenoriClient.runtime.atom(
      Effect.gen(function* () {
        const client = yield* CluenoriClient
        return yield* client.signals.trace({
          params: { project: key.project, trace: key.trace },
          query: key.around === undefined ? {} : { around: key.around },
        })
      }),
    ),
)

/** Signs this browser in with the API token, then asks again for the projects it can now see. */
export const signInAtom = CluenoriClient.runtime.fn((token: string) =>
  Effect.gen(function* () {
    const client = yield* CluenoriClient
    yield* client.signIn({ payload: { token: Redacted.make(token) } })
    yield* Atom.refresh(projectsAtom)
  }),
)

/** Signs this browser out; the projects' question then fails, which shows the sign-in again. */
/**
 * Signs this browser in with one of the site's passkeys, which the browser asks the person to pick
 * and confirm, and asks for the projects again.
 */
export const signInWithPasskeyAtom = CluenoriClient.runtime.fn(() =>
  Effect.gen(function* () {
    const client = yield* CluenoriClient
    const options = yield* client.passkeys.signInOptions()
    const assertion = yield* askForPasskey(options)
    yield* client.passkeys.signInWithPasskey({ payload: assertion })
    yield* Atom.refresh(projectsAtom)
    yield* Atom.refresh(meAtom)
  }),
)

export const signOutAtom = CluenoriClient.runtime.fn(() =>
  Effect.gen(function* () {
    const client = yield* CluenoriClient
    yield* client.signOut()
    yield* Atom.refresh(projectsAtom)
  }),
)

// Members, browsers and invitations: their pages load after start, these with the rest.

/** The deployment's members, owners first. Owners only. */
export const membersAtom = CluenoriClient.runtime.atom(
  Effect.gen(function* () {
    const client = yield* CluenoriClient
    return yield* client.members.members()
  }),
)

/** Invites someone to see projects: a link to send them, good once for 7 days. */
export const inviteAtom = CluenoriClient.runtime.fn(
  (input: { readonly email: Email; readonly projects: ReadonlyArray<ProjectKey> }) =>
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      const invite = yield* client.members.invite({ payload: input })
      yield* Atom.refresh(membersAtom)
      return invite
    }),
)

/** Sets the projects a member sees, and asks for the members again. */
export const setProjectsAtom = CluenoriClient.runtime.fn(
  (input: { readonly member: MemberId; readonly projects: ReadonlyArray<ProjectKey> }) =>
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      yield* client.members.setProjects({ params: { member: input.member }, payload: { projects: input.projects } })
      yield* Atom.refresh(membersAtom)
    }),
)

/** Removes a member, whose passkeys, sign-ins and phones stop working at once. */
export const removeMemberAtom = CluenoriClient.runtime.fn((member: MemberId) =>
  Effect.gen(function* () {
    const client = yield* CluenoriClient
    yield* client.members.removeMember({ params: { member } })
    yield* Atom.refresh(membersAtom)
  }),
)

/** The browsers signed in with passkeys that this member sees, the latest seen first. */
export const signInsAtom = CluenoriClient.runtime.atom(
  Effect.gen(function* () {
    const client = yield* CluenoriClient
    return yield* client.members.signIns()
  }),
)

/**
 * Whether Cluenori is connected to GitHub: its app and the accounts it is installed on, read from
 * GitHub as it is asked. Owners only: a member is answered `NotAllowed`.
 */
export const gitHubAtom = CluenoriClient.runtime.atom(
  Effect.gen(function* () {
    const client = yield* CluenoriClient
    return yield* client.github.github()
  }),
)

/**
 * Starts connecting GitHub: the form the browser posts to GitHub, which creates Cluenori's app.
 * None when Cluenori turns out to be connected already, after asking for the connection again,
 * which then shows it.
 */
export const connectGitHubAtom = CluenoriClient.runtime.fn((input: ConnectGitHub) =>
  Effect.gen(function* () {
    const client = yield* CluenoriClient
    return yield* client.github.connectGitHub({ payload: input }).pipe(
      Effect.asSome,
      Effect.catchTag("GitHubAlreadyConnected", () => Atom.refresh(gitHubAtom).pipe(Effect.as(Option.none()))),
    )
  }),
)

/** Disconnects GitHub: Cluenori forgets its app, which stays on GitHub; asks for the connection again. */
export const disconnectGitHubAtom = CluenoriClient.runtime.fn(() =>
  Effect.gen(function* () {
    const client = yield* CluenoriClient
    yield* client.github.disconnectGitHub()
    yield* Atom.refresh(gitHubAtom)
  }),
)

/**
 * The outside watcher: its repository, how many owners' phones its secrets hold, and what is wrong.
 * Owners only.
 */
export const watcherAtom = CluenoriClient.runtime.atom(
  Effect.gen(function* () {
    const client = yield* CluenoriClient
    return yield* client.watcher.watcher()
  }),
)

/** Names the watcher's repository; Cluenori writes its secrets there at once, and answers how it went. */
export const setWatcherAtom = CluenoriClient.runtime.fn((input: SetWatcher) =>
  Effect.gen(function* () {
    const client = yield* CluenoriClient
    const status = yield* client.watcher.setWatcher({ payload: input })
    yield* Atom.refresh(watcherAtom)
    return status
  }),
)

/** Signs a browser out, and asks for the browsers again. */
export const endSignInAtom = CluenoriClient.runtime.fn((signIn: SignInId) =>
  Effect.gen(function* () {
    const client = yield* CluenoriClient
    yield* client.members.endSignIn({ params: { signIn } })
    yield* Atom.refresh(signInsAtom)
  }),
)

/** Makes another passkey for the member signed in, on this device. */
export const addPasskeyAtom = CluenoriClient.runtime.fn(() =>
  Effect.gen(function* () {
    const client = yield* CluenoriClient
    const options = yield* client.members.passkeyOptions()
    const registration = yield* makePasskey(options)
    yield* client.members.addPasskey({ payload: registration })
    yield* Atom.refresh(meAtom)
  }),
)

/** Who an invitation is for, by the passkey options it gives; asking checks it is still open. */
export const invitationAtom = Atom.family((code: InviteCode) =>
  CluenoriClient.runtime.atom(
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      return yield* client.passkeys.joinOptions({ payload: { code } })
    }),
  ),
)

/** Joins by an invitation with a new passkey, which signs this browser in. */
export const joinAtom = CluenoriClient.runtime.fn((code: InviteCode) =>
  Effect.gen(function* () {
    const client = yield* CluenoriClient
    const options = yield* client.passkeys.joinOptions({ payload: { code } })
    const registration = yield* makePasskey(options)
    const member = yield* client.passkeys.join({ payload: { code, registration } })
    yield* Atom.refresh(projectsAtom)
    yield* Atom.refresh(meAtom)
    return member
  }),
)
