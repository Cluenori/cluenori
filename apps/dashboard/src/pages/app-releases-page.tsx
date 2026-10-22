import type { ComponentKey, EnvironmentKey, ProjectKey } from "@cluenori/foundation"
import { useAtomValue } from "@effect/atom-react"
import { AsyncResult } from "effect/reactivity"
import { HeartPulseIcon } from "lucide-react"

import { appPeriodWords, healthMeaning, latestSentOf } from "@/app-facts"
import { useAppEnvironments } from "@/hooks/use-app-environments"
import { appHealthAtom, appPeriodAtom, useComponentKeys } from "@/project-data"
import { colorOf, isShownIn } from "@/project-facts"
import { AnalyticsSwitches } from "@/views/analytics-switches"
import { HealthList } from "@/views/health-list"
import { Loaded } from "@/views/loaded"
import { Panel } from "@/views/panel"
import { ProjectHeader } from "@/views/project-header"

/**
 * Every release of a project's apps that sent anything over the period, or of one component's, the
 * latest first seen first, at most 30: each one's app health against the release before it, one
 * click from its own page.
 */
export function AppReleasesPage({
  project,
  component,
  named,
}: {
  readonly project: ProjectKey
  readonly component?: ComponentKey
  readonly named?: EnvironmentKey
}) {
  const environments = useAppEnvironments(project, component, named)
  const health = useAtomValue(appHealthAtom({ project, ...(component === undefined ? {} : { component }) }))
  const keys = useComponentKeys(project)
  const period = useAtomValue(appPeriodAtom)
  if (environments === undefined) {
    return <div className="p-8 text-sm text-muted-foreground">Opening the page…</div>
  }
  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 p-4 md:p-6">
      <ProjectHeader title="App health" latest={AsyncResult.map(health, latestSentOf)}>
        <AnalyticsSwitches
          project={project}
          components={keys}
          component={component}
          environments={environments}
          routeOf={(next) => ({ page: "appReleases", project, ...next })}
        />
      </ProjectHeader>
      <Panel
        icon={HeartPulseIcon}
        title="Releases"
        subtitle={`Those that sent anything in ${appPeriodWords(period)}, the latest first, each against the release before it`}
      >
        <Loaded result={health}>
          {(list) => (
            <HealthList
              releases={list.releases.filter((each) => isShownIn(environments, each.release.environment))}
              asOf={list.asOf}
              colorOf={(of) => colorOf(of, keys)}
              linkOf={(each) => ({
                page: "appRelease",
                project,
                component: each.release.component,
                release: each.release.release,
                environment: each.release.environment,
              })}
            />
          )}
        </Loaded>
        <p className="mt-auto border-t px-5 py-3 text-sm text-pretty text-muted-foreground">{healthMeaning}</p>
      </Panel>
    </div>
  )
}
