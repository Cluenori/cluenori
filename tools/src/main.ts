import { BunRuntime, BunServices } from "@effect/platform-bun"
import { Cause, Effect } from "effect"
import { Command } from "effect/cli"

import { appleModels } from "./apple-models.ts"
import { check } from "./check.ts"
import { generate } from "./generate.ts"

/**
 * The repository's program: `bun run check`, `bun run generate` and `bun run generate:apple-models`
 * call it from the repository's root. Nothing of it ships: Cluenori's own command is `apps/cli`.
 */
const tools = Command.make("tools").pipe(
  Command.withDescription("Check this repository, and rewrite the files generated from code."),
  Command.withSubcommands([check, generate, appleModels]),
)

const program = tools.pipe(
  Command.run({ version: "unreleased" }),
  // An expected failure has already printed what went wrong and exits with code 1. A defect is a
  // bug, and prints in full.
  Effect.tapCause((cause) => (Cause.hasDies(cause) ? Effect.logError(cause) : Effect.void)),
  Effect.provide(BunServices.layer),
)

BunRuntime.runMain(program, { disableErrorReporting: true })
