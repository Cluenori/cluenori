import { Console, Effect, Option } from "effect"
import { Command } from "effect/cli"

import { refuse } from "./api-client.ts"
import { savedDeployment } from "./api-settings.ts"
import { attached, buildDashboard, wrangler } from "./attached.ts"
import { domainFlags, environmentFlags } from "./setup.ts"

/** `./update`: the newest version of this clone's upstream branch, installed and deployed. */
export const update = Command.make("update", {}, () =>
  Effect.gen(function* () {
    // Deploying with the wrong jurisdiction would bind a second, empty archive, so it isn't guessed.
    const saved = yield* savedDeployment
    if (Option.isNone(saved)) {
      return yield* refuse(
        "./update deploys the Cluenori ./setup made from this computer, and none is saved here. Run ./setup, giving the same answer about where data is kept as the first time.",
      )
    }
    yield* Console.log("Getting the new version.")
    // Not handled: a clone with commits of its own. `git pull --ff-only` refuses, says why, and
    // leaves the clone as it was; merging upstream into edited modules is the person's call.
    yield* attached("git", ["pull", "--ff-only"], {})
    yield* attached("bun", ["install", "--frozen-lockfile"], {})
    yield* Console.log("\nDeploying it.\n")
    yield* buildDashboard
    yield* wrangler(["deploy", ...environmentFlags(saved.value.jurisdiction), ...domainFlags(saved.value.domain)])
  }),
).pipe(Command.withDescription("Install a new version of Cluenori and deploy it."))
