import { Console, Effect, FileSystem, Option, Path, Schema } from "effect"
import { Command, Prompt } from "effect/cli"

import { refuse } from "./api-client.ts"
import type { Jurisdiction, SavedDeployment } from "./api-settings.ts"
import { deploymentPath, Hostname, newApiSettings, saveDeployment, savedDeployment } from "./api-settings.ts"
import { attachedExitCode, buildDashboard, wrangler } from "./attached.ts"

// The bucket wrangler.jsonc binds as ARCHIVE, and how long it keeps a file: 90 days.
const archiveBucket = "cluenori-archive"
const archiveDays = 90

// The queue wrangler.jsonc binds as ACTIVITY.
const activityQueue = "cluenori-activity"

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

/**
 * Wrangler's flags for a deployment's jurisdiction: its `eu` environment, and the `--jurisdiction`
 * of R2 and Queues.
 */
export const environmentFlags = (jurisdiction: Jurisdiction) => (jurisdiction === "eu" ? ["--env", "eu"] : [])
const jurisdictionFlags = (jurisdiction: Jurisdiction) => (jurisdiction === "eu" ? ["--jurisdiction", "eu"] : [])

/** Wrangler's flags for a deployment's domain: a custom domain on its zone, besides workers.dev. */
export const domainFlags = (domain: Hostname | undefined) => (domain === undefined ? [] : ["--domain", domain])

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

/**
 * The domain to serve at besides workers.dev, asked each time with the saved one as the answer
 * Enter keeps: a hostname on a zone of the Cloudflare account Wrangler signs in to, whose DNS
 * record and certificate Cloudflare makes. An empty answer serves at workers.dev only.
 * Not handled: dropping a saved domain, since Enter keeps it; that takes removing `domain` from the
 * saved deployment, and the custom domain in Cloudflare's dashboard.
 */
const domainOf = Effect.fn("domainOf")(function* (saved: Hostname | undefined) {
  const answer = yield* Prompt.run(
    Prompt.String({
      message:
        "Serve Cluenori at a domain of yours on this Cloudflare account? Type a hostname, such as app.example.com, or nothing for workers.dev.",
      ...(saved === undefined ? {} : { default: saved }),
      validate: (value) => {
        const hostname = value.trim().toLowerCase()
        return hostname === "" || Schema.is(Hostname)(hostname)
          ? Effect.succeed(hostname)
          : Effect.fail("Type a hostname, such as app.example.com, or nothing.")
      },
    }),
  ).pipe(Effect.catchTag("QuitError", () => refuse("Setup stopped before it changed anything.")))
  return answer === "" ? undefined : Hostname.make(answer)
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
    // wrangler.jsonc binds it already, as ARCHIVE; without the flag Wrangler offers to add it again.
    yield* wrangler(["r2", "bucket", "create", archiveBucket, "--update-config=false", ...where])
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

/**
 * The queue wrangler.jsonc binds as ACTIVITY, made the first time with the deployment's
 * jurisdiction, which can't change later. A deploy before it exists fails.
 */
export const ensureActivityQueue = Effect.fn("ensureActivityQueue")(function* (jurisdiction: Jurisdiction) {
  yield* Console.log(`Looking for the activity queue, ${activityQueue}:`)
  const exists = yield* attachedExitCode("bun", ["run", "wrangler", "queues", "info", activityQueue], {
    cwd: "apps/worker",
  })
  if (exists !== 0) {
    yield* Console.log("It isn't there yet, so it is made now.\n")
    yield* wrangler(["queues", "create", activityQueue, ...jurisdictionFlags(jurisdiction)])
  }
})

/**
 * Deploys, and returns where commands reach it: the domain when there is one, else the workers.dev
 * URL Wrangler says the Worker serves at; and that workers.dev URL, which names the deployment.
 */
const deploy = Effect.fn("deploy")(function* (
  jurisdiction: Jurisdiction,
  domain: Hostname | undefined,
  directory: string,
) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const outputFile = path.join(directory, "wrangler-output.json")
  yield* buildDashboard
  yield* wrangler(["deploy", ...environmentFlags(jurisdiction), ...domainFlags(domain)], {
    WRANGLER_OUTPUT_FILE_PATH: outputFile,
  })
  const output = yield* fs.readFileString(outputFile).pipe(Effect.orDie)
  const entries = yield* Effect.forEach(
    output.split("\n").filter((line) => line.trim() !== ""),
    (line) => Schema.decodeEffect(OutputEntry)(line).pipe(Effect.orDie),
  )
  const targets = entries.flatMap((entry) => (entry.type === "deploy" ? (entry.targets ?? []) : []))
  const workersDev = targets.find((target) => target.endsWith(".workers.dev"))
  if (workersDev === undefined) {
    return yield* refuse(
      "Wrangler deployed without saying where Cluenori serves; workers_dev may be off in wrangler.jsonc.",
    )
  }
  return { url: domain === undefined ? workersDev : `https://${domain}`, workersDev }
})

/**
 * Gives the deployment an API token and an owner, as Worker secrets, and saves the token for this
 * computer's CLI. The secrets go through a file only this user can read, which is deleted after.
 */
const giveApiToken = Effect.fn("giveApiToken")(function* (
  deployment: Pick<SavedDeployment, "jurisdiction" | "domain">,
  url: string,
  directory: string,
) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const fresh = yield* newApiSettings
  const secretsFile = path.join(directory, "secrets.json")
  const secrets = yield* Schema.encodeEffect(SecretsFile)({
    CLUENORI_API_TOKEN: fresh.token,
    CLUENORI_OWNER: fresh.owner,
  }).pipe(Effect.orDie)
  yield* fs.writeFileString(secretsFile, secrets, { mode: 0o600 }).pipe(Effect.orDie)
  yield* wrangler(["secret", "bulk", secretsFile, ...environmentFlags(deployment.jurisdiction)])
  return yield* saveDeployment({ ...deployment, url, token: fresh.token })
})

/** `./setup`: Cluenori in the Cloudflare account Wrangler signs in to. */
export const setup = Command.make("setup", {}, () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "cluenori-setup-" }).pipe(Effect.orDie)
      const saved = yield* savedDeployment
      const jurisdiction = yield* jurisdictionOf(saved)
      const domain = yield* domainOf(Option.isSome(saved) ? saved.value.domain : undefined)
      const deployment = { jurisdiction, ...(domain === undefined ? {} : { domain }) }
      yield* Console.log(
        `Deploying Cluenori to your Cloudflare account, keeping its data ${jurisdiction === "eu" ? "in the EU" : "wherever Cloudflare chooses"}. Wrangler signs you in first if it needs to.\n`,
      )
      yield* ensureArchive(jurisdiction, directory)
      yield* ensureActivityQueue(jurisdiction)
      const { url, workersDev } = yield* deploy(jurisdiction, domain, directory)
      // The token saved for this deployment, found at its domain or at its workers.dev URL, is kept.
      const token =
        Option.isSome(saved) && (saved.value.url === url || saved.value.url === workersDev)
          ? saved.value.token
          : undefined
      if (token === undefined) {
        yield* Console.log(
          "\nGiving the deployment an API token. A token made before on another computer stops working.\n",
        )
        const file = yield* giveApiToken(deployment, url, directory)
        yield* Console.log(`\nSaved its URL and token in ${file}, readable only by you.`)
      } else {
        yield* saveDeployment({ ...deployment, url, token })
      }
      yield* Console.log(`\nCluenori serves at ${url}; /api/health answers 204 when it is serving.`)
      const settings = yield* deploymentPath.pipe(Effect.orDie)
      yield* Console.log(`Open the dashboard there, and sign in with the API token: "token" in ${settings}.`)
      yield* Console.log("Create your first project: ./cluenori project create <key> --name <name>")
    }),
  ),
).pipe(Command.withDescription("Deploy Cluenori to your Cloudflare account, with an API token for this computer."))
