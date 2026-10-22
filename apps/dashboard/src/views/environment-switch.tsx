import type { EnvironmentKey, ProjectKey } from "@cluenori/foundation"
import { useAtomSet } from "@effect/atom-react"

import { chosenEnvironmentAtom } from "@/project-data"
import type { Environments } from "@/project-facts"
import type { Route } from "@/router"
import { navigate } from "@/router"
import { Segmented } from "@/views/segmented"

/**
 * Which environment a project's page shows, beside its component and period switches: one click
 * among those its telemetry named lately, production first, each production one saying so as you
 * point at it. One alone is said as text; none, on a deployment that doesn't say, shows nothing. A
 * pick goes into the address, and is remembered for the project's other pages.
 */
export function EnvironmentSwitch({
  project,
  environments,
  routeOf,
}: {
  readonly project: ProjectKey
  readonly environments: Environments
  /** The page's own address, showing `environment`. */
  readonly routeOf: (environment: EnvironmentKey) => Route
}) {
  const remember = useAtomSet(chosenEnvironmentAtom(project))
  const { shown, offered, production } = environments
  if (shown === undefined) {
    return null
  }
  if (offered.length <= 1) {
    return (
      <span className="flex h-9 items-center gap-2 text-sm">
        <span className="text-muted-foreground">Environment</span>
        {shown}
      </span>
    )
  }
  return (
    <Segmented
      label="Environment"
      options={offered.map((environment) => ({
        value: environment,
        label: environment,
        ...(production.includes(environment) ? { description: "Production" } : {}),
      }))}
      value={shown}
      onChange={(picked) => {
        remember(picked)
        navigate(routeOf(picked), { replace: true })
      }}
    />
  )
}
