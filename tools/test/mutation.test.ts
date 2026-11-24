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

// These are the packages the nightly command must measure when --only is omitted. Keep the
// expectation independent of mutationTargets: accidentally dropping a registration must fail.
const nightlyFolders = [
  "product/foundation",
  "product/engines/feeds",
  "product/engines/github-app",
  "product/engines/incidents",
  "product/engines/members",
  "product/engines/notifications",
  "product/engines/phones",
  "product/engines/projects",
  "product/engines/signals",
  "product/engines/today",
  "product/modules/analytics",
  "product/modules/releases",
  "apps/cli",
  "tools",
  "sdks/web",
]

// A real, isolated repository, with two tested files and one untested file: two shards. Rooting
// filesystem reads and child processes here avoids changing the test runner's process-wide cwd.
const workspace = Effect.fn("workspace")(function* (folders: ReadonlyArray<string> = ["tools"]) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const root = yield* fs.makeTempDirectoryScoped()
  for (const folder of folders) {
    yield* fs.makeDirectory(`${root}/${folder}/src`, { recursive: true })
    yield* fs.makeDirectory(`${root}/${folder}/test`)
    for (const name of ["a", "b", "c"]) {
      yield* fs.writeFileString(`${root}/${folder}/src/${name}.ts`, "export {}\n".repeat(700))
    }
    yield* fs.writeFileString(`${root}/${folder}/test/files.test.ts`, 'import "../src/a.ts"\nimport "../src/b.ts"\n')
  }
  yield* fs.makeDirectory(`${root}/reports/tools`, { recursive: true })
  // Only tracked, executable TypeScript is mutated, not declarations or neighboring assets.
  for (const name of ["types.d.ts", "example.ts.txt", "notes.md"]) {
    yield* fs.writeFileString(`${root}/tools/src/${name}`, "export {}\n")
  }
  for (const args of [
    ["init", "--quiet"],
    ["add", "."],
  ]) {
    const code = yield* spawner.exitCode(ChildProcess.make("git", args, { cwd: root }))
    assert.strictEqual(code, 0)
  }
  yield* fs.writeFileString(`${root}/tools/src/untracked.ts`, "export {}\n")
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
  const writeShard = Effect.fn("writeShard")(function* (
    shard: number,
    report: string | Schema.JsonObject,
    folder = "tools",
  ) {
    const text = yield* typeof report === "string"
      ? Effect.succeed(report)
      : Schema.encodeEffect(Schema.fromJsonString(Schema.Json))(report)
    yield* fs.makeDirectory(`${root}/reports/${folder}`, { recursive: true })
    yield* fs.writeFileString(`${root}/reports/${folder}/shard-${shard}.json`, text)
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
  it.effect("plans every nightly package when no selection is given", () =>
    Effect.gen(function* () {
      const { run } = yield* workspace(nightlyFolders)
      const { result, output } = yield* run(["plan"])
      assert.isTrue(Result.isSuccess(result))
      const matrix = yield* Schema.decodeEffect(
        Schema.fromJsonString(Schema.Struct({ include: Schema.Array(Schema.Struct({ folder: Schema.String })) })),
      )(output)
      assert.deepStrictEqual([...new Set(matrix.include.map((entry) => entry.folder))], nightlyFolders)
    }).pipe(Effect.provide(BunServices.layer)),
  )

  it.effect("plans every source file once, with a tested file in each shard, and deduplicates selected packages", () =>
    Effect.gen(function* () {
      const { run } = yield* workspace()
      const { result, output } = yield* run(["plan", "--only", " tools,\ttools,, "])
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
      yield* writeShard(1, reportOf(["Killed", "Survived", "Survived", "CompileError"]))
      yield* writeShard(2, reportOf(["Timeout", "NoCoverage", "RuntimeError", "Ignored"]))
      // Aggregation is independent of whether a future floor exceeds this fixture's score;
      // acceptance and refusal at the configured floor are checked separately below.
      const { output } = yield* run(["report", reports, "--only", "tools"])
      assert.deepStrictEqual(rowOf(output), ["5", "2", "2", "1", "40.00%", `${toolsFloor?.toFixed(2)}%`])
    }).pipe(Effect.provide(BunServices.layer)),
  )

  it.effect("accepts scores at the floor, rejects lower scores, and recommends only higher floors rounded down", () =>
    Effect.gen(function* () {
      const { run, writeShard, reports } = yield* workspace()
      assert.isDefined(toolsFloor)
      const caughtAtFloor = Math.round((toolsFloor ?? 0) * 100)
      // A decimal floor isn't always representable by this fixture: 5,146 / 10,000 * 100
      // is just below 51.46. Always exercise both sides; exercise equality when it is exact.
      const counts = [caughtAtFloor - 1, caughtAtFloor + 1]
      if ((caughtAtFloor / 10_000) * 100 === toolsFloor) {
        counts.push(caughtAtFloor)
      }
      for (const caught of counts) {
        yield* writeShard(
          1,
          reportOf(Array.from({ length: 10_000 }, (_, index) => (index < caught ? "Killed" : "Survived"))),
        )
        yield* writeShard(2, reportOf([]))
        const { result, errors, output } = yield* run(["report", reports, "--only", "tools"])
        assert.strictEqual(rowOf(output)[4], `${(caught / 100).toFixed(2)}%`)
        if (caught >= caughtAtFloor) {
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
        assert.strictEqual(output.includes("Floors to raise"), caught > caughtAtFloor)
        if (caught > caughtAtFloor) {
          assert.isTrue(output.includes(`- tools: ${caught / 100}`))
        }
      }
      // The displayed score rounds up to a hundredth; the recommended floor must round down
      // instead, so repeating this very run can clear it.
      yield* writeShard(1, reportOf(["Killed", "Killed", "Survived"]))
      const rounded = yield* run(["report", reports, "--only", "tools"])
      assert.isTrue(Result.isSuccess(rounded.result))
      assert.strictEqual(rowOf(rounded.output)[4], "66.67%")
      assert.isTrue(rounded.output.includes("- tools: 66.66"))
    }).pipe(Effect.provide(BunServices.layer)),
  )

  it.effect("accepts exact floors and does not recommend an unchanged rounded floor", () =>
    Effect.gen(function* () {
      const { run, writeShard, reports } = yield* workspace(nightlyFolders)
      // Exercise equality with a configured floor this integer-count fixture can represent
      // exactly, independent of whether tools' current floor happens to be representable.
      const exact = yield* Schema.decodeUnknownEffect(Schema.Struct({ folder: Schema.String, floor: Schema.Finite }))(
        mutationTargets.find(({ floor }) => floor !== undefined && (Math.round(floor * 100) / 10_000) * 100 === floor),
      )
      for (const { folder, caught, total } of [
        { folder: exact.folder, caught: Math.round(exact.floor * 100), total: 10_000 },
        // Just above tools' floor, but less than a hundredth above: no floor increase.
        { folder: "tools", caught: Math.round((toolsFloor ?? 0) * 100) + 1, total: 10_001 },
      ]) {
        yield* writeShard(
          1,
          reportOf(Array.from({ length: total }, (_, i) => (i < caught ? "Killed" : "Survived"))),
          folder,
        )
        yield* writeShard(2, reportOf([]), folder)
        const { result, output, errors } = yield* run(["report", reports, "--only", folder])
        assert.isTrue(Result.isSuccess(result))
        assert.deepStrictEqual(errors, [])
        assert.isFalse(output.includes("Floors to raise"))
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
        assert.isFalse(output.includes("Floors to raise"))
        const survivors = yield* run(["survivors", reports, "--only", "tools"])
        assert.isTrue(Result.isSuccess(survivors.result))
        assert.isTrue(survivors.output.includes("Not measured, as these shards have no finished report:"))
        assert.isFalse(survivors.output.includes("Every mutant was caught."))
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
      assert.isFalse(output.includes("Floors to raise"))
      const survivors = yield* run(["survivors", reports, "--only", "tools"])
      assert.isTrue(Result.isSuccess(survivors.result))
      assert.strictEqual(survivors.output, "Every mutant was caught.")
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

      // A report with just one uncaught status must not announce an empty section for the other.
      for (const status of ["Survived", "NoCoverage"] as const) {
        yield* writeShard(1, reportOf([status]))
        yield* writeShard(2, reportOf(["Killed"]))
        const single = yield* run(["survivors", reports, "--only", "tools"])
        assert.isTrue(Result.isSuccess(single.result))
        assert.strictEqual(single.output.includes("Survived, though tests ran it:"), status === "Survived")
        assert.strictEqual(single.output.includes("Not covered, as no test ran it:"), status === "NoCoverage")
        assert.deepStrictEqual(
          single.output.split("\n").filter((line) => line.startsWith("- tools/")),
          ["- tools/src/a.ts:1:1 BooleanLiteral: `false`"],
        )
      }

      // Reports arrive in shard order, not file or location order. The handoff must group the
      // statuses and retain each location, even when replacements have newlines or are absent.
      yield* writeShard(1, {
        files: {
          "src/z.ts": { mutants: [mutant("Survived")] },
          "src/a.ts": {
            mutants: [
              { ...mutant("Survived"), location: { start: { line: 9, column: 2 } }, replacement: "x".repeat(101) },
              { ...mutant("NoCoverage"), location: { start: { line: 2, column: 1 } } },
              { ...mutant("Survived"), location: { start: { line: 3, column: 8 } }, replacement: "x".repeat(100) },
            ],
          },
        },
      })
      const { replacement: _, ...withoutReplacement } = mutant("Survived")
      yield* writeShard(2, {
        files: {
          "src/a.ts": {
            mutants: [
              { ...withoutReplacement, location: { start: { line: 3, column: 2 } } },
              { ...mutant("Survived"), location: { start: { line: 1, column: 4 } }, replacement: " \n a\t  b \n " },
            ],
          },
        },
      })
      const ordered = yield* run(["survivors", reports, "--only", "tools"])
      assert.isTrue(Result.isSuccess(ordered.result))
      const [survived, uncovered] = ordered.output.split("Not covered, as no test ran it:")
      assert.isDefined(uncovered)
      assert.deepStrictEqual(
        survived?.split("\n").filter((line) => line.startsWith("- tools/")),
        [
          "- tools/src/a.ts:1:4 BooleanLiteral: `a b`",
          "- tools/src/a.ts:3:2 BooleanLiteral",
          `- tools/src/a.ts:3:8 BooleanLiteral: \`${"x".repeat(100)}\``,
          `- tools/src/a.ts:9:2 BooleanLiteral: \`${"x".repeat(99)}…\``,
          "- tools/src/z.ts:1:1 BooleanLiteral: `false`",
        ],
      )
      assert.deepStrictEqual(
        uncovered?.split("\n").filter((line) => line.startsWith("- tools/")),
        ["- tools/src/a.ts:2:1 BooleanLiteral: `false`"],
      )
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
