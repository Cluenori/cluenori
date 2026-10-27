import { ComponentKey, EnvironmentKey, ProjectKey } from "@cluenori/foundation"
import {
  ComponentName,
  IngestKeyId,
  IngestKeyName,
  ingestKeysPerComponent,
  ProjectName,
  SdkKey,
  sdkKeysPerComponent,
} from "@cluenori/projects"
import { Console, DateTime, Duration, Effect, Option, Redacted } from "effect"
import { Argument, Command, Flag } from "effect/cli"

import { apiClient, reachFailures, refuse } from "./api-client.ts"
import { apiTarget } from "./api-settings.ts"
import { componentLinksOf, deployTargetLines } from "./deploy-targets.ts"
import { local, parsed } from "./question.ts"
import { columns, utcMinute } from "./terminal-text.ts"

/** `cluenori project create <key> --name <name>`. */
export const projectCreate = Command.make(
  "create",
  {
    key: Argument.String("key").pipe(Argument.withDescription("The project's key, such as notes. It is permanent.")),
    name: Flag.String("name").pipe(Flag.withDescription("What people call it, such as Notes.")),
    local,
  },
  (input) =>
    Effect.gen(function* () {
      const key = yield* parsed(ProjectKey, input.key, "a project key")
      const name = yield* parsed(ProjectName, input.name, "a project name")
      const target = yield* apiTarget(input.local)
      const client = yield* apiClient(target)
      const project = yield* client.projects.createProject({ payload: { key, name } }).pipe(
        Effect.catchTags({
          ...reachFailures(target),
          ProjectExists: () => refuse(`${target.url} already has a project with the key ${key}.`),
        }),
      )
      yield* Console.log(`Created ${project.name} (${project.key}) on ${target.url}.`)
      yield* Console.log(
        `Add the parts that ship separately: ./cluenori component add ${project.key} <key> --name <name>`,
      )
    }),
).pipe(Command.withDescription("Create a project: one product, with the components that ship separately."))

/** `cluenori project settings <project> [--production prod,staging]`. */
export const projectSettings = Command.make(
  "settings",
  {
    project: Argument.String("project").pipe(Argument.withDescription("The project's key.")),
    production: Flag.String("production").pipe(
      Flag.optional,
      Flag.withDescription(
        "The environments it calls production, comma-separated, such as prod: where its incidents alert and its views start.",
      ),
    ),
    local,
  },
  (input) =>
    Effect.gen(function* () {
      const project = yield* parsed(ProjectKey, input.project, "a project key")
      const target = yield* apiTarget(input.local)
      const client = yield* apiClient(target)
      const failures = {
        ...reachFailures(target),
        ProjectNotFound: () => refuse(`${target.url} has no project ${project}.`),
      }
      if (Option.isSome(input.production)) {
        const names = input.production.value
          .split(",")
          .map((name) => name.trim())
          .filter((name) => name !== "")
        if (names.length === 0) {
          return yield* refuse("Name at least one environment, such as --production prod.")
        }
        const productionEnvironments = yield* Effect.forEach(names, (name) =>
          parsed(EnvironmentKey, name, "an environment key"),
        )
        yield* client.projects
          .updateSettings({ params: { project }, payload: { productionEnvironments } })
          .pipe(Effect.catchTags(failures))
      }
      const detail = yield* client.projects.project({ params: { project } }).pipe(Effect.catchTags(failures))
      const production = detail.settings?.productionEnvironments ?? []
      yield* Console.log(`${detail.project.name} (${project}) on ${target.url}:`)
      yield* Console.log(`  Production   ${production.join(", ")}`)
      yield* Console.log(
        `  Seen lately  ${detail.environments === undefined || detail.environments.length === 0 ? "none" : detail.environments.join(", ")}`,
      )
      yield* Console.log(
        "\nIncidents alert only in production environments, and telemetry without an environment counts as production.",
      )
    }),
).pipe(
  Command.withDescription(
    "Show a project's settings, or change the environments it calls production: where its incidents alert and its views start.",
  ),
)

/** `cluenori component add <project> <key> --name <name>`. */
export const componentAdd = Command.make(
  "add",
  {
    project: Argument.String("project").pipe(Argument.withDescription("The project's key.")),
    key: Argument.String("key").pipe(
      Argument.withDescription("The component's key, such as notes-api. It is permanent."),
    ),
    name: Flag.String("name").pipe(Flag.withDescription("What people call it, such as Notes API.")),
    local,
  },
  (input) =>
    Effect.gen(function* () {
      const project = yield* parsed(ProjectKey, input.project, "a project key")
      const key = yield* parsed(ComponentKey, input.key, "a component key")
      const name = yield* parsed(ComponentName, input.name, "a component name")
      const target = yield* apiTarget(input.local)
      const client = yield* apiClient(target)
      const added = yield* client.projects.addComponent({ params: { project }, payload: { key, name } }).pipe(
        Effect.catchTags({
          ...reachFailures(target),
          ProjectNotFound: () =>
            refuse(
              `${target.url} has no project ${project}. Create it: ./cluenori project create ${project} --name <name>`,
            ),
          ComponentExists: () => refuse(`${project} already has a component with the key ${key}.`),
          NotAllowed: () => refuse("Only an owner adds a component, as it comes with an ingest key."),
        }),
      )
      const ingestKey = Redacted.make(added.ingestKey)
      yield* Console.log(
        `Added ${added.component.name} (${added.component.key}) to ${project}. Its ingest key, shown only now:\n`,
      )
      yield* Console.log(`  ${Redacted.value(ingestKey)}\n`)
      yield* Console.log("Send its traces to Cluenori with OpenTelemetry's OTLP exporter, over HTTP with protobuf:")
      yield* Console.log(`  Endpoint  ${target.url}/otlp/v1/traces`)
      yield* Console.log(`  Header    Authorization: Bearer ${Redacted.value(ingestKey)}`)
    }),
).pipe(Command.withDescription("Add a component to a project, and get the ingest key its telemetry is sent with."))

/**
 * `cluenori component link <project> <component> [--repository owner/name]
 * [--deploy environment=workflow.yml ...] [--testflight environment=bundle-id ...]
 * [--app-store environment=bundle-id ...]`.
 */
export const componentLink = Command.make(
  "link",
  {
    project: Argument.String("project").pipe(Argument.withDescription("The project's key.")),
    component: Argument.String("component").pipe(Argument.withDescription("The component's key.")),
    repository: Flag.String("repository").pipe(
      Flag.optional,
      Flag.withDescription(
        "Its GitHub repository, owner/name: whose commits its releases are, and where its deploy workflows run.",
      ),
    ),
    deploy: Flag.String("deploy").pipe(
      Flag.atLeast(0),
      Flag.withDescription(
        "An environment and the workflow in the repository that builds and deploys a release there, such as production=deploy.yml; once for each environment. Promoting starts it with the inputs release, environment, commit and runner.",
      ),
    ),
    testFlight: Flag.String("testflight").pipe(
      Flag.atLeast(0),
      Flag.withDescription(
        "An environment and the bundle ID of the App Store Connect app its builds go to in TestFlight, such as beta=com.example.notes.beta; once for each environment.",
      ),
    ),
    appStore: Flag.String("app-store").pipe(
      Flag.atLeast(0),
      Flag.withDescription(
        "An environment and the bundle ID of the App Store Connect app its builds go to through App Store review to the App Store, such as production=com.example.notes.",
      ),
    ),
    shipsWith: Flag.String("ships-with").pipe(
      Flag.optional,
      Flag.withDescription(
        "Another component of the project whose deploys deploy this one too, from the same commit with the same release, such as a background service the API's workflow builds and deploys; it then has no deploy targets of its own.",
      ),
    ),
    local,
  },
  (input) =>
    Effect.gen(function* () {
      const project = yield* parsed(ProjectKey, input.project, "a project key")
      const component = yield* parsed(ComponentKey, input.component, "a component key")
      const links = yield* componentLinksOf({
        repository: input.repository,
        deploy: input.deploy,
        testFlight: input.testFlight,
        appStore: input.appStore,
        shipsWith: input.shipsWith,
      })
      const target = yield* apiTarget(input.local)
      const client = yield* apiClient(target)
      const linked = yield* client.projects.linkComponent({ params: { project, component }, payload: links }).pipe(
        Effect.catchTags({
          ...reachFailures(target),
          ProjectNotFound: () => refuse(`${target.url} has no project ${project}.`),
          ComponentNotFound: (error) =>
            refuse(
              error.component === component
                ? `${project} has no component ${component}.`
                : `${component} can't ship with ${error.component}: ${project} has no other component ${error.component}.`,
            ),
        }),
      )
      const targets = linked.deployTargets ?? []
      const repository = linked.repository === undefined ? ", with no repository" : ` to ${linked.repository}`
      yield* Console.log(`Linked ${linked.name} (${linked.key})${repository}.\n`)
      const targetsText =
        targets.length === 0
          ? "It has no deploy targets, so its releases can't be promoted from Cluenori: add them with --deploy, --testflight and --app-store."
          : `Its deploy targets:\n${deployTargetLines(targets)
              .map((line) => `  ${line}`)
              .join("\n")}`
      yield* Console.log(
        linked.shipsWith === undefined
          ? targetsText
          : `It ships with ${linked.shipsWith}: promoting ${linked.shipsWith} deploys it too.`,
      )
      yield* Console.log(
        "\nIts releases' commits and store builds appear within a few minutes, once the deployment is connected to GitHub (./cluenori github) and has App Store Connect's key (./cluenori appstore setup).",
      )
    }),
).pipe(
  Command.withDescription(
    "Link a component to its GitHub repository and its deploy targets: in each environment, the workflow that deploys its releases, the App Store Connect app its builds go to, or both. An option left out unlinks it.",
  ),
)

/** `cluenori component sdk-keys <project> <component> [--new] [--revoke <key>]`. */
export const componentSdkKeys = Command.make(
  "sdk-keys",
  {
    project: Argument.String("project").pipe(Argument.withDescription("The project's key.")),
    component: Argument.String("component").pipe(Argument.withDescription("The component's key, such as notes-ios.")),
    issue: Flag.Boolean("new").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Issue a new key. The component's other keys stay active until revoked."),
    ),
    revoke: Flag.String("revoke").pipe(
      Flag.optional,
      Flag.withDescription("Revoke this key: builds that carry it are refused from then on."),
    ),
    local,
  },
  (input) =>
    Effect.gen(function* () {
      const project = yield* parsed(ProjectKey, input.project, "a project key")
      const component = yield* parsed(ComponentKey, input.component, "a component key")
      if (input.issue && Option.isSome(input.revoke)) {
        return yield* refuse("Use --new or --revoke, not both: issue the new key, ship it, then revoke the old one.")
      }
      const listCommand = `./cluenori component sdk-keys ${project} ${component}`
      const target = yield* apiTarget(input.local)
      const client = yield* apiClient(target)
      const failures = {
        ...reachFailures(target),
        ProjectNotFound: () => refuse(`${target.url} has no project ${project}.`),
        ComponentNotFound: () =>
          refuse(
            `${project} has no component ${component}. Add it: ./cluenori component add ${project} ${component} --name <name>`,
          ),
      }
      if (input.issue) {
        const issued = yield* client.projects.issueSdkKey({ params: { project, component } }).pipe(
          Effect.catchTags({
            ...failures,
            TooManySdkKeys: () =>
              refuse(`${component} has ${sdkKeysPerComponent} active SDK keys, the most it may: revoke one first.`),
          }),
        )
        yield* Console.log(`Issued an SDK key for ${component} of ${project}:\n`)
        yield* Console.log(`  ${issued.key}\n`)
        yield* Console.log(
          "Put it in the app's SDK configuration. It ships inside every build, so it isn't a secret: it only sends this component's signals and reads its manifest.",
        )
        return yield* Console.log(
          `The component's other keys stay active until you revoke them: ${listCommand} --revoke <key>`,
        )
      }
      if (Option.isSome(input.revoke)) {
        const key = yield* parsed(SdkKey, input.revoke.value, "an SDK key")
        const revoked = yield* client.projects.revokeSdkKey({ params: { project, component, key } }).pipe(
          Effect.catchTags({
            ...reachFailures(target),
            ProjectNotFound: () => refuse(`${target.url} has no project ${project}.`),
            SdkKeyNotFound: () =>
              refuse(`${component} of ${project} has no SDK key ${key}. See its keys: ${listCommand}`),
          }),
        )
        const since = revoked.revokedAt === undefined ? "now" : utcMinute(revoked.revokedAt)
        return yield* Console.log(
          `Revoked ${revoked.key} (since ${since}). Builds that carry it are refused from now on.`,
        )
      }
      const list = yield* client.projects.sdkKeys({ params: { project, component } }).pipe(Effect.catchTags(failures))
      if (list.keys.length === 0) {
        return yield* Console.log(`${component} has no SDK keys yet. Issue one: ${listCommand} --new`)
      }
      yield* Console.log(
        columns([
          ["Key", "Issued", "Revoked"],
          ...list.keys.map((issued) => [
            issued.key,
            utcMinute(issued.issuedAt),
            issued.revokedAt === undefined ? "active" : utcMinute(issued.revokedAt),
          ]),
        ]).join("\n"),
      )
    }),
).pipe(
  Command.withDescription(
    "List a component's SDK keys, the keys its app's builds carry so its SDK can send signals; issue a new one with --new, the others staying active, or revoke one with --revoke.",
  ),
)

// How long a new ingest key works, and how long until a revocation takes effect.
const keyLives = { "30d": Duration.days(30), "90d": Duration.days(90), "365d": Duration.days(365) }
const revokeDelays = { "1h": Duration.hours(1), "24h": Duration.days(1), "7d": Duration.days(7) }

// A moment a key ends at, or nothing when it doesn't.
const ends = (at: DateTime.Utc | undefined) => (at === undefined ? "" : utcMinute(at))

/**
 * `cluenori component ingest-keys <project> <component> [--new <name> [--expires 90d]]
 * [--revoke <id> [--in 24h]]`.
 */
export const componentIngestKeys = Command.make(
  "ingest-keys",
  {
    project: Argument.String("project").pipe(Argument.withDescription("The project's key.")),
    component: Argument.String("component").pipe(Argument.withDescription("The component's key, such as notes-api.")),
    add: Flag.String("new").pipe(
      Flag.optional,
      Flag.withDescription(
        "Add a key with this name, such as blue or 2026-11; it is shown once. The component's other keys keep working.",
      ),
    ),
    expires: Flag.Literals("expires", ["30d", "90d", "365d"]).pipe(
      Flag.optional,
      Flag.withDescription("With --new: the key stops working this long from now. Without it, it works until revoked."),
    ),
    revoke: Flag.String("revoke").pipe(
      Flag.optional,
      Flag.withDescription("Revoke the key with this ID: what is sent with it is refused from then on."),
    ),
    after: Flag.Literals("in", ["1h", "24h", "7d"]).pipe(
      Flag.optional,
      Flag.withDescription("With --revoke: it stops working this long from now, not at once."),
    ),
    local,
  },
  (input) =>
    Effect.gen(function* () {
      const project = yield* parsed(ProjectKey, input.project, "a project key")
      const component = yield* parsed(ComponentKey, input.component, "a component key")
      if (Option.isSome(input.add) && Option.isSome(input.revoke)) {
        return yield* refuse("Use --new or --revoke, not both: add the new key, deploy it, then revoke the old one.")
      }
      if (Option.isSome(input.expires) && Option.isNone(input.add)) {
        return yield* refuse("--expires goes with --new.")
      }
      if (Option.isSome(input.after) && Option.isNone(input.revoke)) {
        return yield* refuse("--in goes with --revoke.")
      }
      const listCommand = `./cluenori component ingest-keys ${project} ${component}`
      const target = yield* apiTarget(input.local)
      const client = yield* apiClient(target)
      const failures = {
        ...reachFailures(target),
        ProjectNotFound: () => refuse(`${target.url} has no project ${project}.`),
        ComponentNotFound: () =>
          refuse(
            `${project} has no component ${component}. Add it: ./cluenori component add ${project} ${component} --name <name>`,
          ),
        NotAllowed: () => refuse("Only an owner manages ingest keys."),
      }
      const now = yield* DateTime.now
      if (Option.isSome(input.add)) {
        const name = yield* parsed(IngestKeyName, input.add.value, "a key's name")
        const added = yield* client.projects
          .addIngestKey({
            params: { project, component },
            payload: {
              name,
              ...(Option.isSome(input.expires)
                ? { expiresAt: DateTime.addDuration(now, keyLives[input.expires.value]) }
                : {}),
            },
          })
          .pipe(
            Effect.catchTags({
              ...failures,
              IngestKeyRefused: (refused) =>
                refuse(
                  refused.reason === "tooMany"
                    ? `${component} has ${ingestKeysPerComponent} keys that work, the most it may: revoke one first. See them: ${listCommand}`
                    : "That key would expire at once.",
                ),
            }),
          )
        yield* Console.log(
          `Added the ingest key "${added.key.name}" (${added.key.id}) to ${component} of ${project}:\n`,
        )
        yield* Console.log(`  ${added.ingestKey}\n`)
        yield* Console.log("It is shown only now: keep it in your service's secrets.")
        return yield* Console.log(
          `Deploy it; once the old key's last use stops moving, revoke it: ${listCommand} --revoke <id> [--in 24h]`,
        )
      }
      if (Option.isSome(input.revoke)) {
        const key = yield* parsed(IngestKeyId, input.revoke.value, "an ingest key's ID")
        const revoked = yield* client.projects
          .revokeIngestKey({
            params: { project, component, key },
            payload: Option.isSome(input.after)
              ? { at: DateTime.addDuration(now, revokeDelays[input.after.value]) }
              : {},
          })
          .pipe(
            Effect.catchTags({
              ...reachFailures(target),
              ProjectNotFound: failures.ProjectNotFound,
              NotAllowed: failures.NotAllowed,
              IngestKeyNotFound: () =>
                refuse(`${component} of ${project} lists no ingest key ${key}. See them: ${listCommand}`),
            }),
          )
        const at = revoked.revokedAt === undefined ? "now" : utcMinute(revoked.revokedAt)
        return yield* Console.log(
          `"${revoked.name}" stops working at ${at}; what is sent with it is refused from then on.`,
        )
      }
      const list = yield* client.projects
        .ingestKeys({ params: { project, component } })
        .pipe(Effect.catchTags(failures))
      if (list.keys.length === 0) {
        return yield* Console.log(`${component} has no ingest keys. Add one: ${listCommand} --new <name>`)
      }
      const nowMillis = DateTime.toEpochMillis(now)
      const stateOf = (key: (typeof list.keys)[number]) => {
        const ended = [key.revokedAt, key.expiresAt].some(
          (at) => at !== undefined && DateTime.toEpochMillis(at) <= nowMillis,
        )
        return ended ? "ended" : "works"
      }
      yield* Console.log(
        columns([
          ["ID", "Name", "State", "Added", "Last used", "Expires", "Revoked"],
          ...list.keys.map((key) => [
            key.id,
            key.name,
            stateOf(key),
            utcMinute(key.createdAt),
            key.lastUsedAt === undefined ? "never" : `${utcMinute(key.lastUsedAt)} hour`,
            ends(key.expiresAt),
            ends(key.revokedAt),
          ]),
        ]).join("\n"),
      )
    }),
).pipe(
  Command.withDescription(
    "List a component's ingest keys, which its services send telemetry with; add one with --new, the others working on, or revoke one with --revoke, at once or --in a while. Owners only. To change a key without a gap: add one, deploy it, wait until the old one's last use stops moving, then revoke it.",
  ),
)

/** `cluenori project ...`. */
export const project = Command.make("project").pipe(
  Command.withDescription("Create projects, and choose their production environments."),
  Command.withSubcommands([projectCreate, projectSettings]),
)

/** `cluenori component ...`. */
export const component = Command.make("component").pipe(
  Command.withDescription(
    "Add components to projects, link them to their repository and deploy targets, where their releases go, and manage the ingest keys their services send with and the SDK keys their apps' builds carry.",
  ),
  Command.withSubcommands([componentAdd, componentLink, componentIngestKeys, componentSdkKeys]),
)
