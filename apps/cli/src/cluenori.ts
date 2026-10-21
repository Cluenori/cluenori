import { Command } from "effect/cli"

import { appleModels } from "./apple-models.ts"
import { check } from "./check.ts"
import { error, errors, logs, trace } from "./errors-commands.ts"
import { generate } from "./generate.ts"
import { acknowledge, incidents, monitor, monitors } from "./incidents-commands.ts"
import { load, operation, operations } from "./operations-commands.ts"
import { phone, phones } from "./phones-commands.ts"
import { component, project } from "./projects-commands.ts"
import { push } from "./push-commands.ts"
import { run } from "./run.ts"
import { setup } from "./setup.ts"
import { today } from "./today-command.ts"
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
    today,
    project,
    component,
    operations,
    operation,
    load,
    errors,
    error,
    logs,
    trace,
    incidents,
    acknowledge,
    monitors,
    monitor,
    phones,
    phone,
    push,
    check,
    generate,
    appleModels,
  ]),
)
