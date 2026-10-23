import type { ComponentKey, EnvironmentKey, ProjectKey } from "@cluenori/foundation"
import { useAtomValue } from "@effect/atom-react"
import { AsyncResult } from "effect/reactivity"

import { appHealthAtom, chosenEnvironmentAtom, projectAtom } from "@/project-data"
import type { Environments } from "@/project-facts"
import { appEnvironmentsOf } from "@/project-facts"

/**
 * The environments the analytics pages offer, and the one they show (`appEnvironmentsOf`): those the
 * apps sent from over the period, by the releases' app health of every environment, which the pages
 * show too, and the project's production environments. Undefined while those answers wait, so the pages ask their questions once, of the right
 * environment; when it fails, the one chosen, and the pages show their own failures.
 */
export const useAppEnvironments = (
  project: ProjectKey,
  component: ComponentKey | undefined,
  named: EnvironmentKey | undefined,
): Environments | undefined => {
  const detail = useAtomValue(projectAtom(project))
  const picked = useAtomValue(chosenEnvironmentAtom(project))
  const health = useAtomValue(appHealthAtom({ project, ...(component === undefined ? {} : { component }) }))
  const chosen = named ?? picked
  const production = AsyncResult.isSuccess(detail) ? (detail.value.settings?.productionEnvironments ?? []) : []
  // Production orders what is offered, so the project's answer is waited for too.
  if (AsyncResult.isInitial(detail)) {
    return undefined
  }
  if (AsyncResult.isSuccess(health)) {
    return appEnvironmentsOf(
      health.value.releases.map((each) => each.release.environment),
      production,
      chosen,
    )
  }
  if (AsyncResult.isFailure(health)) {
    return { ...(chosen === undefined ? {} : { shown: chosen }), offered: [], production }
  }
  return undefined
}
