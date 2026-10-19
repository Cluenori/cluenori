import { Command } from "effect/cli"

import { check } from "./check.ts"
import { generate } from "./generate.ts"
import { run } from "./run.ts"
import { setup } from "./setup.ts"
import { update } from "./update.ts"

/**
 * The `cluenori` command. `./run`, `./setup`, and `./update` call it; `bun run check` and `bun run
 * generate` call its repository commands. Run it from the repository's root.
 */
export const cluenori = Command.make("cluenori").pipe(
  Command.withDescription("Run Cluenori, deploy it to Cloudflare, and check this repository."),
  Command.withSubcommands([run, setup, update, check, generate]),
)
