import { Console, Effect, Schema } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"

/** A command exited with a code other than 0. It has already printed why. */
export class CommandFailed extends Schema.TaggedError<CommandFailed>()("CommandFailed", {
  command: Schema.String,
  exitCode: Schema.Int,
}) {}

/**
 * Runs a program attached to this terminal, so it can print and prompt (Wrangler signs in through
 * the browser and asks before it creates a workers.dev subdomain). Fails with `CommandFailed` when
 * it exits with a code other than 0.
 */
export const attached = Effect.fn("attached")(function* (
  command: string,
  args: ReadonlyArray<string>,
  options: { readonly cwd?: string; readonly env?: Readonly<Record<string, string>> },
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const exitCode = yield* spawner
    .exitCode(
      ChildProcess.make(command, args, {
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        // The program sees this terminal's environment, plus `env`.
        ...(options.env === undefined ? {} : { env: { ...options.env }, extendEnv: true }),
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
        // In this terminal's process group, so Ctrl+C reaches it and it may read the keyboard.
        detached: false,
      }),
    )
    .pipe(Effect.orDie)
  if (exitCode !== 0) {
    const line = [command, ...args].join(" ")
    yield* Console.error(`\n\`${line}\` exited with code ${exitCode}; its output above says why.`)
    return yield* new CommandFailed({ command: line, exitCode })
  }
})

/** Runs Wrangler, from the Worker's package, attached to this terminal, with `env` added. */
export const wrangler = (args: ReadonlyArray<string>, env?: Readonly<Record<string, string>>) =>
  attached("bun", ["run", "wrangler", ...args], { cwd: "apps/worker", ...(env === undefined ? {} : { env }) })
