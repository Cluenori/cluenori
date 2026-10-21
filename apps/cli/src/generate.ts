import { Console, Effect, FileSystem } from "effect"
import { Command } from "effect/cli"

import { generatedFiles } from "./generated-files.ts"

/** `bun run generate`: rewrites the files generated from code. */
export const generate = Command.make("generate", {}, () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    for (const file of generatedFiles) {
      const text = yield* file.text
      yield* fs.writeFileString(file.path, text).pipe(Effect.orDie)
      yield* Console.log(`Wrote ${file.path}.`)
    }
  }),
).pipe(
  Command.withDescription("Rewrite the files generated from code: the OpenAPI document and the iOS app's API client."),
)
