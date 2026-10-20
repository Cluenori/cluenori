import { Console, Effect } from "effect"
import { Command } from "effect/cli"

import { ensureLocalApiSettings } from "./api-settings.ts"
import { buildDashboard, wrangler } from "./attached.ts"

/** `./run`: Cluenori on this computer, until Ctrl+C. */
export const run = Command.make("run", {}, () =>
  Effect.gen(function* () {
    yield* ensureLocalApiSettings
    yield* buildDashboard
    yield* Console.log("\nStarting Cluenori on this computer. Its data stays in apps/worker/.wrangler/state.")
    yield* Console.log("The dashboard opens at its address; sign in with the API token, CLUENORI_API_TOKEN in")
    yield* Console.log("apps/worker/.dev.vars, which ./cluenori also uses. The API answers under /api; its")
    yield* Console.log("OpenAPI document is /api/openapi.json.\n")
    yield* wrangler(["dev"])
  }),
).pipe(Command.withDescription("Run Cluenori on this computer, with local storage."))
