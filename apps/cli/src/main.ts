import { BunRuntime, BunServices } from "@effect/platform-bun"
import { Cause, Effect } from "effect"
import { Command } from "effect/cli"

import { cluenori } from "./cluenori.ts"

// Cluenori has no releases yet; this becomes the release version with the first one.
const version = "unreleased"

const program = cluenori.pipe(
  Command.run({ version }),
  // An expected failure has already printed what went wrong and exits with code 1. A defect is a
  // bug, and prints in full.
  Effect.tapCause((cause) => (Cause.hasDies(cause) ? Effect.logError(cause) : Effect.void)),
  Effect.provide(BunServices.layer),
)

BunRuntime.runMain(program, { disableErrorReporting: true })
