import { BunRuntime, BunServices } from "@effect/platform-bun"
import { Cause, Console, Effect, Layer } from "effect"
import { CliOutput, Command } from "effect/cli"

import { cluenori } from "./cluenori.ts"
import { printable } from "./terminal-text.ts"

// Cluenori has no releases yet; this becomes the release version with the first one.
const version = "unreleased"

// What the CLI prints holds text others wrote (log lines, error messages, feed and event names),
// so it reaches the terminal only as text, never as escape sequences the terminal acts on.
const shown = (args: ReadonlyArray<unknown>) => args.map((arg) => (typeof arg === "string" ? printable(arg) : arg))
const terminal = Console.consoleWith((current) =>
  Effect.succeed<Console.Console>(
    Object.assign(Object.create(current), {
      log: (...args: ReadonlyArray<unknown>) => current.log(...shown(args)),
      error: (...args: ReadonlyArray<unknown>) => current.error(...shown(args)),
    }),
  ),
)

const program = cluenori.pipe(
  Command.run({ version }),
  // An expected failure has already printed what went wrong and exits with code 1. A defect is a
  // bug, and prints in full.
  Effect.tapCause((cause) => (Cause.hasDies(cause) ? Effect.logError(cause) : Effect.void)),
  Effect.provide(
    Layer.mergeAll(
      BunServices.layer,
      // Help and its errors in plain text: colors would be escape sequences, which `terminal` writes out.
      CliOutput.layer(CliOutput.defaultFormatter({ colors: false })),
    ),
  ),
  Effect.provideServiceEffect(Console.Console, terminal),
)

BunRuntime.runMain(program, { disableErrorReporting: true })
