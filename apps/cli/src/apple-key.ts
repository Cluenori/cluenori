import { Effect, FileSystem, Option, Path, Schema } from "effect"

import { refuse } from "./api-client.ts"
import { parsed } from "./question.ts"

/** Apple's IDs of a key and of a team: 10 capital letters and digits. */
export const AppleId = Schema.String.check(
  Schema.isPattern(/^[A-Z0-9]{10}$/, { expected: "10 capital letters and digits" }),
)

const pemLines = /^-----BEGIN PRIVATE KEY-----\s+([A-Za-z0-9+/=\s]+?)\s+-----END PRIVATE KEY-----\s*$/

/**
 * A `.p8` key file Apple gave, an APNs or App Store Connect key: its ID, from `--key-id` or the
 * file's name, `AuthKey_<key ID>.p8`; and its private key, only the base64, on one line, which the
 * Worker reads either way. Refuses a file it can't read, one without a key in PEM, or an ID it
 * can't tell.
 */
export const appleKeyOf = Effect.fn("appleKeyOf")(function* (file: string, keyId: Option.Option<string>) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const named = /^AuthKey_([A-Z0-9]{10})\.p8$/.exec(path.basename(file))?.[1]
  const idText = Option.getOrElse(keyId, () => named ?? "")
  if (idText === "") {
    return yield* refuse("The file's name doesn't say the key's ID: give it with --key-id.")
  }
  const id = yield* parsed(AppleId, idText, "a key's ID")
  const text = yield* fs.readFileString(file).pipe(Effect.catch(() => refuse(`Couldn't read ${file}.`)))
  const key = pemLines.exec(text.trim())?.[1]?.replace(/\s+/g, "")
  if (key === undefined) {
    return yield* refuse(`${file} isn't a .p8 key file: it has no private key in PEM.`)
  }
  return { id, key }
})
