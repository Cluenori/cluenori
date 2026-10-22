import { Console, Effect, Schema } from "effect"
import { Argument, Command, Flag } from "effect/cli"

import { apiClient, reachFailures, refuse } from "./api-client.ts"
import { apiTarget } from "./api-settings.ts"
import { appleKeyOf } from "./apple-key.ts"
import { setDeploymentSecrets } from "./deployment-secrets.ts"
import { local, parsed } from "./question.ts"
import { columns } from "./terminal-text.ts"

// An App Store Connect issuer ID: a UUID.
const IssuerId = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, { expected: "a UUID" }),
)

/** `cluenori github`: whether the deployment is connected to GitHub, and where its app is installed. */
export const github = Command.make("github", { local }, (input) =>
  Effect.gen(function* () {
    const target = yield* apiTarget(input.local)
    const client = yield* apiClient(target)
    const status = yield* client.github.github().pipe(
      Effect.catchTags({
        ...reachFailures(target),
        NotAllowed: () => refuse("Only an owner sees how the deployment is connected to GitHub."),
      }),
    )
    const app = status.app
    if (app === undefined) {
      return yield* Console.log(
        `${target.url} isn't connected to GitHub. An owner connects it on the web, where GitHub creates its app in one step: ${target.url}/github`,
      )
    }
    yield* Console.log(`Connected to GitHub as ${app.name}: ${app.url}`)
    if (status.problem !== undefined) {
      return yield* Console.log(`Its installations couldn't be read: ${status.problem}.`)
    }
    if (status.installations.length === 0) {
      return yield* Console.log(
        `It isn't installed anywhere yet. Install it on the accounts whose repositories your components link: ${app.installUrl}`,
      )
    }
    yield* Console.log(
      `\n${columns([
        ["Installed on", "Kind", "Repositories"],
        ...status.installations.map((installation) => [
          installation.account,
          installation.accountType === "Organization" ? "organization" : "user",
          installation.repositories === "all" ? "all" : "chosen ones",
        ]),
      ]).join("\n")}`,
    )
    yield* Console.log(`\nInstall it on another account: ${app.installUrl}`)
  }),
).pipe(
  Command.withDescription(
    "Whether the deployment is connected to GitHub, where releases' commits and changes come from and promotions start, and the accounts its app is installed on.",
  ),
)

/** `cluenori appstore setup <key file> --issuer <issuer ID> [--key-id <key ID>] [--manager]`. */
export const appStoreSetup = Command.make(
  "setup",
  {
    keyFile: Argument.String("key-file").pipe(
      Argument.withDescription("The .p8 file App Store Connect gave for an API key: AuthKey_<key ID>.p8."),
    ),
    keyId: Flag.String("key-id").pipe(
      Flag.optional,
      Flag.withDescription("The key's ID, when the file's name doesn't say it."),
    ),
    issuer: Flag.String("issuer").pipe(
      Flag.withDescription("The issuer ID App Store Connect shows above your API keys."),
    ),
    manager: Flag.Boolean("manager").pipe(
      Flag.withDefault(false),
      Flag.withDescription(
        "The key is the second one, with the App Manager role, used only to submit builds to App Store review and release them. Without it, the key is the one that reads, with the Developer role.",
      ),
    ),
  },
  (input) =>
    Effect.gen(function* () {
      const key = yield* appleKeyOf(input.keyFile, input.keyId)
      const issuer = yield* parsed(IssuerId, input.issuer, "an issuer ID")
      // Both keys are the same team's, so they share the issuer.
      yield* setDeploymentSecrets(
        input.manager
          ? {
              CLUENORI_ASC_MANAGER_KEY: key.key,
              CLUENORI_ASC_MANAGER_KEY_ID: key.id,
              CLUENORI_ASC_ISSUER_ID: issuer.toLowerCase(),
            }
          : {
              CLUENORI_ASC_KEY: key.key,
              CLUENORI_ASC_KEY_ID: key.id,
              CLUENORI_ASC_ISSUER_ID: issuer.toLowerCase(),
            },
      )
      yield* Console.log(
        input.manager
          ? "\nCluenori can submit builds to App Store review and release them now, with this App Manager key. Promote one to an environment linked with --app-store: ./cluenori promote <project> <component> <release> --to <environment>"
          : "\nApp Store Connect is set up to read apps' builds and versions, with this Developer key. Link an app's component to it: ./cluenori component link <project> <component> --testflight <environment>=<bundle ID> --app-store <environment>=<bundle ID>\nTo submit builds to App Store review, add a second key, with the App Manager role: ./cluenori appstore setup <key.p8> --issuer <issuer ID> --manager",
      )
    }),
).pipe(
  Command.withDescription(
    "Give the deployment an App Store Connect API key, as Worker secrets: one with the Developer role, to follow apps' builds and App Store versions; and with --manager, a second one with the App Manager role, to submit builds to review and release them.",
  ),
)

/** `cluenori appstore ...`. */
export const appStore = Command.make("appstore").pipe(
  Command.withDescription(
    "Set up App Store Connect, where apps' builds and App Store versions come from, and where promotions submit them to review.",
  ),
  Command.withSubcommands([appStoreSetup]),
)
