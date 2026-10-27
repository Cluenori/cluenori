import { BunServices } from "@effect/platform-bun"
import { assert, describe, it } from "@effect/vitest"
import { Console, Effect, FileSystem, Path, Result, Schema } from "effect"
import { Command } from "effect/cli"
import { ChildProcess, ChildProcessSpawner } from "effect/process"

import { type MutantStatus } from "../src/mutation-score.ts"
import { mutationTargets } from "../src/mutation-targets.ts"
import { mutation, MutationReportFailed } from "../src/mutation.ts"
import { Refused } from "../src/refuse.ts"

const mutant = (status: MutantStatus) => ({
  status,
  mutatorName: "BooleanLiteral",
  replacement: "false",
  location: { start: { line: 1, column: 1 } },
})

const reportOf = (statuses: ReadonlyArray<MutantStatus>) => ({
  files: { "src/a.ts": { mutants: statuses.map(mutant) } },
})

// A real, isolated repository, with two tested files and one untested file: two shards. Rooting
// filesystem reads and child processes here avoids changing the test runner's process-wide cwd.
const workspace = Effect.fn("workspace")(function* () {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const root = yield* fs.makeTempDirectoryScoped()
  yield* fs.makeDirectory(`${root}/tools/src`, { recursive: true })
  yield* fs.makeDirectory(`${root}/tools/test`)
  yield* fs.makeDirectory(`${root}/reports/tools`, { recursive: true })
  for (const name of ["a", "b", "c"]) {
    yield* fs.writeFileString(`${root}/tools/src/${name}.ts`, "export {}\n".repeat(700))
  }
  yield* fs.writeFileString(`${root}/tools/test/files.test.ts`, 'import "../src/a.ts"\nimport "../src/b.ts"\n')
  for (const args of [
    ["init", "--quiet"],
    ["add", "tools"],
  ]) {
    const code = yield* spawner.exitCode(ChildProcess.make("git", args, { cwd: root }))
    assert.strictEqual(code, 0)
  }
  const rootedFs: FileSystem.FileSystem = {
    ...fs,
    readFileString: (file, encoding) => fs.readFileString(path.resolve(root, file), encoding),
  }
  const rootedSpawner = ChildProcessSpawner.make((command) => spawner.spawn(ChildProcess.setCwd(command, root)))
  const run = Effect.fn("runMutation")(function* (args: ReadonlyArray<string>) {
    const output: Array<unknown> = []
    const errors: Array<unknown> = []
    const result = yield* Command.runWith(mutation, { version: "test", renderErrors: false })(args).pipe(
      Effect.provideService(FileSystem.FileSystem, rootedFs),
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, rootedSpawner),
      Effect.provideService(Console.Console, {
        ...console,
        log: (value) => output.push(value),
        error: (value) => errors.push(value),
      }),
      Effect.result,
    )
    const lines = yield* Schema.decodeUnknownEffect(Schema.Array(Schema.String))(output)
    const errorLines = yield* Schema.decodeUnknownEffect(Schema.Array(Schema.String))(errors)
    return { result, output: lines.join("\n"), errors: errorLines }
  })
  const writeShard = Effect.fn("writeShard")(function* (shard: number, report: string | Schema.JsonObject) {
    const text = yield* typeof report === "string"
      ? Effect.succeed(report)
      : Schema.encodeEffect(Schema.fromJsonString(Schema.Json))(report)
    yield* fs.writeFileString(`${root}/reports/tools/shard-${shard}.json`, text)
  })
  return { run, writeShard, reports: `${root}/reports` }
})

const rowOf = (output: string) => {
  const row = output.split("\n").find((line) => line.startsWith("| tools |"))
  assert.isDefined(row)
  return (row ?? "")
    .split("|")
    .slice(2, -1)
    .map((cell) => cell.trim())
}

const toolsFloor = mutationTargets.find((target) => target.folder === "tools")?.floor

describe("mutation commands", () => {
  it.effect("plans every source file once, with a tested file in each shard, and deduplicates selected packages", () =>
    Effect.gen(function* () {
      const { run } = yield* workspace()
      const { result, output } = yield* run(["plan", "--only", "tools,tools"])
      assert.isTrue(Result.isSuccess(result))
      const matrix = yield* Schema.decodeEffect(
        Schema.fromJsonString(
          Schema.Struct({
            include: Schema.Array(
              Schema.Struct({
                folder: Schema.String,
                shard: Schema.Int,
                shards: Schema.Int,
                mutate: Schema.String,
              }),
            ),
          }),
        ),
      )(output)
      assert.strictEqual(matrix.include.length, 2)
      assert.deepStrictEqual(
        matrix.include.map((entry) => entry.shard),
        [1, 2],
      )
      assert.deepStrictEqual(matrix.include.flatMap((entry) => entry.mutate.split(",")).toSorted(), [
        "src/a.ts",
        "src/b.ts",
        "src/c.ts",
      ])
      for (const entry of matrix.include) {
        assert.strictEqual(entry.folder, "tools")
        assert.strictEqual(entry.shards, 2)
        assert.isTrue(entry.mutate.split(",").some((file) => file === "src/a.ts" || file === "src/b.ts"))
      }
    }).pipe(Effect.provide(BunServices.layer)),
  )

  it.effect("aggregates all shards, counting timeouts but excluding mutants that did not run", () =>
    Effect.gen(function* () {
      const { run, writeShard, reports } = yield* workspace()
      yield* writeShard(1, reportOf(["Killed", "Survived", "CompileError"]))
      yield* writeShard(2, reportOf(["Timeout", "NoCoverage", "RuntimeError", "Ignored"]))
      const { result, output, errors } = yield* run(["report", reports, "--only", "tools"])
      assert.isTrue(Result.isSuccess(result))
      assert.deepStrictEqual(errors, [])
      assert.deepStrictEqual(rowOf(output), ["4", "2", "1", "1", "50.00%", `${toolsFloor?.toFixed(2)}%`])
    }).pipe(Effect.provide(BunServices.layer)),
  )

  it.effect("accepts the floor itself and rejects a score one hundredth below it", () =>
    Effect.gen(function* () {
      const { run, writeShard, reports } = yield* workspace()
      assert.isDefined(toolsFloor)
      const caughtAtFloor = Math.round((toolsFloor ?? 0) * 100)
      for (const caught of [caughtAtFloor, caughtAtFloor - 1]) {
        yield* writeShard(
          1,
          reportOf(Array.from({ length: 10_000 }, (_, index) => (index < caught ? "Killed" : "Survived"))),
        )
        yield* writeShard(2, reportOf([]))
        const { result, errors, output } = yield* run(["report", reports, "--only", "tools"])
        assert.strictEqual(rowOf(output)[4], `${(caught / 100).toFixed(2)}%`)
        if (caught === caughtAtFloor) {
          assert.isTrue(Result.isSuccess(result))
          assert.deepStrictEqual(errors, [])
        } else {
          assert.isTrue(Result.isFailure(result))
          if (Result.isFailure(result)) {
            assert.instanceOf(result.failure, MutationReportFailed)
            assert.deepStrictEqual(result.failure, new MutationReportFailed({ problems: 1 }))
          }
          assert.strictEqual(errors.length, 1)
        }
      }
    }).pipe(Effect.provide(BunServices.layer)),
  )

  it.effect("never presents a partial score when a shard is missing or unfinished", () =>
    Effect.gen(function* () {
      const { run, writeShard, reports } = yield* workspace()
      yield* writeShard(1, reportOf(["Killed"]))
      for (const unfinished of [
        undefined,
        "{",
        { files: { "src/a.ts": { mutants: [{ ...mutant("Killed"), status: "Pending" }] } } },
      ]) {
        if (unfinished !== undefined) {
          yield* writeShard(2, unfinished)
        }
        const { result, errors, output } = yield* run(["report", reports, "--only", "tools"])
        assert.isTrue(Result.isFailure(result))
        if (Result.isFailure(result)) {
          assert.deepStrictEqual(result.failure, new MutationReportFailed({ problems: 1 }))
        }
        assert.strictEqual(errors.length, 1)
        assert.deepStrictEqual(rowOf(output).slice(0, 5), ["unknown", "unknown", "unknown", "unknown", "unknown"])
      }
    }).pipe(Effect.provide(BunServices.layer)),
  )

  it.effect("distinguishes a complete report with no counted mutants from a missing report", () =>
    Effect.gen(function* () {
      const { run, writeShard, reports } = yield* workspace()
      yield* writeShard(1, reportOf(["Ignored", "CompileError"]))
      yield* writeShard(2, { files: {} })
      const { result, output, errors } = yield* run(["report", reports, "--only", "tools"])
      assert.isTrue(Result.isSuccess(result))
      assert.deepStrictEqual(errors, [])
      assert.deepStrictEqual(rowOf(output).slice(0, 5), ["0", "0", "0", "0", "unknown"])
    }).pipe(Effect.provide(BunServices.layer)),
  )

  it.effect("lists only survived and uncovered mutants from every available shard", () =>
    Effect.gen(function* () {
      const { run, writeShard, reports } = yield* workspace()
      yield* writeShard(1, {
        files: {
          "src/caught.ts": { mutants: [mutant("Killed"), mutant("Timeout"), mutant("Ignored")] },
          "src/survived.ts": { mutants: [mutant("Survived")] },
        },
      })
      yield* writeShard(2, {
        files: {
          "src/uncovered.ts": { mutants: [mutant("NoCoverage")] },
        },
      })
      const { result, output } = yield* run(["survivors", reports, "--only", "tools"])
      assert.isTrue(Result.isSuccess(result))
      const listed = output.split("\n").filter((line) => line.startsWith("- tools/"))
      assert.strictEqual(listed.length, 2)
      assert.isTrue(listed.some((line) => line.includes("tools/src/survived.ts:")))
      assert.isTrue(listed.some((line) => line.includes("tools/src/uncovered.ts:")))
      assert.isFalse(output.includes("caught.ts"))
    }).pipe(Effect.provide(BunServices.layer)),
  )

  it.effect("refuses unknown or empty package selections", () =>
    Effect.gen(function* () {
      const { run } = yield* workspace()
      for (const only of ["not-a-target", " , ", "tools,not-a-target"]) {
        const { result, errors } = yield* run(["plan", "--only", only])
        assert.isTrue(Result.isFailure(result))
        if (Result.isFailure(result)) {
          assert.instanceOf(result.failure, Refused)
        }
        assert.strictEqual(errors.length, 1)
      }
    }).pipe(Effect.provide(BunServices.layer)),
  )
})
