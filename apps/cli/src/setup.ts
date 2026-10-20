import { Console, Effect, FileSystem, Option, Path, Schema } from "effect"
import { Command } from "effect/cli"

import { refuse } from "./api-client.ts"
import { newApiSettings, saveDeployment, savedDeployment } from "./api-settings.ts"
import { wrangler } from "./attached.ts"

// What Wrangler writes to WRANGLER_OUTPUT_FILE_PATH: one JSON object per line; a deploy's lists the
// URLs it serves at.
const OutputEntry = Schema.fromJsonString(
  Schema.Struct({ type: Schema.String, targets: Schema.optionalKey(Schema.Array(Schema.String)) }),
)

const SecretsFile = Schema.fromJsonString(
  Schema.Struct({ CLUENORI_API_TOKEN: Schema.String, CLUENORI_OWNER: Schema.String }),
)

/** Deploys, and returns the URL Wrangler says the Worker serves at. */
const deploy = Effect.fn("deploy")(function* (directory: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const outputFile = path.join(directory, "wrangler-output.json")
  yield* wrangler(["deploy"], { WRANGLER_OUTPUT_FILE_PATH: outputFile })
  const output = yield* fs.readFileString(outputFile).pipe(Effect.orDie)
  const entries = yield* Effect.forEach(
    output.split("\n").filter((line) => line.trim() !== ""),
    (line) => Schema.decodeEffect(OutputEntry)(line).pipe(Effect.orDie),
  )
  const targets = entries.flatMap((entry) => (entry.type === "deploy" ? (entry.targets ?? []) : []))
  const url = targets.find((target) => target.endsWith(".workers.dev")) ?? targets[0]
  if (url === undefined) {
    return yield* refuse(
      "Wrangler deployed without saying where Cluenori serves; workers_dev may be off in wrangler.jsonc.",
    )
  }
  return url
})

/**
 * Gives the deployment an API token and an owner, as Worker secrets, and saves the token for this
 * computer's CLI. The secrets go through a file only this user can read, which is deleted after.
 */
const giveApiToken = Effect.fn("giveApiToken")(function* (url: string, directory: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const fresh = yield* newApiSettings
  const secretsFile = path.join(directory, "secrets.json")
  const secrets = yield* Schema.encodeEffect(SecretsFile)({
    CLUENORI_API_TOKEN: fresh.token,
    CLUENORI_OWNER: fresh.owner,
  }).pipe(Effect.orDie)
  yield* fs.writeFileString(secretsFile, secrets, { mode: 0o600 }).pipe(Effect.orDie)
  yield* wrangler(["secret", "bulk", secretsFile])
  return yield* saveDeployment({ url, token: fresh.token })
})

/** `./setup`: Cluenori in the Cloudflare account Wrangler signs in to. */
export const setup = Command.make("setup", {}, () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "cluenori-setup-" }).pipe(Effect.orDie)
      yield* Console.log("Deploying Cluenori to your Cloudflare account. Wrangler signs you in first if it needs to.\n")
      const url = yield* deploy(directory)
      const saved = yield* savedDeployment
      const hasToken = Option.isSome(saved) && saved.value.url === url
      if (!hasToken) {
        yield* Console.log(
          "\nGiving the deployment an API token. A token made before on another computer stops working.\n",
        )
        const file = yield* giveApiToken(url, directory)
        yield* Console.log(`\nSaved its URL and token in ${file}, readable only by you.`)
      }
      yield* Console.log(`\nCluenori serves at ${url}; /api/health answers 204 when it is serving.`)
      yield* Console.log("Create your first project: ./cluenori project create <key> --name <name>")
    }),
  ),
).pipe(Command.withDescription("Deploy Cluenori to your Cloudflare account, with an API token for this computer."))
