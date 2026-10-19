import { Console, Effect } from "effect"
import { Command } from "effect/cli"

import { attached, wrangler } from "./attached.ts"

/** `./update`: the newest version of this clone's upstream branch, installed and deployed. */
export const update = Command.make("update", {}, () =>
  Effect.gen(function* () {
    yield* Console.log("Getting the new version.")
    // Not handled: a clone with commits of its own. `git pull --ff-only` refuses, says why, and
    // leaves the clone as it was; merging upstream into edited modules is the person's call.
    yield* attached("git", ["pull", "--ff-only"], {})
    yield* attached("bun", ["install", "--frozen-lockfile"], {})
    yield* Console.log("\nDeploying it.\n")
    yield* wrangler(["deploy"])
  }),
).pipe(Command.withDescription("Install a new version of Cluenori and deploy it."))
