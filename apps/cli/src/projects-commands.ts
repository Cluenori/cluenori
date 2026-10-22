import { ComponentKey, EnvironmentKey, ProjectKey } from "@cluenori/foundation"
import { ComponentName, ProjectName } from "@cluenori/projects"
import { Console, Effect, Option, Redacted } from "effect"
import { Argument, Command, Flag } from "effect/cli"

import { apiClient, reachFailures, refuse } from "./api-client.ts"
import { apiTarget } from "./api-settings.ts"
import { componentLinksOf, deployTargetLines } from "./deploy-targets.ts"
import { local, parsed } from "./question.ts"

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
      })
      const target = yield* apiTarget(input.local)
      const client = yield* apiClient(target)
      const linked = yield* client.projects.linkComponent({ params: { project, component }, payload: links }).pipe(
        Effect.catchTags({
          ...reachFailures(target),
          ProjectNotFound: () => refuse(`${target.url} has no project ${project}.`),
          ComponentNotFound: () => refuse(`${project} has no component ${component}.`),
        }),
      )
      const targets = linked.deployTargets ?? []
      const repository = linked.repository === undefined ? ", with no repository" : ` to ${linked.repository}`
      yield* Console.log(`Linked ${linked.name} (${linked.key})${repository}.\n`)
      yield* Console.log(
        targets.length === 0
          ? "It has no deploy targets, so its releases can't be promoted from Cluenori: add them with --deploy, --testflight and --app-store."
          : `Its deploy targets:\n${deployTargetLines(targets)
              .map((line) => `  ${line}`)
              .join("\n")}`,
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

/** `cluenori project ...`. */
export const project = Command.make("project").pipe(
  Command.withDescription("Create projects, and choose their production environments."),
  Command.withSubcommands([projectCreate, projectSettings]),
)

/** `cluenori component ...`. */
export const component = Command.make("component").pipe(
  Command.withDescription(
    "Add components to projects, and link them to their repository and deploy targets: where their releases go.",
  ),
  Command.withSubcommands([componentAdd, componentLink]),
)
