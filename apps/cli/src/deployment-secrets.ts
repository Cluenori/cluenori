import { Effect, FileSystem, Option, Path, Schema } from "effect"

import { refuse } from "./api-client.ts"
import { savedDeployment } from "./api-settings.ts"
import { wrangler } from "./attached.ts"
import { accountOf, environmentFlags } from "./setup.ts"

const SecretsFile = Schema.fromJsonString(Schema.Record(Schema.String, Schema.String))

/**
 * Gives the deployment `./setup` made these Worker secrets, through a file only this user can read,
 * deleted after. Refuses when no deployment is saved on this computer: the Cluenori `./run` serves
 * reads its secrets from `apps/worker/.dev.vars`.
 */
export const setDeploymentSecrets = Effect.fn("setDeploymentSecrets")(function* (
  secrets: Readonly<Record<string, string>>,
) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const saved = yield* savedDeployment
  if (Option.isNone(saved)) {
    return yield* refuse("No deployment is saved on this computer: run ./setup first.")
  }
  const account = yield* accountOf(saved.value)
  yield* Effect.scoped(
    Effect.gen(function* () {
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "cluenori-secrets-" }).pipe(Effect.orDie)
      const file = path.join(directory, "secrets.json")
      const encoded = yield* Schema.encodeEffect(SecretsFile)(secrets).pipe(Effect.orDie)
      yield* fs.writeFileString(file, encoded, { mode: 0o600 }).pipe(Effect.orDie)
      yield* wrangler(["secret", "bulk", file, ...environmentFlags(saved.value.jurisdiction)], { account })
    }),
  )
})
