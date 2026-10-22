import { BundleId } from "@cluenori/projects"
import { Console, Effect } from "effect"
import { Argument, Command, Flag } from "effect/cli"

import { AppleId, appleKeyOf } from "./apple-key.ts"
import { setDeploymentSecrets } from "./deployment-secrets.ts"
import { parsed } from "./question.ts"

/** `cluenori push setup <key file>`. */
export const pushSetup = Command.make(
  "setup",
  {
    keyFile: Argument.String("key-file").pipe(
      Argument.withDescription("The .p8 file Apple's developer site gave for an APNs key: AuthKey_<key ID>.p8."),
    ),
    keyId: Flag.String("key-id").pipe(
      Flag.optional,
      Flag.withDescription("The key's ID, when the file's name doesn't say it."),
    ),
    team: Flag.String("team").pipe(
      Flag.withDescription("Your Apple developer team's ID, as the developer site shows it."),
    ),
    app: Flag.String("app").pipe(Flag.withDescription("The iPhone app's bundle ID, which pushes are for.")),
  },
  (input) =>
    Effect.gen(function* () {
      const key = yield* appleKeyOf(input.keyFile, input.keyId)
      const team = yield* parsed(AppleId, input.team, "a team's ID")
      const app = yield* parsed(BundleId, input.app, "a bundle ID")
      // The Cluenori ./run serves can't push: workerd on this computer speaks HTTP/1.1, and APNs only
      // HTTP/2; so only a deployment gets the key.
      yield* setDeploymentSecrets({
        CLUENORI_APNS_KEY: key.key,
        CLUENORI_APNS_KEY_ID: key.id,
        CLUENORI_APNS_TEAM_ID: team,
        CLUENORI_APNS_TOPIC: app,
      })
      yield* Console.log("\nPush is set up. Ring a phone to see it reach it: ./cluenori phone test-alert")
    }),
).pipe(
  Command.withDescription(
    "Give the deployment the APNs key its alerts are sent with, as Worker secrets, and the app they're for.",
  ),
)

/** `cluenori push ...`. */
export const push = Command.make("push").pipe(
  Command.withDescription("Set up the pushes alerts reach phones by."),
  Command.withSubcommands([pushSetup]),
)
