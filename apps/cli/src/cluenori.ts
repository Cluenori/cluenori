import { Command } from "effect/cli"

import { appleModels } from "./apple-models.ts"
import { check } from "./check.ts"
import { error, errors, logs, trace } from "./errors-commands.ts"
import { generate } from "./generate.ts"
import { acknowledge, incidents, monitor, monitors } from "./incidents-commands.ts"
import { member, members } from "./members-commands.ts"
import { notes, notesStyle } from "./notes-commands.ts"
import { load, operation, operations } from "./operations-commands.ts"
import { phone, phones } from "./phones-commands.ts"
import { component, project } from "./projects-commands.ts"
import { push } from "./push-commands.ts"
import { delivery, promote, release, releaseApproved, releases } from "./releases-commands.ts"
import { run } from "./run.ts"
import { setup } from "./setup.ts"
import { appStore, github } from "./sources-commands.ts"
import { today } from "./today-command.ts"
import { update } from "./update.ts"
import { version } from "./versions-commands.ts"

/**
 * The `cluenori` command. `./run`, `./setup`, `./update`, and `./cluenori` call it; `bun run check`
 * and `bun run generate` call its repository commands. Run it from the repository's root.
 */
export const cluenori = Command.make("cluenori").pipe(
  Command.withDescription(
    "Run Cluenori, deploy it to Cloudflare, ask it about your projects, promote their releases, and check this repository.",
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
    releases,
    release,
    delivery,
    version,
    notes,
    notesStyle,
    promote,
    releaseApproved,
    github,
    appStore,
    members,
    member,
    phones,
    phone,
    push,
    check,
    generate,
    appleModels,
  ]),
)
