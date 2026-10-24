import { Console, Effect, FileSystem, Option, Result, Schema } from "effect"
import { Argument, Command } from "effect/cli"
import { ChildProcess, ChildProcessSpawner } from "effect/process"

import { type MutantStatus, scoreOf, tallyOf } from "./mutation-score.ts"
import { shardsOf, type SourceFile } from "./mutation-shards.ts"
import { mutationTargets } from "./mutation-targets.ts"
import { refuse } from "./refuse.ts"

/** `cluenori mutation report` found a package below its floor, or a shard without its report, and printed them. */
export class MutationReportFailed extends Schema.TaggedError<MutationReportFailed>()("MutationReportFailed", {
  problems: Schema.Int,
}) {}

// What a finished run's JSON report says, of what the score needs. A status the type doesn't list,
// such as Pending, means the run didn't finish, and the report is refused.
const MutationReport = Schema.Struct({
  files: Schema.Record(
    Schema.String,
    Schema.Struct({
      mutants: Schema.Array(
        Schema.Struct({
          status: Schema.Literals([
            "Killed",
            "Timeout",
            "Survived",
            "NoCoverage",
            "CompileError",
            "RuntimeError",
            "Ignored",
          ]),
        }),
      ),
    }),
  ),
})

const decodeReport = Schema.decodeEffect(Schema.fromJsonString(MutationReport))

// The matrix GitHub Actions expands into one job for each shard.
const Matrix = Schema.Struct({
  include: Schema.Array(
    Schema.Struct({ folder: Schema.String, shard: Schema.Int, shards: Schema.Int, mutate: Schema.String }),
  ),
})

const encodeMatrix = Schema.encodeEffect(Schema.fromJsonString(Matrix))

// A package's TypeScript in `src` as git tracks it, without declarations, by its path in the
// package's folder, where Stryker runs.
const sourceFilesOf = Effect.fn("sourceFilesOf")(function* (folder: string) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const fs = yield* FileSystem.FileSystem
  const tracked = yield* spawner.lines(ChildProcess.make("git", ["ls-files", "--", `${folder}/src`])).pipe(Effect.orDie)
  const sources = tracked.filter((path) => /\.tsx?$/.test(path) && !path.endsWith(".d.ts"))
  return yield* Effect.forEach(sources, (path) =>
    fs.readFileString(path).pipe(
      Effect.orDie,
      Effect.map((text): SourceFile => ({ path: path.slice(folder.length + 1), lines: text.split("\n").length - 1 })),
    ),
  )
})

// Every target's shards, from the files of the commit checked out, so the plan and the report agree.
const plannedShards = Effect.forEach(mutationTargets, (target) =>
  Effect.gen(function* () {
    const shards = shardsOf(yield* sourceFilesOf(target.folder))
    if (shards.length === 0) {
      return yield* refuse(`${target.folder} has no TypeScript in src to mutate: take it out of mutation-targets.ts.`)
    }
    return { target, shards }
  }),
)

/**
 * `cluenori mutation plan`: one line of JSON, the matrix of CI jobs: each target's shards, with the
 * files each mutates, comma-separated, as Stryker's `--mutate` takes them.
 */
const plan = Command.make("plan", {}, () =>
  Effect.gen(function* () {
    const planned = yield* plannedShards
    const include = planned.flatMap(({ target, shards }) =>
      shards.map((paths, index) => ({
        folder: target.folder,
        shard: index + 1,
        shards: shards.length,
        mutate: paths.join(","),
      })),
    )
    yield* Console.log(yield* encodeMatrix({ include }).pipe(Effect.orDie))
  }),
).pipe(Command.withDescription("Print the matrix of mutation testing's CI jobs, as JSON."))

const percent = (score: number) => `${score.toFixed(2)}%`

/**
 * `cluenori mutation report <reports>`: each target's score, from every shard's report, at
 * `<reports>/<folder>/shard-<n>.json`, as a Markdown table. Fails when a shard has no finished report,
 * or a score is under its floor; a package with a missing shard has no score, not a partial one.
 */
const report = Command.make(
  "report",
  {
    reports: Argument.Directory("reports", { mustExist: true }).pipe(
      Argument.withDescription("The folder with each shard's Stryker JSON report, at <folder>/shard-<n>.json."),
    ),
  },
  ({ reports }) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const planned = yield* plannedShards
      const problems: Array<string> = []
      const raises: Array<string> = []
      const rows = [
        "| Package | Mutants | Caught | Survived | Not covered | Score | Floor |",
        "|---|---|---|---|---|---|---|",
      ]
      for (const { target, shards } of planned) {
        const statuses: Array<MutantStatus> = []
        let complete = true
        for (let shard = 1; shard <= shards.length; shard++) {
          const path = `${reports}/${target.folder}/shard-${shard}.json`
          if (!(yield* fs.exists(path).pipe(Effect.orDie))) {
            problems.push(
              `${target.folder}: shard ${shard} of ${shards.length} has no report; its job failed or stopped.`,
            )
            complete = false
            continue
          }
          const decoded = yield* fs.readFileString(path).pipe(Effect.orDie, Effect.flatMap(decodeReport), Effect.result)
          if (Result.isFailure(decoded)) {
            problems.push(`${path}: isn't a finished Stryker report: ${decoded.failure.message}`)
            complete = false
            continue
          }
          for (const file of Object.values(decoded.success.files)) {
            statuses.push(...file.mutants.map((mutant) => mutant.status))
          }
        }
        const tally = tallyOf(statuses)
        const score = complete ? scoreOf(tally) : Option.none()
        const floor = target.floor === undefined ? "none yet" : percent(target.floor)
        if (Option.isSome(score) && target.floor !== undefined && score.value < target.floor) {
          problems.push(`${target.folder}: ${percent(score.value)} is under its floor, ${floor}.`)
        }
        if (Option.isSome(score) && (target.floor === undefined || score.value > target.floor)) {
          raises.push(`${target.folder}: ${Math.floor(score.value * 100) / 100}`)
        }
        const counted = complete ? `${tally.caught + tally.survived + tally.notCovered}` : "unknown"
        rows.push(
          `| ${target.folder} | ${counted} | ${complete ? tally.caught : "unknown"} | ${complete ? tally.survived : "unknown"} | ${complete ? tally.notCovered : "unknown"} | ${Option.match(score, { onNone: () => "unknown", onSome: percent })} | ${floor} |`,
        )
      }
      yield* Console.log(rows.join("\n"))
      if (raises.length > 0) {
        yield* Console.log(
          `\nFloors to raise in tools/src/mutation-targets.ts:\n\n${raises.map((line) => `- ${line}`).join("\n")}`,
        )
      }
      if (problems.length > 0) {
        for (const problem of problems) {
          yield* Console.error(problem)
        }
        return yield* new MutationReportFailed({ problems: problems.length })
      }
    }),
).pipe(Command.withDescription("Score each package from its shards' Stryker reports, and check it against its floor."))

/** `cluenori mutation ...`: mutation testing's CI jobs, planned and scored (`.github/workflows/mutation.yml`). */
export const mutation = Command.make("mutation").pipe(
  Command.withDescription("Plan mutation testing's CI jobs, and score their reports."),
  Command.withSubcommands([plan, report]),
)
