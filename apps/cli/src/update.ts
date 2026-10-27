import { Console, Effect, Option } from "effect"
import { Command } from "effect/cli"
import { ChildProcess, ChildProcessSpawner } from "effect/process"

import { refuse } from "./api-client.ts"
import { savedDeployment } from "./api-settings.ts"
import { attached, buildDashboard, wrangler } from "./attached.ts"
import { accountOf, domainFlags, ensureActivityQueue, ensureBuckets, environmentFlags } from "./setup.ts"

// The release this commit is, as Cluenori numbers it for the Worker: `0.1.0+12`. A number Cluenori
// can't give leaves the deploy without a release, said, rather than stopping it.
const numbered = (env: Readonly<Record<string, string>>) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const answer = yield* spawner
      .string(ChildProcess.make("./cluenori-release", ["number"], { env: { ...env }, extendEnv: true }))
      .pipe(Effect.result)
    const release = answer._tag === "Success" ? answer.success.trim() : ""
    if (release === "") {
      yield* Console.error("Cluenori couldn't number this commit; it deploys without a release.")
      return Option.none<string>()
    }
    yield* Console.log(`This commit is the Worker's release ${release}.`)
    return Option.some(release)
  })

/** `./update`: the newest version of this clone's upstream branch, installed and deployed. */
export const update = Command.make("update", {}, () =>
  Effect.gen(function* () {
    // Deploying with the wrong jurisdiction would bind a second, empty archive, so it isn't guessed.
    const saved = yield* savedDeployment
    if (Option.isNone(saved)) {
      return yield* refuse(
        "./update deploys the Cluenori ./setup made from this computer, and none is saved here. Run ./setup, giving the same answer about where data is kept as the first time.",
      )
    }
    // Every Wrangler command names the deployment's account; one saved before accounts were is asked now.
    const account = yield* accountOf(saved.value)
    yield* Console.log("Getting the new version.")
    // Not handled: a clone with commits of its own. `git pull --ff-only` refuses, says why, and
    // leaves the clone as it was; merging upstream into edited modules is the person's call.
    yield* attached("git", ["pull", "--ff-only"], {})
    yield* attached("bun", ["install", "--frozen-lockfile"], {})
    // A version may bind something earlier ones didn't, which is made first.
    yield* ensureBuckets(saved.value.jurisdiction, account)
    yield* ensureActivityQueue(saved.value.jurisdiction, account)
    // A deployment that measures itself numbers its commit as its Worker's next release, as any
    // component's CI does, with the file founders copy (`cluenori-release`), and reports the deploy.
    const self = Option.filter(Option.fromNullishOr(saved.value.selfTelemetry), (each) => each.measuring)
    const releaseEnv = Option.map(self, (each) => ({
      CLUENORI_URL: saved.value.url ?? "",
      CLUENORI_INGEST_KEY: each.ingestKey,
    }))
    const release = yield* Option.match(releaseEnv, {
      onNone: () => Effect.succeed(Option.none<string>()),
      onSome: (env) => numbered(env),
    })
    yield* Console.log(`\nDeploying it to the Cloudflare account ${account}.\n`)
    yield* buildDashboard
    const releaseVars = Option.match(release, {
      onNone: () => [],
      onSome: (each) => ["--var", `CLUENORI_RELEASE:${each}`],
    })
    yield* wrangler(
      ["deploy", ...environmentFlags(saved.value.jurisdiction), ...domainFlags(saved.value.domain), ...releaseVars],
      { account },
    )
    if (Option.isSome(release) && Option.isSome(releaseEnv)) {
      yield* attached("./cluenori-release", ["--release", release.value, "--environment", "production"], {
        env: releaseEnv.value,
      }).pipe(Effect.catchTag("CommandFailed", () => Console.error("The deploy went out, but wasn't reported.")))
    }
  }),
).pipe(Command.withDescription("Install a new version of Cluenori and deploy it."))
