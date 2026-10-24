import { checkWorkspace } from "@cluenori/workspace-rules"
import { Console, Effect, FileSystem, Schema } from "effect"
import { Command } from "effect/cli"
import { ChildProcess, ChildProcessSpawner } from "effect/process"

import { dependencyRules } from "./dependency-rules.ts"
import { generatedFiles } from "./generated-files.ts"

/** `bun run check` found problems, and printed them. */
export class CheckFailed extends Schema.TaggedError<CheckFailed>()("CheckFailed", { problems: Schema.Int }) {}

// Comments that silence the compiler or the linter. A rule that is wrong for a case changes in its
// configuration file instead (AGENTS.md, "Let the compiler review first").
const suppression = "(oxlint|eslint)-(disable|enable)|@ts-(ignore|expect-error|nocheck)"

const findSuppressions = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  // Tracked and new files, not ignored ones; Markdown may mention the comments it forbids.
  return yield* spawner
    .lines(ChildProcess.make("git", ["grep", "-n", "-E", "--untracked", suppression, "--", ":!*.md"]))
    .pipe(Effect.orDie)
})

// The generated files whose committed text isn't what generating them writes now.
const staleFiles = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const stale: Array<string> = []
  for (const file of generatedFiles) {
    const expected = yield* file.text
    const exists = yield* fs.exists(file.path).pipe(Effect.orDie)
    const committed = exists ? yield* fs.readFileString(file.path).pipe(Effect.orDie) : undefined
    if (committed !== expected) {
      stale.push(file.path)
    }
  }
  return stale
})

/** What the compiler and the linter can't check: dependency rules, suppressions, and generated files. */
export const check = Command.make("check", {}, () =>
  Effect.gen(function* () {
    const violations = yield* checkWorkspace(".", dependencyRules)
    for (const violation of violations) {
      yield* Console.error(`${violation.folder}: ${violation.message}`)
    }
    const suppressions = yield* findSuppressions
    for (const line of suppressions) {
      yield* Console.error(`${line}: silences a check. Fix the code, or change the rule in its configuration file.`)
    }
    const stale = yield* staleFiles
    for (const path of stale) {
      yield* Console.error(`${path}: is out of date with the API definition. Run \`bun run generate\`.`)
    }

    const problems = violations.length + suppressions.length + stale.length
    if (problems > 0) {
      yield* Console.error(`\n${problems === 1 ? "1 problem" : `${problems} problems`}.`)
      return yield* new CheckFailed({ problems })
    }
    yield* Console.log("Dependency rules, suppressions, and generated files are in order.")
  }),
).pipe(Command.withDescription("Check dependency rules, suppression comments, and generated files."))
