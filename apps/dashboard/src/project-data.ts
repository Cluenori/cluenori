// The dashboard's data: one atom for each question it asks the public API, each run on the API
// client's runtime. The period is an atom too, so a question re-runs when it changes, keeping its
// last answer, marked waiting, until the new one arrives. This is the one file that knows where data
// comes from; pages and views ask it (PATTERNS.md, "Dashboard views").

import type { ComponentKey, EnvelopeName, ProjectKey, TraceId } from "@cluenori/foundation"
import type { ErrorGroupId, IndexedLevel, LogCountsBy, SeriesStep } from "@cluenori/signals"
import { useAtomValue } from "@effect/atom-react"
import { DateTime, Duration, Effect, Redacted } from "effect"
import { Atom, AsyncResult } from "effect/reactivity"

import { CluenoriClient } from "@/api-client"

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

const periodMillis: Readonly<Record<PeriodKey, number>> = {
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
  Atom.swr(Atom.setIdleTTL(question, Duration.minutes(5)), {
    staleTime: Duration.seconds(30),
    revalidateOnMount: true,
    revalidateOnFocus: true,
    focusSignal: Atom.windowFocusSignal,
  })

/** What a question is about: a project, and optionally one of its components or endpoints. */
export type Scope = {
  readonly project: ProjectKey
  readonly component?: ComponentKey
  readonly endpoint?: EnvelopeName
}

const filtersOf = (scope: Scope) => ({
  ...(scope.component === undefined ? {} : { component: scope.component }),
  ...(scope.endpoint === undefined ? {} : { endpoint: scope.endpoint }),
})

/** The workspace's projects. */
export const projectsAtom = kept(
  CluenoriClient.runtime.atom(
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      return yield* client.projects.listProjects()
    }),
  ),
)

/** One project and its components. */
export const projectAtom = Atom.family((project: ProjectKey) =>
  kept(
    CluenoriClient.runtime.atom(
      Effect.gen(function* () {
        const client = yield* CluenoriClient
        return yield* client.projects.project({ params: { project } })
      }),
    ),
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

/** Every endpoint's requests over the period, or one component's or endpoint's. */
export const endpointsAtom = Atom.family((scope: Scope) =>
  kept(
    CluenoriClient.runtime.atom((get) =>
      Effect.gen(function* () {
        const client = yield* CluenoriClient
        const period = yield* lastOf(periodMillis[get(periodAtom)])
        return yield* client.signals.endpoints({
          params: { project: scope.project },
          query: { ...period, ...filtersOf(scope) },
        })
      }),
    ),
  ),
)

/**
 * The endpoints over the last day and over the 7 days before, whatever the period: what "slower"
 * compares (`slowerOf` in `src/project-facts.ts`). Both questions go at once.
 */
export const usualEndpointsAtom = Atom.family((scope: Scope) =>
  kept(
    CluenoriClient.runtime.atom(
      Effect.gen(function* () {
        const client = yield* CluenoriClient
        const now = yield* DateTime.now
        const lastDay = { from: DateTime.subtract(now, { days: 1 }), to: now }
        const weekBefore = { from: DateTime.subtract(now, { days: 8 }), to: lastDay.from }
        const ask = (period: typeof lastDay) =>
          client.signals.endpoints({ params: { project: scope.project }, query: { ...period, ...filtersOf(scope) } })
        const [last, usual] = yield* Effect.all([ask(lastDay), ask(weekBefore)], { concurrency: 2 })
        return { lastDay: last, usual }
      }),
    ),
  ),
)

/** Requests and errors over the period, with their percentiles, in the period's steps. */
export const requestsAtom = Atom.family((scope: Scope) =>
  kept(
    CluenoriClient.runtime.atom((get) =>
      Effect.gen(function* () {
        const client = yield* CluenoriClient
        const key = get(periodAtom)
        const period = yield* lastOf(periodMillis[key])
        return yield* client.signals.requests({
          params: { project: scope.project },
          query: { ...period, ...filtersOf(scope), step: stepOf[key] },
        })
      }),
    ),
  ),
)

/** The errors of the period, most frequent first, of a project or one component. */
export const errorsAtom = Atom.family((scope: Scope) =>
  kept(
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
  ),
)

/** One error and its latest occurrences in the period. */
export const errorAtom = Atom.family((key: { readonly project: ProjectKey; readonly error: ErrorGroupId }) =>
  kept(
    CluenoriClient.runtime.atom((get) =>
      Effect.gen(function* () {
        const client = yield* CluenoriClient
        const period = yield* lastOf(periodMillis[get(periodAtom)])
        return yield* client.signals.error({ params: { project: key.project, error: key.error }, query: period })
      }),
    ),
  ),
)

/**
 * Warnings and errors counted over the period, a series for each level, component, or error group;
 * of one component, or one error group, when the key names it.
 */
export const logCountsAtom = Atom.family(
  (key: Scope & { readonly by: LogCountsBy; readonly level?: IndexedLevel; readonly error?: ErrorGroupId }) =>
    kept(
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
              ...(key.level === undefined ? {} : { level: key.level }),
              ...(key.error === undefined ? {} : { error: key.error }),
            },
          })
        }),
      ),
    ),
)

/**
 * A page of the period's warnings and errors, newest first, 100 at a time: `before` continues from an
 * earlier page's `next`.
 */
export const logsAtom = Atom.family(
  (key: Scope & { readonly level?: IndexedLevel; readonly search?: string; readonly before?: number }) =>
    kept(
      CluenoriClient.runtime.atom((get) =>
        Effect.gen(function* () {
          const client = yield* CluenoriClient
          const period = yield* lastOf(periodMillis[get(periodAtom)])
          return yield* client.signals.logs({
            params: { project: key.project },
            query: {
              ...period,
              ...(key.component === undefined ? {} : { component: key.component }),
              ...(key.level === undefined ? {} : { level: key.level }),
              ...(key.search === undefined ? {} : { search: key.search }),
              ...(key.before === undefined ? {} : { before: key.before }),
            },
          })
        }),
      ),
    ),
)

/** One request's trace, read from the archive around when it happened. */
export const traceAtom = Atom.family(
  (key: { readonly project: ProjectKey; readonly trace: TraceId; readonly around: DateTime.Utc }) =>
    kept(
      CluenoriClient.runtime.atom(
        Effect.gen(function* () {
          const client = yield* CluenoriClient
          return yield* client.signals.trace({
            params: { project: key.project, trace: key.trace },
            query: { around: key.around },
          })
        }),
      ),
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
export const signOutAtom = CluenoriClient.runtime.fn(() =>
  Effect.gen(function* () {
    const client = yield* CluenoriClient
    yield* client.signOut()
    yield* Atom.refresh(projectsAtom)
  }),
)
