import { Command } from "effect/cli"

import { feature, person } from "./analytics-commands.ts"
import { error, errors, logMessages, logs, trace } from "./errors-commands.ts"
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
import { versionPolicy } from "./version-policy-commands.ts"
import { version } from "./versions-commands.ts"

/**
 * The `cluenori` command. `./run`, `./setup`, `./update`, and `./cluenori` call it. Run it from the
 * repository's root. The repository's own commands are `tools`.
 */
export const cluenori = Command.make("cluenori").pipe(
  Command.withDescription(
    "Run Cluenori, deploy it to Cloudflare, ask it about your projects, and promote their releases.",
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
    logMessages,
    trace,
    feature,
    person,
    incidents,
    acknowledge,
    monitors,
    monitor,
    releases,
    release,
    delivery,
    version,
    versionPolicy,
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
  ]),
)
