import { Config, Crypto, Effect, FileSystem, Option, Path, Redacted, Schema } from "effect"
import { Base64Url } from "effect/encoding"

/** Where a command sends its API calls, the token it sends, and how to name the place to a person. */
export interface ApiTarget {
  readonly url: string
  readonly token: Redacted.Redacted
  readonly local: boolean
}

/** Where `./run` serves Cluenori. */
export const localUrl = "http://localhost:8787"

// Wrangler reads it next to wrangler.jsonc when it runs the Worker on this computer. Git ignores it.
const devVarsPath = "apps/worker/.dev.vars"

/** A new API token, 32 random bytes as base64url, and the ID of the member it stands for. */
export const newApiSettings = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto
  const bytes = yield* crypto.randomBytes(32).pipe(Effect.orDie)
  const owner = yield* crypto.randomUUIDv7().pipe(Effect.orDie)
  return { token: Base64Url.encode(bytes), owner }
})

// `.dev.vars` holds `NAME=value` lines; Cluenori's values are never quoted.
const variablesOf = (text: string) =>
  new Map(
    text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.includes("=") && !line.startsWith("#"))
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)] as const),
  )

const readDevVars = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const exists = yield* fs.exists(devVarsPath).pipe(Effect.orDie)
  if (!exists) {
    return ""
  }
  return yield* fs.readFileString(devVarsPath).pipe(Effect.orDie)
})

/**
 * Makes sure the Worker `./run` starts has an API token and an owner, in apps/worker/.dev.vars,
 * adding whichever is missing the first time. Leaves every other line as it is.
 */
export const ensureLocalApiSettings = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const text = yield* readDevVars
  const variables = variablesOf(text)
  const fresh = yield* newApiSettings
  const missing = [
    ...(variables.has("CLUENORI_API_TOKEN") ? [] : [`CLUENORI_API_TOKEN=${fresh.token}`]),
    ...(variables.has("CLUENORI_OWNER") ? [] : [`CLUENORI_OWNER=${fresh.owner}`]),
  ]
  if (missing.length === 0) {
    return
  }
  const separator = text === "" || text.endsWith("\n") ? "" : "\n"
  yield* fs
    .writeFileString(devVarsPath, `${text}${separator}${missing.join("\n")}\n`, { mode: 0o600 })
    .pipe(Effect.orDie)
})

/** Where a deployment keeps its data: anywhere Cloudflare chooses, or in the EU. Fixed at setup. */
export const Jurisdiction = Schema.Literals(["global", "eu"])
export type Jurisdiction = typeof Jurisdiction.Type

/** A hostname a deployment can serve at, such as app.example.com, lowercase. */
export const Hostname = Schema.String.check(
  Schema.isPattern(/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, {
    expected: "a hostname such as app.example.com",
  }),
).pipe(Schema.brand("Hostname"))
export type Hostname = typeof Hostname.Type

/** A Cloudflare account's ID, as Wrangler and the dashboard show it: 32 hexadecimal characters. */
export const CloudflareAccountId = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{32}$/, { expected: "a Cloudflare account's ID: 32 hexadecimal characters" }),
).pipe(Schema.brand("CloudflareAccountId"))
export type CloudflareAccountId = typeof CloudflareAccountId.Type

/**
 * The deployment `./setup` made from this computer: where it keeps its data, saved as soon as it is
 * chosen; the Cloudflare account it is in, which every Wrangler command names (absent from a
 * deployment saved before it was kept, until the next `./setup` or `./update` saves it); the domain
 * it serves at besides workers.dev, if one was given; and, once deployed, where commands reach it
 * and its API token.
 */
export const SavedDeployment = Schema.Struct({
  jurisdiction: Jurisdiction,
  account: Schema.optionalKey(CloudflareAccountId),
  domain: Schema.optionalKey(Hostname),
  url: Schema.optionalKey(Schema.String),
  token: Schema.optionalKey(Schema.String),
})
export type SavedDeployment = typeof SavedDeployment.Type

const SavedDeploymentJson = Schema.fromJsonString(SavedDeployment, { space: 2 })

/** Where `./setup` saves the deployment: in the user's configuration folder, readable by them alone, since it holds the API token. */
export const deploymentPath = Effect.gen(function* () {
  const path = yield* Path.Path
  const configHome = yield* Config.option(Config.String("XDG_CONFIG_HOME"))
  const home = yield* Config.String("HOME").pipe(Effect.orDie)
  const base = Option.getOrElse(configHome, () => path.join(home, ".config"))
  return path.join(base, "cluenori", "deployment.json")
})

/** The deployment `./setup` saved, if it has run on this computer. */
export const savedDeployment = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const file = yield* deploymentPath.pipe(Effect.orDie)
  const exists = yield* fs.exists(file).pipe(Effect.orDie)
  if (!exists) {
    return Option.none<SavedDeployment>()
  }
  const text = yield* fs.readFileString(file).pipe(Effect.orDie)
  const deployment = yield* Schema.decodeEffect(SavedDeploymentJson)(text).pipe(Effect.orDie)
  return Option.some(deployment)
})

/** Saves where a deployment serves and its token, for later commands. */
export const saveDeployment = Effect.fn("saveDeployment")(function* (deployment: SavedDeployment) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const file = yield* deploymentPath.pipe(Effect.orDie)
  const text = yield* Schema.encodeEffect(SavedDeploymentJson)(deployment).pipe(Effect.orDie)
  yield* fs.makeDirectory(path.dirname(file), { recursive: true, mode: 0o700 }).pipe(Effect.orDie)
  yield* fs.writeFileString(file, `${text}\n`, { mode: 0o600 }).pipe(Effect.orDie)
  return file
})

/**
 * Where commands send API calls: the deployment `./setup` saved, or with `local`, or when there is
 * none, the Cluenori `./run` serves on this computer.
 */
export const apiTarget = Effect.fn("apiTarget")(function* (local: boolean) {
  const deployment = yield* savedDeployment
  const url = Option.flatMap(deployment, (saved) => Option.fromNullishOr(saved.url))
  const token = Option.flatMap(deployment, (saved) => Option.fromNullishOr(saved.token))
  if (!local && Option.isSome(url) && Option.isSome(token)) {
    const target: ApiTarget = { url: url.value, token: Redacted.make(token.value), local: false }
    return target
  }
  yield* ensureLocalApiSettings
  const text = yield* readDevVars
  const variables = variablesOf(text)
  const target: ApiTarget = {
    url: localUrl,
    token: Redacted.make(variables.get("CLUENORI_API_TOKEN") ?? ""),
    local: true,
  }
  return target
})
