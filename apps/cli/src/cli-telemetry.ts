import type { Cluenori, KeptStore } from "@cluenori/sdk"
import { program, start, telemetryChoice, telemetryNotice } from "@cluenori/sdk"
import { ClientTelemetry } from "@cluenori/worker"
import { Config, Console, Context, DateTime, Duration, Effect, FileSystem, Option, Path, Schema } from "effect"
import type { Command } from "effect/cli"
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/http"
import { ChildProcess, ChildProcessSpawner } from "effect/process"

import type { SavedDeployment } from "./api-settings.ts"
import { deploymentPath, savedDeployment } from "./api-settings.ts"

// The CLI measures itself with the deployment it is set up for, and nowhere else, when that
// deployment measures itself (`./cluenori self-telemetry on`): each run is a session, each command
// its screen, by the command's name alone, never its arguments. Off with CLUENORI_TELEMETRY=off or
// DO_NOT_TRACK=1, said the first time it sends.

/** The headers of the run's requests to the deployment's API: the release, a trace, its feature and origin. */
export const ClientHeaders = Context.Reference<(existing: Record<string, string>) => Record<string, string>>(
  "@cluenori/cli/cli-telemetry/ClientHeaders",
  { defaultValue: () => (existing) => existing },
)

// What is kept between runs: what the deployment said, the machine, the notice shown, and the SDK's
// own store (its installation, and what waits to be sent).
const Kept = Schema.Struct({
  url: Schema.String,
  checkedAt: Schema.Finite,
  telemetry: Schema.optionalKey(ClientTelemetry),
  member: Schema.optionalKey(Schema.String),
  machine: Schema.Struct({
    platform: Schema.Literals(["macOS", "linux", "windows"]),
    model: Schema.String,
    osVersion: Schema.String,
  }),
  noticeShown: Schema.Boolean,
  store: Schema.Record(Schema.String, Schema.String),
})
type Kept = typeof Kept.Type
const KeptJson = Schema.fromJsonString(Kept)

// What the deployment says is asked again once a day, and at most this long before a command runs.
const checkEvery = Duration.days(1)
const askTimeout = Duration.millis(1500)

// The commands each feature is, by the command, else its first word: the names the dashboard and
// the phone use too (docs/self-telemetry.md, "Features").
const features: Readonly<Record<string, string>> = {
  today: "today",
  operations: "tech.performance",
  operation: "tech.performance",
  load: "tech.performance",
  errors: "tech.errors",
  error: "tech.errors",
  logs: "tech.logs",
  "log-messages": "tech.logs",
  trace: "tech.traces",
  incidents: "incidents",
  incident: "incidents",
  acknowledge: "incidents.acknowledge",
  monitors: "uptime",
  monitor: "uptime",
  releases: "releases",
  release: "releases",
  delivery: "releases.delivery",
  promote: "releases.promote",
  "release-approved": "releases.promote",
  version: "releases.versions",
  "version-policy": "analytics.version-policy",
  notes: "releases.notes",
  "notes-style": "releases.notes",
  feature: "analytics.features",
  person: "analytics.people",
  feeds: "feeds",
  feed: "feeds",
  project: "settings.projects",
  component: "settings.projects",
  members: "settings.members",
  member: "settings.members",
  phones: "settings.phones",
  phone: "settings.phones",
  "component sdk-keys": "analytics.sdk-keys",
  "component ingest-keys": "settings.ingest-keys",
}

/** The command a run is, by its subcommands' names alone: `project create`; never an argument. */
export const commandOf = (root: Command.Command.Any, args: ReadonlyArray<string>): ReadonlyArray<string> => {
  const path: Array<string> = []
  let current = root
  for (const word of args) {
    if (word.startsWith("-")) {
      continue
    }
    const next = current.subcommands.flatMap((group) => group.commands).find((command) => command.name === word)
    if (next === undefined) {
      break
    }
    path.push(next.name)
    current = next
  }
  return path
}

const keptPath = Effect.gen(function* () {
  const path = yield* Path.Path
  const deployment = yield* deploymentPath
  return path.join(path.dirname(deployment), "cli-telemetry.json")
})

const readKept = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const file = yield* keptPath
  const text = yield* fs.readFileString(file).pipe(Effect.option)
  return Option.flatMap(text, (each) => Schema.decodeOption(KeptJson)(each))
})

const writeKept = (kept: Kept) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const file = yield* keptPath
    const text = yield* Schema.encodeEffect(KeptJson)(kept)
    yield* fs.writeFileString(file, text, { mode: 0o600 })
  }).pipe(Effect.ignore)

// The platform of each `uname -s` the CLI runs on; anything else is Windows (or a shell on it).
const platformOfSystem: Readonly<Record<string, "macOS" | "linux">> = { Darwin: "macOS", Linux: "linux" }

// The machine, as `uname` says it; macOS's version from `sw_vers`.
const machineOf = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const uname = yield* spawner
    .string(ChildProcess.make("uname", ["-s", "-m", "-r"]))
    .pipe(Effect.orElseSucceed(() => ""))
  const [system = "", release = "unknown", model = "unknown"] = uname.trim().split(" ")
  const platform: "macOS" | "linux" | "windows" = platformOfSystem[system] ?? "windows"
  const osVersion =
    platform === "macOS"
      ? yield* spawner.string(ChildProcess.make("sw_vers", ["-productVersion"])).pipe(
          Effect.map((text) => text.trim()),
          Effect.orElseSucceed(() => release),
        )
      : release
  return { platform, model, osVersion: osVersion === "" ? "unknown" : osVersion }
})

// What the deployment says of its own clients, and who the token is, asked with a short timeout.
const ask = (deployment: SavedDeployment, url: string) =>
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    const telemetry = yield* http
      .get(`${url}/api/client-telemetry`)
      .pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(ClientTelemetry)), Effect.option)
    const me = yield* http
      .get(`${url}/api/me`, { headers: { authorization: `Bearer ${deployment.token ?? ""}` } })
      .pipe(
        Effect.flatMap(HttpClientResponse.schemaBodyJson(Schema.Struct({ id: Schema.String }))),
        Effect.map((member) => member.id),
        Effect.option,
      )
    return { telemetry, me }
  }).pipe(
    Effect.timeoutOption(askTimeout),
    Effect.map((answer) => ({
      telemetry: Option.flatMap(answer, (each) => each.telemetry),
      me: Option.flatMap(answer, (each) => each.me),
    })),
    Effect.provide(FetchHttpClient.layer),
  )

// What is kept, asked again: what the deployment says now, with what the last run kept of the SDK.
const askedAgain = Effect.fn("askedAgain")(function* (
  deployment: SavedDeployment,
  url: string,
  nowMillis: number,
  before: Option.Option<Kept>,
) {
  const answer = yield* ask(deployment, url)
  const machine = yield* machineOf
  const previous = Option.filter(before, (each) => each.url === url)
  const kept: Kept = {
    url,
    checkedAt: nowMillis,
    ...Option.match(answer.telemetry, { onNone: () => ({}), onSome: (telemetry) => ({ telemetry }) }),
    ...Option.match(answer.me, { onNone: () => ({}), onSome: (member) => ({ member }) }),
    machine,
    noticeShown: Option.match(previous, { onNone: () => false, onSome: (each) => each.noticeShown }),
    store: Option.match(previous, { onNone: () => ({}), onSome: (each) => each.store }),
  }
  return kept
})

const choiceSettings = Config.all({
  CLUENORI_TELEMETRY: Config.option(Config.String("CLUENORI_TELEMETRY")),
  DO_NOT_TRACK: Config.option(Config.String("DO_NOT_TRACK")),
})

/** Runs `run`, the CLI's command, measured when the deployment it is set up for measures its CLI. */
export const measured = <A, E, R>(
  root: Command.Command.Any,
  args: ReadonlyArray<string>,
  run: Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const settings = yield* choiceSettings.pipe(Effect.orDie)
    const choice = telemetryChoice({
      CLUENORI_TELEMETRY: Option.getOrUndefined(settings.CLUENORI_TELEMETRY),
      DO_NOT_TRACK: Option.getOrUndefined(settings.DO_NOT_TRACK),
    })
    const command = commandOf(root, args)
    const saved = yield* savedDeployment
    const url = Option.flatMap(saved, (each) => Option.fromNullishOr(each.url))
    // Setting up and running locally aren't measured: they have no deployment to tell yet, or are its own.
    const first = command[0] ?? ""
    const skip = choice._tag === "Off" || Option.isNone(url) || first === "" || first === "run" || first === "setup"
    if (skip || Option.isNone(saved) || Option.isNone(url)) {
      return yield* run
    }
    const now = yield* DateTime.now
    const nowMillis = DateTime.toEpochMillis(now)
    const before = yield* readKept
    const fresh = Option.filter(
      before,
      (kept) => kept.url === url.value && nowMillis - kept.checkedAt < Duration.toMillis(checkEvery),
    )
    const kept = Option.isSome(fresh) ? fresh.value : yield* askedAgain(saved.value, url.value, nowMillis, before)
    const key = kept.telemetry?.cli
    const release = kept.telemetry?.release
    if (key === undefined || release === undefined) {
      yield* writeKept(kept)
      return yield* run
    }
    if (!kept.noticeShown) {
      yield* Console.error(`${telemetryNotice("./cluenori", url.value)}\n`)
    }
    // The SDK's store, in memory for the run and written back after it.
    const store = new Map(Object.entries(kept.store))
    const keptStore: KeptStore = {
      read: (name) => store.get(name),
      write: (name, text) => {
        if (text === undefined) {
          store.delete(name)
        } else {
          store.set(name, text)
        }
      },
    }
    const cluenori: Cluenori = start({
      key,
      environment: kept.telemetry?.environment ?? "production",
      deployment: url.value,
      release,
      runtime: program({ store: keptStore, ...kept.machine }),
    })
    if (kept.member !== undefined) {
      cluenori.identify(kept.member)
    }
    const feature = features[command.join(" ")] ?? features[first]
    const mark = feature === undefined ? undefined : cluenori.begin(feature)
    cluenori.screen(command.join(" "))
    const exit = yield* run.pipe(
      Effect.provideService(ClientHeaders, (existing) => cluenori.headers(existing)),
      Effect.exit,
    )
    // What failed, by its kind alone: a refusal's words may hold what was typed.
    if (exit._tag === "Failure") {
      const failure = exit.cause.reasons.find((reason) => reason._tag === "Fail")
      const tag =
        failure !== undefined && typeof failure.error === "object" && failure.error !== null && "_tag" in failure.error
          ? String(failure.error._tag)
          : "Defect"
      cluenori.error({ name: tag, message: "" }, { handled: tag !== "Defect" })
    }
    mark?.end()
    yield* Effect.promise(() => cluenori.shutdown()).pipe(Effect.timeoutOption(Duration.seconds(3)))
    yield* writeKept({ ...kept, noticeShown: true, store: Object.fromEntries(store) })
    return yield* exit
  })
