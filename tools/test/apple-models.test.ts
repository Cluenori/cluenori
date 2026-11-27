import { BunServices } from "@effect/platform-bun"
import { assert, describe, it } from "@effect/vitest"
import { Console, Effect, FileSystem, Path, Result, Schema } from "effect"
import { Command } from "effect/cli"
import { ChildProcess, ChildProcessSpawner } from "effect/process"

import { appleModels } from "../src/apple-models.ts"
import { Refused } from "../src/refuse.ts"

// Only Xcode is replaced: generate and import the real file in an isolated directory.
const workspace = Effect.fn("appleModelsWorkspace")(function* () {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const current = yield* Console.Console
  const root = yield* fs.makeTempDirectoryScoped()
  const outputFile = path.resolve(root, "product/engines/phones/src/apple-models.ts")
  yield* fs.makeDirectory(path.dirname(outputFile), { recursive: true })
  const rootedFs: FileSystem.FileSystem = {
    ...fs,
    writeFileString: (file, text, options) => fs.writeFileString(path.resolve(root, file), text, options),
  }
  const run = Effect.fn("runAppleModels")(function* (answer: Schema.JsonObject | undefined) {
    const listed =
      answer === undefined ? undefined : yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Json))(answer)
    const output: Array<string> = []
    const errors: Array<string> = []
    const xcode = ChildProcessSpawner.make((command) => {
      assert.strictEqual(command._tag, "StandardCommand")
      if (command._tag === "StandardCommand") {
        assert.strictEqual(command.command, "xcrun")
        assert.deepStrictEqual(command.args, ["simctl", "list", "devicetypes", "--json"])
      }
      return spawner.spawn(
        listed === undefined
          ? ChildProcess.make(path.join(root, "xcrun-unavailable"))
          : ChildProcess.make("printf", ["%s", listed]),
      )
    })
    const result = yield* Command.runWith(appleModels, { version: "test", renderErrors: false })([]).pipe(
      Effect.provideService(FileSystem.FileSystem, rootedFs),
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, xcode),
      Effect.provideService(
        Console.Console,
        Object.assign(Object.create(current), {
          log: (...values: ReadonlyArray<unknown>) => output.push(values.join(" ")),
          error: (...values: ReadonlyArray<unknown>) => errors.push(values.join(" ")),
        }),
      ),
      Effect.result,
    )
    return { result, output: output.join("\n"), errors: errors.join("\n") }
  })
  const quotedOutputFile = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.String))(outputFile)
  const readModels = spawner
    .string(
      ChildProcess.make("bun", [
        "--eval",
        `import { appleModels } from ${quotedOutputFile}; console.log(JSON.stringify([...appleModels]));`,
      ]),
    )
    .pipe(Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(Schema.Array(Schema.Array(Schema.String))))))
  return { run, outputFile, readModels }
})

describe("apple-models command", () => {
  it.effect(
    "generates an importable, sorted phone and tablet table with the first name in code-point order per model",
    () =>
      Effect.gen(function* () {
        const { run, readModels } = yield* workspace()
        const devices = [
          { name: "iPhone Z", modelIdentifier: "iPhone19,3", productFamily: "iPhone" },
          { name: "A tablet", modelIdentifier: "iPad20,2", productFamily: "iPad" },
          { name: "Watch", modelIdentifier: "Watch9,1", productFamily: "Apple Watch" },
          { name: "iPhone A", modelIdentifier: "iPhone19,3", productFamily: "iPhone" },
          { name: "iPhone ", modelIdentifier: "iPhone19,2", productFamily: "iPhone" },
          { name: 'Tablet "A" \\ test\nline', modelIdentifier: "iPad20,1", productFamily: "iPad" },
          { name: "TV", modelIdentifier: "AppleTV9,1", productFamily: "Apple TV" },
        ]
        for (const devicetypes of [devices, devices.toReversed()]) {
          const answer = yield* run({ devicetypes })
          assert.isTrue(Result.isSuccess(answer.result))
          assert.strictEqual(answer.errors, "")
          assert.include(answer.output, "4 models.")
          assert.deepStrictEqual(yield* readModels, [
            ["iPad20,1", 'Tablet "A" \\ test\nline'],
            ["iPad20,2", "A tablet"],
            ["iPhone19,2", "iPhone "],
            ["iPhone19,3", "iPhone A"],
          ])
        }
        // A fresh list with no supported devices must replace the old table, not leave stale models.
        const empty = yield* run({
          devicetypes: [{ name: "Watch", modelIdentifier: "Watch9,1", productFamily: "Apple Watch" }],
        })
        assert.isTrue(Result.isSuccess(empty.result))
        assert.include(empty.output, "0 models.")
        assert.deepStrictEqual(yield* readModels, [])
      }).pipe(Effect.provide(BunServices.layer)),
  )

  it.effect("refuses an unavailable Xcode command without overwriting the existing table or claiming success", () =>
    Effect.gen(function* () {
      const { run, outputFile } = yield* workspace()
      const fs = yield* FileSystem.FileSystem
      yield* fs.writeFileString(outputFile, "existing model table\n")
      const answer = yield* run(undefined)
      assert.isTrue(Result.isFailure(answer.result))
      if (Result.isFailure(answer.result)) {
        assert.instanceOf(answer.result.failure, Refused)
      }
      assert.strictEqual(answer.output, "")
      assert.strictEqual(yield* fs.readFileString(outputFile), "existing model table\n")
    }).pipe(Effect.provide(BunServices.layer)),
  )
})
