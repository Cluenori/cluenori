import { Console, Effect, FileSystem, Option, Result, Schema } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import { ChildProcess, ChildProcessSpawner } from "effect/process"

import { appleModelsPath } from "./apple-models.ts"
import { floorOf, type MutantStatus, scoreOf, tallyOf } from "./mutation-score.ts"
import { shardsOf, type SourceFile, testedPaths } from "./mutation-shards.ts"
import { type MutationTarget, mutationTargets } from "./mutation-targets.ts"
import { refuse } from "./refuse.ts"

/** `tools mutation report` found a package below its floor, or a shard without its report, and printed them. */
export class MutationReportFailed extends Schema.TaggedError<MutationReportFailed>()("MutationReportFailed", {
  problems: Schema.Int,
}) {}

// What a finished run's JSON report says of each mutant, of what the score and the list of survivors
// need. A status the type doesn't list, such as Pending, means the run didn't finish, and the report
// is refused.
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
          mutatorName: Schema.String,
          replacement: Schema.optionalKey(Schema.String),
          location: Schema.Struct({ start: Schema.Struct({ line: Schema.Int, column: Schema.Int }) }),
        }),
      ),
    }),
  ),
})

type MutationReport = typeof MutationReport.Type

const decodeReport = Schema.decodeEffect(Schema.fromJsonString(MutationReport))

// The matrix GitHub Actions expands into one job for each shard.
const Matrix = Schema.Struct({
  include: Schema.Array(
    Schema.Struct({ folder: Schema.String, shard: Schema.Int, shards: Schema.Int, mutate: Schema.String }),
  ),
})

const encodeMatrix = Schema.encodeEffect(Schema.fromJsonString(Matrix))

const onlyFolders = Flag.String("only").pipe(
  Flag.optional,
  Flag.withDescription(
    "Only these packages' folders, comma-separated, such as product/engines/phones. All when left out.",
  ),
)

// The targets `--only` names, in the table's order; all of them without it. A folder the table
// doesn't list is refused, naming the ones it does.
const targetsOf = Effect.fn("targetsOf")(function* (folders: Option.Option<string>) {
  if (Option.isNone(folders)) {
    return mutationTargets
  }
  const named = new Set(folders.value.split(/[\s,]+/).filter((folder) => folder !== ""))
  const known = new Set(mutationTargets.map((target) => target.folder))
  const unknown = [...named].filter((folder) => !known.has(folder))
  if (named.size === 0 || unknown.length > 0) {
    return yield* refuse(
      `${unknown.length > 0 ? `${unknown.join(", ")} isn't a package mutation testing measures` : "--only names no package"}. They are: ${[...known].join(", ")}.`,
    )
  }
  return mutationTargets.filter((target) => named.has(target.folder))
})

// A package's TypeScript in `src` as git tracks it, without declarations, by its path in the
// package's folder, where Stryker runs, and whether its tests, `test/**/*.test.ts`, load it. A
// generated file isn't measured: what writes it is, in tools.
const sourceFilesOf = Effect.fn("sourceFilesOf")(function* (folder: string) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const fs = yield* FileSystem.FileSystem
  const tracked = yield* spawner
    .lines(ChildProcess.make("git", ["ls-files", "--", `${folder}/src`, `${folder}/test`]))
    .pipe(Effect.orDie)
  const files = yield* Effect.forEach(
    tracked.filter((path) => /\.tsx?$/.test(path) && !path.endsWith(".d.ts")),
    (path) =>
      fs.readFileString(path).pipe(
        Effect.orDie,
        Effect.map((text) => ({ path: path.slice(folder.length + 1), text })),
      ),
  )
  const tested = testedPaths(
    new Map(files.map(({ path, text }) => [path, text])),
    files.map(({ path }) => path).filter((path) => path.startsWith("test/") && /\.test\.tsx?$/.test(path)),
  )
  return files
    .filter(({ path }) => path.startsWith("src/") && `${folder}/${path}` !== appleModelsPath)
    .map(({ path, text }): SourceFile => ({ path, lines: text.split("\n").length - 1, tested: tested.has(path) }))
})

// Each target's shards, from the files of the commit checked out, so the plan and the report agree.
const plannedShards = (targets: ReadonlyArray<MutationTarget>) =>
  Effect.forEach(targets, (target) =>
    Effect.gen(function* () {
      const shards = shardsOf(yield* sourceFilesOf(target.folder))
      if (shards.length === 0) {
        return yield* refuse(`${target.folder} has no TypeScript in src to mutate: take it out of mutation-targets.ts.`)
      }
      return { target, shards }
    }),
  )

// Each target's shard reports, at `<reports>/<folder>/shard-<n>.json`: its reports when every shard
// has a finished one, and what is wrong with each that doesn't.
const readShards = Effect.fn("readShards")(function* (reports: string, targets: ReadonlyArray<MutationTarget>) {
  const fs = yield* FileSystem.FileSystem
  const planned = yield* plannedShards(targets)
  return yield* Effect.forEach(planned, ({ target, shards }) =>
    Effect.gen(function* () {
      const read: Array<MutationReport> = []
      const problems: Array<string> = []
      for (let shard = 1; shard <= shards.length; shard++) {
        const path = `${reports}/${target.folder}/shard-${shard}.json`
        if (!(yield* fs.exists(path).pipe(Effect.orDie))) {
          problems.push(
            `${target.folder}: shard ${shard} of ${shards.length} has no report; its job failed or stopped.`,
          )
          continue
        }
        const decoded = yield* fs.readFileString(path).pipe(Effect.orDie, Effect.flatMap(decodeReport), Effect.result)
        if (Result.isFailure(decoded)) {
          problems.push(`${path}: isn't a finished Stryker report: ${decoded.failure.message}`)
          continue
        }
        read.push(decoded.success)
      }
      return { target, reports: read, problems }
    }),
  )
})

const reportsArgument = Argument.Directory("reports", { mustExist: true }).pipe(
  Argument.withDescription("The folder with each shard's Stryker JSON report, at <folder>/shard-<n>.json."),
)

/**
 * `tools mutation plan`: one line of JSON, the matrix of CI jobs: each target's shards, with the
 * files each mutates, comma-separated, as Stryker's `--mutate` takes them.
 */
const plan = Command.make("plan", { only: onlyFolders }, ({ only }) =>
  Effect.gen(function* () {
    const planned = yield* plannedShards(yield* targetsOf(only))
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
 * `tools mutation report <reports>`: each target's score, from every shard's report, as a Markdown
 * table. Fails when a shard has no finished report, or a score is under its floor; a package with a
 * missing shard has no score, not a partial one.
 */
const report = Command.make("report", { reports: reportsArgument, only: onlyFolders }, ({ reports, only }) =>
  Effect.gen(function* () {
    const read = yield* readShards(reports, yield* targetsOf(only))
    const problems: Array<string> = []
    const raises: Array<string> = []
    const rows = [
      "| Package | Mutants | Caught | Survived | Not covered | Score | Floor |",
      "|---|---|---|---|---|---|---|",
    ]
    for (const { target, reports: shardReports, problems: missing } of read) {
      problems.push(...missing)
      const complete = missing.length === 0
      const statuses: Array<MutantStatus> = shardReports.flatMap((shard) =>
        Object.values(shard.files).flatMap((file) => file.mutants.map((mutant) => mutant.status)),
      )
      const tally = tallyOf(statuses)
      const score = complete ? scoreOf(tally) : Option.none()
      const floor = target.floor === undefined ? "none yet" : percent(target.floor)
      if (Option.isSome(score) && target.floor !== undefined && score.value < target.floor) {
        problems.push(`${target.folder}: ${percent(score.value)} is under its floor, ${floor}.`)
      }
      const raised = Option.map(score, floorOf)
      if (Option.isSome(raised) && (target.floor === undefined || raised.value > target.floor)) {
        raises.push(`${target.folder}: ${raised.value}`)
      }
      const count = (value: number) => (complete ? `${value}` : "unknown")
      rows.push(
        `| ${target.folder} | ${count(tally.caught + tally.survived + tally.notCovered)} | ${count(tally.caught)} | ${count(tally.survived)} | ${count(tally.notCovered)} | ${Option.match(score, { onNone: () => "unknown", onSome: percent })} | ${floor} |`,
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

// Machine text, so sorted by code point, the same on every machine.
const byCodePoint = (left: string, right: string) => {
  if (left === right) {
    return 0
  }
  return left < right ? -1 : 1
}

// One line of a mutant's replacement, so a list reads one mutant to a line.
const oneLine = (text: string) => {
  const line = text.replace(/\s+/g, " ").trim()
  return line.length > 100 ? `${line.slice(0, 99)}…` : line
}

/**
 * `tools mutation survivors <reports>`: every mutant no test caught, as Markdown: by package and file,
 * each at its line and column in the repository, with the mutator and what it put there. Survived
 * and not covered are listed apart: a test ran and passed, or no test ran the code at all. Shards
 * without a finished report are named at the top, as their mutants are missing.
 */
const survivors = Command.make("survivors", { reports: reportsArgument, only: onlyFolders }, ({ reports, only }) =>
  Effect.gen(function* () {
    const read = yield* readShards(reports, yield* targetsOf(only))
    const lines: Array<string> = []
    const missing = read.flatMap(({ problems }) => problems)
    if (missing.length > 0) {
      lines.push(
        "Not measured, as these shards have no finished report:",
        "",
        ...missing.map((line) => `- ${line}`),
        "",
      )
    }
    for (const { target, reports: shardReports } of read) {
      const mutants = shardReports
        .flatMap((shard) =>
          Object.entries(shard.files).flatMap(([path, file]) =>
            file.mutants.map((mutant) => ({ path: `${target.folder}/${path}`, ...mutant })),
          ),
        )
        .filter((mutant) => mutant.status === "Survived" || mutant.status === "NoCoverage")
        .toSorted(
          (left, right) =>
            byCodePoint(left.path, right.path) ||
            left.location.start.line - right.location.start.line ||
            left.location.start.column - right.location.start.column,
        )
      if (mutants.length === 0) {
        continue
      }
      lines.push(`## ${target.folder}`, "")
      for (const status of ["Survived", "NoCoverage"] as const) {
        const listed = mutants.filter((mutant) => mutant.status === status)
        if (listed.length > 0) {
          lines.push(status === "Survived" ? "Survived, though tests ran it:" : "Not covered, as no test ran it:", "")
          for (const mutant of listed) {
            const replacement = mutant.replacement === undefined ? "" : `: \`${oneLine(mutant.replacement)}\``
            lines.push(
              `- ${mutant.path}:${mutant.location.start.line}:${mutant.location.start.column} ${mutant.mutatorName}${replacement}`,
            )
          }
          lines.push("")
        }
      }
    }
    yield* Console.log(lines.length === 0 ? "Every mutant was caught." : lines.join("\n"))
  }),
).pipe(Command.withDescription("List every mutant no test caught, from the shards' Stryker reports, as Markdown."))

/** `tools mutation ...`: mutation testing's CI jobs, planned and scored (`.github/workflows/mutation.yml`). */
export const mutation = Command.make("mutation").pipe(
  Command.withDescription("Plan mutation testing's CI jobs, score their reports, and list what survived."),
  Command.withSubcommands([plan, report, survivors]),
)
