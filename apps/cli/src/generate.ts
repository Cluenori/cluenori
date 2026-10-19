import { Console, Effect, FileSystem } from "effect"
import { Command } from "effect/cli"

import { openApiDocument, openApiPath } from "./openapi.ts"

/** `bun run generate`: rewrites the files generated from code. */
export const generate = Command.make("generate", {}, () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const document = yield* openApiDocument
    yield* fs.writeFileString(openApiPath, document).pipe(Effect.orDie)
    yield* Console.log(`Wrote ${openApiPath}.`)
  }),
).pipe(Command.withDescription("Rewrite the files generated from code: the OpenAPI document."))
