import type { ComponentKey, EnvironmentKey, ProjectKey } from "@cluenori/foundation"

import type { Environments } from "@/project-facts"
import type { Route } from "@/router"
import { navigate } from "@/router"
import { AppPeriodSwitch } from "@/views/app-period-switch"
import { ComponentSwitch } from "@/views/component-switch"
import { EnvironmentSwitch } from "@/views/environment-switch"

/**
 * An analytics page's switches, in one row: its component, the environment the apps sent from that
 * it shows, and its period in days. Each change keeps the others, in the page's address.
 */
export function AnalyticsSwitches({
  project,
  components,
  component,
  environments,
  routeOf,
}: {
  readonly project: ProjectKey
  /** The project's components, in the order that gives each its color. */
  readonly components: ReadonlyArray<ComponentKey>
  readonly component: ComponentKey | undefined
  readonly environments: Environments
  /** The page's own address, of a component and an environment. */
  readonly routeOf: (shown: { readonly component?: ComponentKey; readonly environment?: EnvironmentKey }) => Route
}) {
  const environment = environments.shown
  const inShown = environment === undefined ? {} : { environment }
  return (
    <>
      {components.length > 1 && (
        <ComponentSwitch
          components={components}
          value={component}
          allowAll
          onChange={(picked) =>
            navigate(routeOf({ ...(picked === undefined ? {} : { component: picked }), ...inShown }), { replace: true })
          }
        />
      )}
      <EnvironmentSwitch
        project={project}
        environments={environments}
        routeOf={(picked) => routeOf({ ...(component === undefined ? {} : { component }), environment: picked })}
      />
      <AppPeriodSwitch />
    </>
  )
}
