import { Command } from "effect/cli"

import { check } from "./check.ts"
import { error, errors, logs, trace } from "./errors-commands.ts"
import { generate } from "./generate.ts"
import { component, project } from "./projects-commands.ts"
import { run } from "./run.ts"
import { operation, operations, runs } from "./runs-commands.ts"
import { setup } from "./setup.ts"
import { update } from "./update.ts"

/**
 * The `cluenori` command. `./run`, `./setup`, `./update`, and `./cluenori` call it; `bun run check`
 * and `bun run generate` call its repository commands. Run it from the repository's root.
 */
export const cluenori = Command.make("cluenori").pipe(
  Command.withDescription(
    "Run Cluenori, deploy it to Cloudflare, ask it about your projects, and check this repository.",
  ),
  Command.withSubcommands([
    run,
    setup,
    update,
    project,
    component,
    operations,
    operation,
    runs,
    errors,
    error,
    logs,
    trace,
    check,
    generate,
  ]),
)
