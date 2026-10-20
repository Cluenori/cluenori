import { Console, Effect, FileSystem, Option, Path, Schema } from "effect"
import { Command, Prompt } from "effect/cli"

import { refuse } from "./api-client.ts"
import type { Jurisdiction } from "./api-settings.ts"
import { newApiSettings, saveDeployment, savedDeployment } from "./api-settings.ts"
import { attachedExitCode, wrangler } from "./attached.ts"

// The bucket wrangler.jsonc binds as ARCHIVE, and how long it keeps a file: 90 days.
const archiveBucket = "cluenori-archive"
const archiveDays = 90

// What Wrangler writes to WRANGLER_OUTPUT_FILE_PATH: one JSON object per line; a deploy's lists the
// URLs it serves at.
const OutputEntry = Schema.fromJsonString(
  Schema.Struct({ type: Schema.String, targets: Schema.optionalKey(Schema.Array(Schema.String)) }),
)

const SecretsFile = Schema.fromJsonString(
  Schema.Struct({ CLUENORI_API_TOKEN: Schema.String, CLUENORI_OWNER: Schema.String }),
)

// R2's lifecycle rules as `wrangler r2 bucket lifecycle set` reads them: every file expires after
// `archiveDays`. Setting them replaces any rules, so setup can run again.
const LifecycleFile = Schema.fromJsonString(
  Schema.Struct({
    rules: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        enabled: Schema.Boolean,
        conditions: Schema.Struct({}),
        deleteObjectsTransition: Schema.Struct({
          condition: Schema.Struct({ maxAge: Schema.Int, type: Schema.Literal("Age") }),
        }),
      }),
    ),
  }),
)

/** Wrangler's flags for a deployment's jurisdiction: its `eu` environment, and R2's `--jurisdiction`. */
export const environmentFlags = (jurisdiction: Jurisdiction) => (jurisdiction === "eu" ? ["--env", "eu"] : [])
const jurisdictionFlags = (jurisdiction: Jurisdiction) => (jurisdiction === "eu" ? ["--jurisdiction", "eu"] : [])

// Asked once, and saved at once: a bucket's and a Durable Object's jurisdiction can't change later.
const askJurisdiction = Prompt.run(
  Prompt.Select({
    message: "Where should Cluenori keep your data? This can't be changed later.",
    choices: [
      {
        title: "Wherever Cloudflare chooses",
        value: "global" as const,
        description: "Projects' databases and the archive are placed near where they are used.",
      },
      {
        title: "In the EU",
        value: "eu" as const,
        description: "Projects' databases and the archive stay in the EU, under Cloudflare's EU jurisdiction.",
      },
    ],
  }),
).pipe(Effect.catchTag("QuitError", () => refuse("Setup stopped before it changed anything.")))

// The jurisdiction saved by an earlier setup, or asked now and saved at once.
const jurisdictionOf = Effect.fn("jurisdictionOf")(function* (
  saved: Option.Option<{ readonly jurisdiction: Jurisdiction }>,
) {
  if (Option.isSome(saved)) {
    return saved.value.jurisdiction
  }
  const chosen = yield* askJurisdiction
  yield* saveDeployment({ jurisdiction: chosen })
  return chosen
})

/** The archive's bucket, made the first time with the deployment's jurisdiction, and its 90-day expiry. */
const ensureArchive = Effect.fn("ensureArchive")(function* (jurisdiction: Jurisdiction, directory: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const where = jurisdictionFlags(jurisdiction)
  yield* Console.log(`Looking for the archive's bucket, ${archiveBucket}:`)
  const exists = yield* attachedExitCode("bun", ["run", "wrangler", "r2", "bucket", "info", archiveBucket, ...where], {
    cwd: "apps/worker",
  })
  if (exists !== 0) {
    yield* Console.log("It isn't there yet, so setup makes it.\n")
    yield* wrangler(["r2", "bucket", "create", archiveBucket, ...where])
  }
  const rulesFile = path.join(directory, "lifecycle.json")
  const rules = yield* Schema.encodeEffect(LifecycleFile)({
    rules: [
      {
        id: `expire-after-${archiveDays}-days`,
        enabled: true,
        conditions: {},
        deleteObjectsTransition: { condition: { maxAge: archiveDays * 86_400, type: "Age" } },
      },
    ],
  }).pipe(Effect.orDie)
  yield* fs.writeFileString(rulesFile, rules).pipe(Effect.orDie)
  yield* wrangler(["r2", "bucket", "lifecycle", "set", archiveBucket, "--file", rulesFile, "--force", ...where])
})

/** Deploys, and returns the URL Wrangler says the Worker serves at. */
const deploy = Effect.fn("deploy")(function* (jurisdiction: Jurisdiction, directory: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const outputFile = path.join(directory, "wrangler-output.json")
  yield* wrangler(["deploy", ...environmentFlags(jurisdiction)], { WRANGLER_OUTPUT_FILE_PATH: outputFile })
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
const giveApiToken = Effect.fn("giveApiToken")(function* (jurisdiction: Jurisdiction, url: string, directory: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const fresh = yield* newApiSettings
  const secretsFile = path.join(directory, "secrets.json")
  const secrets = yield* Schema.encodeEffect(SecretsFile)({
    CLUENORI_API_TOKEN: fresh.token,
    CLUENORI_OWNER: fresh.owner,
  }).pipe(Effect.orDie)
  yield* fs.writeFileString(secretsFile, secrets, { mode: 0o600 }).pipe(Effect.orDie)
  yield* wrangler(["secret", "bulk", secretsFile, ...environmentFlags(jurisdiction)])
  return yield* saveDeployment({ jurisdiction, url, token: fresh.token })
})

/** `./setup`: Cluenori in the Cloudflare account Wrangler signs in to. */
export const setup = Command.make("setup", {}, () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "cluenori-setup-" }).pipe(Effect.orDie)
      const saved = yield* savedDeployment
      const jurisdiction = yield* jurisdictionOf(saved)
      yield* Console.log(
        `Deploying Cluenori to your Cloudflare account, keeping its data ${jurisdiction === "eu" ? "in the EU" : "wherever Cloudflare chooses"}. Wrangler signs you in first if it needs to.\n`,
      )
      yield* ensureArchive(jurisdiction, directory)
      const url = yield* deploy(jurisdiction, directory)
      const hasToken = Option.isSome(saved) && saved.value.url === url && saved.value.token !== undefined
      if (!hasToken) {
        yield* Console.log(
          "\nGiving the deployment an API token. A token made before on another computer stops working.\n",
        )
        const file = yield* giveApiToken(jurisdiction, url, directory)
        yield* Console.log(`\nSaved its URL and token in ${file}, readable only by you.`)
      }
      yield* Console.log(`\nCluenori serves at ${url}; /api/health answers 204 when it is serving.`)
      yield* Console.log("Create your first project: ./cluenori project create <key> --name <name>")
    }),
  ),
).pipe(Command.withDescription("Deploy Cluenori to your Cloudflare account, with an API token for this computer."))
