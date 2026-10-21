import { Console, Effect, FileSystem, Option, Path, Schema } from "effect"
import { Argument, Command, Flag } from "effect/cli"

import { refuse } from "./api-client.ts"
import { savedDeployment } from "./api-settings.ts"
import { wrangler } from "./attached.ts"
import { parsed } from "./question.ts"
import { environmentFlags } from "./setup.ts"

// Apple's IDs of a key and of a team: 10 capital letters and digits.
const AppleId = Schema.String.check(Schema.isPattern(/^[A-Z0-9]{10}$/, { expected: "10 capital letters and digits" }))

// An app's bundle ID, `com.example.cluenori`.
const BundleId = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/, { expected: "a bundle ID such as com.example.cluenori" }),
)

const PushSecrets = Schema.fromJsonString(
  Schema.Struct({
    CLUENORI_APNS_KEY: Schema.String,
    CLUENORI_APNS_KEY_ID: Schema.String,
    CLUENORI_APNS_TEAM_ID: Schema.String,
    CLUENORI_APNS_TOPIC: Schema.String,
  }),
)

const pemLines = /^-----BEGIN PRIVATE KEY-----\s+([A-Za-z0-9+/=\s]+?)\s+-----END PRIVATE KEY-----\s*$/

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
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const named = /^AuthKey_([A-Z0-9]{10})\.p8$/.exec(path.basename(input.keyFile))?.[1]
        const keyIdText = Option.getOrElse(input.keyId, () => named ?? "")
        if (keyIdText === "") {
          return yield* refuse("The file's name doesn't say the key's ID: give it with --key-id.")
        }
        const keyId = yield* parsed(AppleId, keyIdText, "a key's ID")
        const team = yield* parsed(AppleId, input.team, "a team's ID")
        const app = yield* parsed(BundleId, input.app, "a bundle ID")
        const text = yield* fs
          .readFileString(input.keyFile)
          .pipe(Effect.catch(() => refuse(`Couldn't read ${input.keyFile}.`)))
        // Only the key's base64 is kept, on one line; the Worker reads either.
        const key = pemLines.exec(text.trim())?.[1]?.replace(/\s+/g, "")
        if (key === undefined) {
          return yield* refuse(`${input.keyFile} isn't a .p8 key file: it has no private key in PEM.`)
        }
        const secrets = {
          CLUENORI_APNS_KEY: key,
          CLUENORI_APNS_KEY_ID: keyId,
          CLUENORI_APNS_TEAM_ID: team,
          CLUENORI_APNS_TOPIC: app,
        }
        const saved = yield* savedDeployment
        if (Option.isNone(saved)) {
          // The Cluenori ./run serves can't push: workerd on this computer speaks HTTP/1.1, and APNs
          // only HTTP/2.
          return yield* refuse("No deployment is saved on this computer: run ./setup first.")
        }
        // The key goes through a file only this user can read, which is deleted after.
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: "cluenori-push-" }).pipe(Effect.orDie)
        const secretsFile = path.join(directory, "secrets.json")
        const encoded = yield* Schema.encodeEffect(PushSecrets)(secrets).pipe(Effect.orDie)
        yield* fs.writeFileString(secretsFile, encoded, { mode: 0o600 }).pipe(Effect.orDie)
        yield* wrangler(["secret", "bulk", secretsFile, ...environmentFlags(saved.value.jurisdiction)])
        yield* Console.log("\nPush is set up. Ring a phone to see it reach it: ./cluenori phone test-alert")
      }),
    ),
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
