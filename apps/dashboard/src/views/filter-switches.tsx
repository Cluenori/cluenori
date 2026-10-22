import type { ComponentKey, ProjectKey } from "@cluenori/foundation"

import type { Environments } from "@/project-facts"
import type { Filters, Route } from "@/router"
import { navigate } from "@/router"
import { ComponentSwitch } from "@/views/component-switch"
import { EnvironmentSwitch } from "@/views/environment-switch"
import { PeriodSwitch } from "@/views/period-switch"
import { ReleaseChip } from "@/views/release-chip"

/**
 * A page's switches, in one row: its component, where the page has that switch; its environment;
 * the release it shows, as a chip that removes it; and the period. Each change keeps the others,
 * in the page's address.
 */
export function FilterSwitches({
  project,
  components,
  filters,
  environments,
  routeOf,
}: {
  readonly project: ProjectKey
  /** The project's components, in the order that gives each its color, for a page that switches them. */
  readonly components?: ReadonlyArray<ComponentKey>
  /** What the page shows, its environment the one `environments` shows. */
  readonly filters: Filters
  readonly environments: Environments
  /** The page's own address, with other filters. */
  readonly routeOf: (filters: Filters) => Route
}) {
  const { component: _, ...everyComponent } = filters
  const { release: __, ...everyRelease } = filters
  const go = (next: Filters) => navigate(routeOf(next), { replace: true })
  const { component, environment, release } = filters
  return (
    <>
      {components !== undefined && (
        <ComponentSwitch
          components={components}
          value={component}
          allowAll
          onChange={(picked) => go(picked === undefined ? everyComponent : { ...filters, component: picked })}
        />
      )}
      <EnvironmentSwitch
        project={project}
        environments={environments}
        routeOf={(picked) => routeOf({ ...filters, environment: picked })}
      />
      {release !== undefined && (
        <ReleaseChip
          release={release}
          releasePage={
            component === undefined
              ? undefined
              : { page: "release", project, component, release, ...(environment === undefined ? {} : { environment }) }
          }
          onRemove={() => go(everyRelease)}
        />
      )}
      <PeriodSwitch />
    </>
  )
}
