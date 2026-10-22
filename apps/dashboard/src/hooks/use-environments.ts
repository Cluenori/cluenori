import type { EnvironmentKey, ProjectKey } from "@cluenori/foundation"
import { useAtomValue } from "@effect/atom-react"
import { AsyncResult } from "effect/reactivity"

import { chosenEnvironmentAtom, projectAtom } from "@/project-data"
import type { Environments } from "@/project-facts"
import { environmentsOf } from "@/project-facts"

/**
 * The environments a project's page offers, and the one it shows: the one its address names, else
 * the one picked last on the project, else its production (`environmentsOf`). Undefined only while
 * that waits for the project's answer, so a page asks its questions once, of the right environment.
 * When the project's answer fails, the page shows its own failure, of no environment.
 */
export const useEnvironments = (project: ProjectKey, named: EnvironmentKey | undefined): Environments | undefined => {
  const detail = useAtomValue(projectAtom(project))
  const picked = useAtomValue(chosenEnvironmentAtom(project))
  const chosen = named ?? picked
  if (AsyncResult.isSuccess(detail)) {
    return environmentsOf(detail.value, chosen)
  }
  if (chosen !== undefined || AsyncResult.isFailure(detail)) {
    return environmentsOf({}, chosen)
  }
  return undefined
}
