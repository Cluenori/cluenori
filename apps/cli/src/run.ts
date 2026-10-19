import { Console, Effect } from "effect"
import { Command } from "effect/cli"

import { wrangler } from "./attached.ts"

/** `./run`: Cluenori on this computer, until Ctrl+C. */
export const run = Command.make("run", {}, () =>
  Effect.gen(function* () {
    yield* Console.log("Starting Cluenori on this computer. Its data stays in apps/worker/.wrangler/state.")
    yield* Console.log("The API answers under /api; its OpenAPI document is /api/openapi.json.\n")
    yield* wrangler(["dev"])
  }),
).pipe(Command.withDescription("Run Cluenori on this computer, with local storage."))
