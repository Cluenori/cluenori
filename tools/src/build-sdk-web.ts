import { Console, Effect, FileSystem, Schema } from "effect"
import { Argument, Command } from "effect/cli"
import { ChildProcess, ChildProcessSpawner } from "effect/process"

import { refuse } from "./refuse.ts"

// What npm gets of @cluenori/sdk (sdks/web): its JavaScript and declarations, built from src alone,
// a package.json naming them, with the catalog's exact versions for its dependencies, and its
// README and license. The folder is what `npm pack` and `npm publish` take; nothing in the
// repository reads it.

const PackageJson = Schema.fromJsonString(
  Schema.Struct({
    name: Schema.String,
    version: Schema.String,
    description: Schema.String,
    license: Schema.String,
    dependencies: Schema.Record(Schema.String, Schema.String),
  }),
)
const RootJson = Schema.fromJsonString(
  Schema.Struct({ workspaces: Schema.Struct({ catalog: Schema.Record(Schema.String, Schema.String) }) }),
)
const Published = Schema.fromJsonString(Schema.Unknown, { space: 2 })

const folder = "sdks/web"

/** `bun run build:sdk-web <out>`: writes the package npm gets into `out`. */
export const buildSdkWeb = Command.make("build-sdk-web", { out: Argument.String("out") }, ({ out }) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const own = yield* fs.readFileString(`${folder}/package.json`).pipe(Effect.orDie)
    const manifest = yield* Schema.decodeEffect(PackageJson)(own).pipe(Effect.orDie)
    const root = yield* fs.readFileString("package.json").pipe(Effect.orDie)
    const { catalog } = (yield* Schema.decodeEffect(RootJson)(root).pipe(Effect.orDie)).workspaces
    const dependencies: Record<string, string> = {}
    for (const [name, range] of Object.entries(manifest.dependencies)) {
      const exact = catalog[name]
      if (range !== "catalog:" || exact === undefined) {
        return yield* refuse(`${name} isn't from the catalog; a published package takes its dependencies from it.`)
      }
      dependencies[name] = exact
    }
    yield* fs.remove(out, { recursive: true, force: true }).pipe(Effect.orDie)
    const built = yield* spawner
      .exitCode(
        ChildProcess.make("node_modules/.bin/tsc", ["-p", `${folder}/tsconfig.build.json`, "--outDir", `${out}/dist`], {
          stdout: "inherit",
          stderr: "inherit",
        }),
      )
      .pipe(Effect.orDie)
    if (built !== 0) {
      return yield* refuse("The SDK didn't compile; tsc said why above.")
    }
    // Declarations keep the source's `./x.ts` imports; npm's readers resolve `./x.js`.
    const files = yield* fs.readDirectory(`${out}/dist`).pipe(Effect.orDie)
    for (const file of files.filter((name) => name.endsWith(".d.ts"))) {
      const path = `${out}/dist/${file}`
      const text = yield* fs.readFileString(path).pipe(Effect.orDie)
      yield* fs.writeFileString(path, text.replace(/(from "\.\/[a-z-]+)\.ts"/g, '$1.js"')).pipe(Effect.orDie)
    }
    const published = yield* Schema.encodeEffect(Published)({
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      license: manifest.license,
      repository: { type: "git", url: "git+https://github.com/Cluenori/cluenori.git", directory: folder },
      type: "module",
      sideEffects: false,
      exports: { ".": { types: "./dist/index.d.ts", default: "./dist/index.js" } },
      files: ["dist", "README.md", "LICENSE"],
      dependencies,
    }).pipe(Effect.orDie)
    yield* fs.writeFileString(`${out}/package.json`, `${published}\n`).pipe(Effect.orDie)
    yield* fs.copyFile(`${folder}/README.md`, `${out}/README.md`).pipe(Effect.orDie)
    yield* fs.copyFile(`${folder}/LICENSE`, `${out}/LICENSE`).pipe(Effect.orDie)
    yield* Console.log(`${manifest.name}@${manifest.version} ${out}`)
  }),
).pipe(Command.withDescription("Write the package npm gets of @cluenori/sdk into a folder."))
