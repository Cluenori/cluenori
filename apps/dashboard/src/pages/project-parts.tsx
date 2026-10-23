import type { EnvironmentKey, ProjectKey } from "@cluenori/foundation"
import type { LoadSeries } from "@cluenori/signals"
import { useAtomValue } from "@effect/atom-react"
import { AsyncResult } from "effect/reactivity"
import type { ReactNode } from "react"

import { appHealthAtom, dayLoadAtom, projectAtom, recentUsageAtom } from "@/project-data"
import type { People } from "@/project-facts"
import { appEnvironmentsOf, environmentsOf, peopleOf } from "@/project-facts"
import { failureText } from "@/views/loaded"

// What Now and a project's page both show of a project, each part asking its own questions once it
// knows which environment to ask about: its load over the last day, in its production, and its apps'
// people against the week before, in the environment the apps sent from that its Product page opens
// on. A choice of environment on its other pages changes neither.

/** A quiet word while an answer loads. */
function Pending() {
  return (
    <span aria-busy className="text-sm text-muted-foreground">
      Loading…
    </span>
  )
}

/** What failed, short, where a number would be. */
function Failed({ cause }: { readonly cause: Parameters<typeof failureText>[0] }) {
  return <span className="text-sm text-failure">{failureText(cause)}</span>
}

/** The load over the last day, by the hour, and the environment it is of; absent when the project says none. */
export type DayLoad = { readonly series: LoadSeries; readonly environment?: EnvironmentKey }

/**
 * A project's load over the last 24 hours, in its production, for `children` to show: asked once
 * the project's answer says which environment that is.
 */
export function ProductionLoad({
  project,
  children,
}: {
  readonly project: ProjectKey
  readonly children: (load: DayLoad) => ReactNode
}) {
  const detail = useAtomValue(projectAtom(project))
  if (AsyncResult.isFailure(detail)) {
    return <Failed cause={detail.cause} />
  }
  if (!AsyncResult.isSuccess(detail)) {
    return <Pending />
  }
  const environment = environmentsOf(detail.value, undefined).shown
  return <LoadIn project={project} {...(environment === undefined ? {} : { environment })} show={children} />
}

function LoadIn({
  project,
  environment,
  show,
}: {
  readonly project: ProjectKey
  readonly environment?: EnvironmentKey
  readonly show: (load: DayLoad) => ReactNode
}) {
  const load = useAtomValue(dayLoadAtom({ project, ...(environment === undefined ? {} : { environment }) }))
  if (AsyncResult.isFailure(load)) {
    return <Failed cause={load.cause} />
  }
  if (!AsyncResult.isSuccess(load)) {
    return <Pending />
  }
  return show({ series: load.value, ...(environment === undefined ? {} : { environment }) })
}

/**
 * A project's apps' people, for `children` to show: `none` when its apps sent nothing in the
 * analytics period, such as a project of services alone; else daily and monthly people on the
 * latest whole UTC day against the week before, and the environment they are of.
 */
export type AppPeople =
  | { readonly _tag: "none" }
  | { readonly _tag: "counted"; readonly people: People; readonly environment?: EnvironmentKey }

export function ProjectPeople({
  project,
  children,
}: {
  readonly project: ProjectKey
  readonly children: (people: AppPeople) => ReactNode
}) {
  const detail = useAtomValue(projectAtom(project))
  const health = useAtomValue(appHealthAtom({ project }))
  if (AsyncResult.isFailure(health)) {
    return <Failed cause={health.cause} />
  }
  if (!AsyncResult.isSuccess(health) || AsyncResult.isInitial(detail)) {
    return <Pending />
  }
  if (health.value.releases.length === 0) {
    return children({ _tag: "none" })
  }
  const production = AsyncResult.isSuccess(detail) ? (detail.value.settings?.productionEnvironments ?? []) : []
  const sentFrom = health.value.releases.map((each) => each.release.environment)
  const environment = appEnvironmentsOf(sentFrom, production, undefined).shown
  return <PeopleIn project={project} {...(environment === undefined ? {} : { environment })} show={children} />
}

function PeopleIn({
  project,
  environment,
  show,
}: {
  readonly project: ProjectKey
  readonly environment?: EnvironmentKey
  readonly show: (people: AppPeople) => ReactNode
}) {
  const usage = useAtomValue(recentUsageAtom({ project, ...(environment === undefined ? {} : { environment }) }))
  if (AsyncResult.isFailure(usage)) {
    return <Failed cause={usage.cause} />
  }
  if (!AsyncResult.isSuccess(usage)) {
    return <Pending />
  }
  return show({
    _tag: "counted",
    people: peopleOf(usage.value.usage, usage.value.period.to),
    ...(environment === undefined ? {} : { environment }),
  })
}
