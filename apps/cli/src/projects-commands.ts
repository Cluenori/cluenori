import { ComponentKey, ProjectKey } from "@cluenori/foundation"
import { ComponentName, ProjectName } from "@cluenori/projects"
import { Console, Effect, Redacted, Schema } from "effect"
import { Argument, Command, Flag } from "effect/cli"

import { apiClient, reachFailures, refuse } from "./api-client.ts"
import { apiTarget } from "./api-settings.ts"

const local = Flag.Boolean("local").pipe(
  Flag.withDescription("Ask the Cluenori ./run serves on this computer, not the deployment ./setup made."),
)

// Values from the command line become typed once, here; a refusal says the rule.
const parsed = <S extends Schema.Top & { readonly DecodingServices: never }>(schema: S, value: string, what: string) =>
  Schema.decodeEffect(schema)(value).pipe(
    Effect.catchTag("SchemaError", (error) => refuse(`"${value}" isn't ${what}: ${error.message}`)),
  )

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

/** `cluenori project ...`. */
export const project = Command.make("project").pipe(
  Command.withDescription("Create projects."),
  Command.withSubcommands([projectCreate]),
)

/** `cluenori component ...`. */
export const component = Command.make("component").pipe(
  Command.withDescription("Add components to projects."),
  Command.withSubcommands([componentAdd]),
)
