import { Console, Effect, Redacted, Schema } from "effect"
import { Argument, Command, Flag, Prompt } from "effect/cli"

import { refuse } from "./api-client.ts"
import { appleKeyOf } from "./apple-key.ts"
import { setDeploymentSecrets } from "./deployment-secrets.ts"
import { parsed } from "./question.ts"

// An App Store Connect issuer ID: a UUID.
const IssuerId = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, { expected: "a UUID" }),
)

// What GitHub's tokens start with: fine-grained `github_pat_`, classic `ghp_`.
const githubToken = /^(github_pat_|ghp_)[A-Za-z0-9_]{20,255}$/

/** `cluenori github setup`: asks for the token without showing it. */
export const githubSetup = Command.make("setup", {}, () =>
  Effect.gen(function* () {
    const token = yield* Prompt.run(
      Prompt.Hidden({
        message:
          "A GitHub fine-grained token, read-only, for your components' repositories: Contents, Metadata, and Pull requests. Paste it; it isn't shown.",
        validate: (value) =>
          githubToken.test(value.trim())
            ? Effect.succeed(value)
            : Effect.fail("That isn't a GitHub token: one starts with github_pat_ or ghp_."),
      }),
    ).pipe(Effect.catchTag("QuitError", () => refuse("Stopped before it changed anything.")))
    yield* setDeploymentSecrets({ CLUENORI_GITHUB_TOKEN: Redacted.value(token).trim() })
    yield* Console.log(
      "\nGitHub is set up. Link a component to its repository: ./cluenori component link <project> <component> --repository owner/name",
    )
  }),
).pipe(
  Command.withDescription(
    "Give the deployment a read-only GitHub token, as a Worker secret, to find releases' commits and what changed.",
  ),
)

/** `cluenori github ...`. */
export const github = Command.make("github").pipe(
  Command.withDescription("Set up GitHub, where releases' commits and changes come from."),
  Command.withSubcommands([githubSetup]),
)

/** `cluenori appstore setup <key file> --issuer <issuer ID>`. */
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
  },
  (input) =>
    Effect.gen(function* () {
      const key = yield* appleKeyOf(input.keyFile, input.keyId)
      const issuer = yield* parsed(IssuerId, input.issuer, "an issuer ID")
      yield* setDeploymentSecrets({
        CLUENORI_ASC_KEY: key.key,
        CLUENORI_ASC_KEY_ID: key.id,
        CLUENORI_ASC_ISSUER_ID: issuer.toLowerCase(),
      })
      yield* Console.log(
        "\nApp Store Connect is set up. Link an app's component to it: ./cluenori component link <project> <component> --app-store <bundle ID>",
      )
    }),
).pipe(
  Command.withDescription(
    "Give the deployment an App Store Connect API key, as Worker secrets, to follow apps' builds and App Store versions.",
  ),
)

/** `cluenori appstore ...`. */
export const appStore = Command.make("appstore").pipe(
  Command.withDescription("Set up App Store Connect, where apps' builds and App Store versions come from."),
  Command.withSubcommands([appStoreSetup]),
)
