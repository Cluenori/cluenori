import { GitHub } from "@bagatka/github"
import type { ComponentKey } from "@cluenori/foundation"
import { Projects } from "@cluenori/projects"
import { Effect } from "effect"

import type { RunnerAnswer, RunnerQuery } from "./runner.ts"
import { localLabel } from "./runner.ts"

const cloud = (reason: string): RunnerAnswer => ({ runner: "cloud", reason })

/**
 * Where `component`'s build runs when its CI is told `auto`: `local` when a self-hosted runner of
 * its repository's organization labelled `local` is online, as GitHub says through the workspace's
 * app; else `cloud`, also when GitHub can't say, for a repository a user owns, or a component with
 * none. One request to GitHub; never fails.
 */
export const resolveRunner = Effect.fn("Releases.resolveRunner")(function* (
  component: ComponentKey,
  _query: RunnerQuery,
) {
  const projects = yield* Projects
  const components = yield* projects.components.pipe(Effect.catchTag("ProjectNotFound", () => Effect.succeed([])))
  const repository = components.find((each) => each.key === component)?.repository
  if (repository === undefined) {
    return cloud(`${component} isn't linked to a repository`)
  }
  const github = yield* GitHub
  return yield* github.selfHostedRunners(repository).pipe(
    Effect.map((runners): RunnerAnswer => {
      const local = runners.find((runner) => runner.online && runner.labels.includes(localLabel))
      return local === undefined
        ? cloud(`no runner labelled ${localLabel} is online`)
        : { runner: "local", reason: `${local.name} is online${local.busy ? ", busy with another job" : ""}` }
    }),
    Effect.catchTags({
      GitHubRefused: (refused) => Effect.succeed(cloud(`GitHub didn't list its runners: ${refused.reason}`)),
      GitHubUnavailable: (unavailable) => Effect.succeed(cloud(`GitHub didn't answer: ${unavailable.reason}`)),
    }),
  )
})
