import { Console, Effect, Schema } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"

import type { CloudflareAccountId } from "./api-settings.ts"

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

/**
 * Runs a program attached to this terminal, like `attached`, and returns its exit code instead of
 * failing on one: for questions like "is it there?", where a code other than 0 is an answer.
 */
export const attachedExitCode = Effect.fn("attachedExitCode")(function* (
  command: string,
  args: ReadonlyArray<string>,
  options: { readonly cwd?: string; readonly env?: Readonly<Record<string, string>> },
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  return yield* spawner
    .exitCode(
      ChildProcess.make(command, args, {
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        ...(options.env === undefined ? {} : { env: { ...options.env }, extendEnv: true }),
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
        detached: false,
      }),
    )
    .pipe(Effect.orDie)
})

/** Where Wrangler acts: in `account` when given, so a sign-in that reaches several acts in the deployment's. */
interface WranglerOptions {
  readonly account?: CloudflareAccountId
  readonly env?: Readonly<Record<string, string>>
}

const wranglerEnv = (options: WranglerOptions) =>
  options.account === undefined && options.env === undefined
    ? {}
    : { env: { ...options.env, ...(options.account === undefined ? {} : { CLOUDFLARE_ACCOUNT_ID: options.account }) } }

/** Runs Wrangler, from the Worker's package, attached to this terminal, with `env` added. */
export const wrangler = (args: ReadonlyArray<string>, options: WranglerOptions = {}) =>
  attached("bun", ["run", "wrangler", ...args], { cwd: "apps/worker", ...wranglerEnv(options) })

/** Runs Wrangler like `wrangler`, and returns its exit code: for "is it there?". */
export const wranglerExitCode = (args: ReadonlyArray<string>, options: WranglerOptions = {}) =>
  attachedExitCode("bun", ["run", "wrangler", ...args], { cwd: "apps/worker", ...wranglerEnv(options) })

/** Builds the dashboard's files, which the Worker serves beside its API (wrangler.jsonc, `assets`). */
export const buildDashboard = attached("bun", ["run", "build"], { cwd: "apps/dashboard" })
