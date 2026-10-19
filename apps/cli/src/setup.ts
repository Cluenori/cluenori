import { Console, Effect } from "effect"
import { Command } from "effect/cli"

import { wrangler } from "./attached.ts"

/** `./setup`: Cluenori in the Cloudflare account Wrangler signs in to. */
export const setup = Command.make("setup", {}, () =>
  Effect.gen(function* () {
    yield* Console.log("Deploying Cluenori to your Cloudflare account. Wrangler signs you in first if it needs to.\n")
    yield* wrangler(["deploy"])
    yield* Console.log("\nCluenori is deployed at the URL above. /api/health answers 204 when it is serving.")
  }),
).pipe(Command.withDescription("Deploy Cluenori to your Cloudflare account."))
