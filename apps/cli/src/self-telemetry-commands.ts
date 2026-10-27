import { ComponentKey, ProjectKey } from "@cluenori/foundation"
import { ComponentName, ProjectName } from "@cluenori/projects"
import type { SdkKey } from "@cluenori/projects"
import { SemanticVersion } from "@cluenori/releases"
import { Console, Effect, Option } from "effect"
import { Command, Flag } from "effect/cli"

import { apiClient, reachFailures, refuse } from "./api-client.ts"
import { apiTarget, saveDeployment, savedDeployment } from "./api-settings.ts"
import { wrangler } from "./attached.ts"
import { setDeploymentSecrets } from "./deployment-secrets.ts"
import { accountOf, environmentFlags } from "./setup.ts"

// The deployment measures itself as an ordinary project: its Worker, the backend, by its ingest
// key; its dashboard and this CLI, apps, by their SDK keys, which ship with the Worker. Its iPhone
// app has its own SDK key, in apps/ios/Config/Local.xcconfig, issued with `component sdk-keys`.

const worker = ComponentKey.make("worker")
const dashboard = ComponentKey.make("dashboard")
const cli = ComponentKey.make("cli")

const components = [
  { key: worker, name: ComponentName.make("Worker") },
  { key: dashboard, name: ComponentName.make("Dashboard") },
  { key: cli, name: ComponentName.make("CLI") },
] as const

// The Worker secrets that turn it on: its own ingest key, and its clients' SDK keys.
const secretNames = ["CLUENORI_SELF_INGEST_KEY", "CLUENORI_DASHBOARD_SDK_KEY", "CLUENORI_CLI_SDK_KEY"] as const

const projectFlag = Flag.String("project").pipe(
  Flag.withDefault("cluenori"),
  Flag.withDescription("The project the deployment reports itself in; made when it doesn't exist."),
)

/** `cluenori self-telemetry on [--project cluenori]`. */
const selfTelemetryOn = Command.make("on", { project: projectFlag }, (input) =>
  Effect.gen(function* () {
    const saved = yield* savedDeployment
    if (Option.isNone(saved)) {
      return yield* refuse("No deployment is saved on this computer: run ./setup first.")
    }
    const project = ProjectKey.make(input.project)
    const target = yield* apiTarget(false)
    const client = yield* apiClient(target)
    const failures = {
      ...reachFailures(target),
      ProjectNotFound: () => refuse(`${target.url} has no project ${project}.`),
    }

    const existing = yield* client.projects.project({ params: { project } }).pipe(
      Effect.asSome,
      Effect.catchTag("ProjectNotFound", () => Effect.succeedNone),
      Effect.catchTags(reachFailures(target)),
    )
    if (Option.isNone(existing)) {
      yield* client.projects
        .createProject({ payload: { key: project, name: ProjectName.make("Cluenori") } })
        .pipe(Effect.catchTags({ ...reachFailures(target), ProjectExists: () => Effect.void }))
      yield* Console.log(`Created the project ${project}.`)
    }
    const known = Option.match(existing, { onNone: () => [], onSome: (detail) => detail.components })
    const has = (key: ComponentKey) => known.some((component) => component.key === key)

    // The Worker's ingest key is shown only when it is added: kept here, and given to the Worker.
    const savedKey = saved.value.selfTelemetry?.project === project ? saved.value.selfTelemetry.ingestKey : undefined
    const added = yield* Effect.forEach(
      components.filter((component) => !has(component.key)),
      (component) =>
        client.projects.addComponent({ params: { project }, payload: component }).pipe(
          Effect.catchTags({ ...failures, ComponentExists: () => refuse(`${component.key} exists.`) }),
          Effect.tap(() => Console.log(`Added ${component.key} to ${project}.`)),
        ),
    )
    const ingestKey = added.find((each) => each.component.key === worker)?.ingestKey ?? savedKey
    if (ingestKey === undefined) {
      return yield* refuse(
        `${project} has a worker component whose ingest key this computer doesn't have; turn it off on the computer that turned it on, or use another --project.`,
      )
    }
    // Saved at once, so a failure below never loses the key, which is shown only once.
    yield* saveDeployment({ ...saved.value, selfTelemetry: { project, ingestKey } })

    // The dashboard and the CLI ship with the Worker: one commit, one release, one deploy.
    for (const app of [dashboard, cli]) {
      yield* client.projects
        .linkComponent({ params: { project, component: app }, payload: { shipsWith: worker } })
        .pipe(Effect.catchTags({ ...failures, ComponentNotFound: () => refuse(`${project} has no ${app}.`) }))
    }
    // The Worker's builds are numbered by its version, as any component's CI numbers them.
    const versions = yield* client.releases.versions({ params: { project } }).pipe(Effect.catchTags(failures))
    if (!versions.versions.some((each) => each.component === worker)) {
      yield* client.releases
        .setVersion({ params: { project, component: worker }, payload: { version: SemanticVersion.make("0.1.0") } })
        .pipe(Effect.catchTags({ ...failures, VersionRefused: (refused) => refuse(refused.reason) }))
    }

    const keyOf = Effect.fn("keyOf")(function* (component: ComponentKey) {
      const list = yield* client.projects
        .sdkKeys({ params: { project, component } })
        .pipe(Effect.catchTags({ ...failures, ComponentNotFound: () => refuse(`${project} has no ${component}.`) }))
      const active = list.keys.find((key) => key.revokedAt === undefined)
      if (active !== undefined) {
        return active.key
      }
      const issued = yield* client.projects
        .issueSdkKey({ params: { project, component } })
        .pipe(Effect.catchTags({ ...failures, ComponentNotFound: () => refuse(`${project} has no ${component}.`) }))
      return issued.key
    })
    const dashboardKey: SdkKey = yield* keyOf(dashboard)
    const cliKey: SdkKey = yield* keyOf(cli)
    yield* setDeploymentSecrets({
      CLUENORI_SELF_INGEST_KEY: ingestKey,
      CLUENORI_DASHBOARD_SDK_KEY: dashboardKey,
      CLUENORI_CLI_SDK_KEY: cliKey,
    })
    yield* Console.log(
      `\n${target.url} now reports itself in ${project}: the Worker's requests, jobs, warnings and errors as ${worker}, the dashboard as ${dashboard} and this CLI as ${cli}.`,
    )
    yield* Console.log(
      "Receiving telemetry makes none of its own but a count a minute. ./update numbers and reports each deploy.",
    )
  }),
).pipe(
  Command.withDescription(
    "Have the deployment measure itself, as a project of its own: its Worker, its dashboard and this CLI.",
  ),
)

/** `cluenori self-telemetry off`. */
const selfTelemetryOff = Command.make("off", {}, () =>
  Effect.gen(function* () {
    const saved = yield* savedDeployment
    if (Option.isNone(saved)) {
      return yield* refuse("No deployment is saved on this computer: run ./setup first.")
    }
    const account = yield* accountOf(saved.value)
    for (const name of secretNames) {
      yield* wrangler(["secret", "delete", name, ...environmentFlags(saved.value.jurisdiction)], { account }).pipe(
        Effect.catchTag("CommandFailed", () => Effect.void),
      )
    }
    const { selfTelemetry: _off, ...rest } = saved.value
    yield* saveDeployment(rest)
    yield* Console.log("The deployment no longer measures itself; what it sent stays in its project.")
  }),
).pipe(Command.withDescription("Stop the deployment measuring itself; what it sent is kept."))

/** `cluenori self-telemetry on|off`. */
export const selfTelemetry = Command.make("self-telemetry").pipe(
  Command.withDescription(
    "Have the deployment measure itself with itself, as a project of its own, or stop it. Self-hosted or not, the same switch.",
  ),
  Command.withSubcommands([selfTelemetryOn, selfTelemetryOff]),
)
