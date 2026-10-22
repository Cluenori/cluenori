import { ComponentKey, ProjectKey } from "@cluenori/foundation"
import type { ComponentVersion } from "@cluenori/releases"
import { BuildNumber } from "@cluenori/releases"
import { Console, Effect, Option, Schema } from "effect"
import { Argument, Command, Flag } from "effect/cli"

import { apiClient, reachFailures, refuse } from "./api-client.ts"
import type { ApiTarget } from "./api-settings.ts"
import { apiTarget } from "./api-settings.ts"
import { local, optionalKey, parsed } from "./question.ts"
import { columns } from "./terminal-text.ts"
import { versionToSet, versionWantedOf } from "./version-bump.ts"

// The release a component's next new commit becomes: `1.4.0+58`.
const nextRelease = (line: ComponentVersion) => `${line.version}+${line.lastBuild + 1}`

const projectFailures = (target: ApiTarget, project: ProjectKey) => ({
  ...reachFailures(target),
  ProjectNotFound: () => refuse(`${target.url} has no project ${project}.`),
})

// Every component's version, or one's, with the components whose version was never set.
const showVersions = Effect.fn("showVersions")(function* (request: {
  readonly target: ApiTarget
  readonly project: ProjectKey
  readonly component: Option.Option<ComponentKey>
}) {
  const { target, project, component } = request
  const client = yield* apiClient(target)
  const versions = yield* client.releases
    .versions({ params: { project } })
    .pipe(Effect.catchTags(projectFailures(target, project)))
  const detail = yield* client.projects
    .project({ params: { project } })
    .pipe(Effect.catchTags(projectFailures(target, project)))
  const keys = detail.components
    .map((each) => each.key)
    .filter((key) => Option.match(component, { onNone: () => true, onSome: (one) => one === key }))
  if (Option.isSome(component) && keys.length === 0) {
    return yield* refuse(`${project} has no component ${component.value}.`)
  }
  if (keys.length === 0) {
    return yield* Console.log(
      `${project} has no components yet. Add one: ./cluenori component add ${project} <key> --name <name>`,
    )
  }
  const lines = keys.map((key) => versions.versions.find((line) => line.component === key))
  yield* Console.log(
    columns([
      ["Component", "Version", "Last build", "Next release"],
      ...keys.map((key, index) => {
        const line = lines[index]
        return line === undefined
          ? [key, "not set", "", ""]
          : [key, line.version, line.lastBuild === 0 ? "none" : `${line.lastBuild}`, nextRelease(line)]
      }),
    ]).join("\n"),
  )
  if (lines.includes(undefined)) {
    yield* Console.log(
      `\nA component's CI can't number its builds until its version is set: ./cluenori version ${project} <component> 1.0.0`,
    )
  }
  yield* Console.log(`\nRaise a version: ./cluenori version ${project} <component> patch, minor or major`)
})

// Sets a component's version, as wanted, and says what its next build is numbered.
const setVersion = Effect.fn("setVersion")(function* (request: {
  readonly target: ApiTarget
  readonly project: ProjectKey
  readonly component: ComponentKey
  readonly wanted: string
  readonly firstBuild: Option.Option<number>
}) {
  const { target, project, component } = request
  const wanted = yield* versionWantedOf(request.wanted)
  const firstBuild = yield* Option.match(request.firstBuild, {
    onNone: () => Effect.succeed(Option.none<BuildNumber>()),
    onSome: (number) =>
      Schema.decodeEffect(BuildNumber)(number).pipe(
        Effect.asSome,
        Effect.catchTag("SchemaError", (error) =>
          refuse(`--first-build ${number} isn't a build number: ${error.message}`),
        ),
      ),
  })
  const client = yield* apiClient(target)
  const versions = yield* client.releases
    .versions({ params: { project } })
    .pipe(Effect.catchTags(projectFailures(target, project)))
  const current = versions.versions.find((line) => line.component === component)
  const version = yield* versionToSet({ project, component, wanted, current: Option.fromUndefinedOr(current?.version) })
  const line = yield* client.releases
    .setVersion({
      params: { project, component },
      payload: {
        version,
        ...Option.match(firstBuild, { onNone: () => ({}), onSome: (number) => ({ firstBuild: number }) }),
      },
    })
    .pipe(
      Effect.catchTags({
        ...projectFailures(target, project),
        VersionRefused: (refused) => refuse(`Not set: ${refused.reason}.`),
      }),
    )
  const was = current === undefined || current.version === line.version ? "" : `, was ${current.version}`
  yield* Console.log(`${component} is ${line.version}${was}. Its next build is ${nextRelease(line)}.`)
  if (current !== undefined) {
    yield* Console.log("Commits numbered before keep their releases, so each number stays one commit.")
  }
})

/** `cluenori version <project> [<component>] [<version> | patch | minor | major] [--first-build N]`. */
export const version = Command.make(
  "version",
  {
    project: Argument.String("project").pipe(Argument.withDescription("The project's key.")),
    component: Argument.String("component").pipe(
      Argument.withDescription("The component's key, such as notes-api; without it, every component's version."),
      Argument.optional,
    ),
    version: Argument.String("version").pipe(
      Argument.withDescription(
        "The version to set, MAJOR.MINOR.PATCH such as 1.4.0, the same as now or higher; or patch, minor or major, to raise that part of the current one. Without it, the version is shown.",
      ),
      Argument.optional,
    ),
    firstBuild: Flag.Int("first-build").pipe(
      Flag.optional,
      Flag.withDescription(
        "With a version: the number of its next build, above the last given, such as for an app whose store builds were numbered before Cluenori numbered them.",
      ),
    ),
    local,
  },
  (input) =>
    Effect.gen(function* () {
      const project = yield* parsed(ProjectKey, input.project, "a project key")
      const component = yield* optionalKey(ComponentKey, input.component, "a component key")
      const target = yield* apiTarget(input.local)
      if (Option.isSome(component) && Option.isSome(input.version)) {
        return yield* setVersion({
          target,
          project,
          component: component.value,
          wanted: input.version.value,
          firstBuild: input.firstBuild,
        })
      }
      if (Option.isSome(input.firstBuild)) {
        return yield* refuse(
          `--first-build goes with a version: ./cluenori version ${project} <component> <version> --first-build ${input.firstBuild.value}`,
        )
      }
      return yield* showVersions({ target, project, component })
    }),
).pipe(
  Command.withDescription(
    "Show or set the version components' next builds are numbered in: each new commit their CI builds becomes the next release, such as 1.4.0+58, the same commit in every environment.",
  ),
)
