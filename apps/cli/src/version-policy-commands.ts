import { ComponentKey, ProjectKey } from "@cluenori/foundation"
import type { ComponentVersionPolicy } from "@cluenori/releases"
import { compareStoreVersions, VersionPolicyTo } from "@cluenori/releases"
import { Console, Effect, Option, Schema } from "effect"
import { Argument, Command, Flag } from "effect/cli"

import { apiClient, reachFailures, refuse } from "./api-client.ts"
import type { ApiTarget } from "./api-settings.ts"
import { apiTarget } from "./api-settings.ts"
import { local, parsed } from "./question.ts"
import { columns, utcMinute } from "./terminal-text.ts"

// The component whose policy a command reads or changes, and where it asks.
interface PolicyOf {
  readonly target: ApiTarget
  readonly project: ProjectKey
  readonly component: ComponentKey
}

const policyFailures = (of: PolicyOf) => ({
  ...reachFailures(of.target),
  ProjectNotFound: () => refuse(`${of.target.url} has no project ${of.project}.`),
})

// What the options change: each given one, as typed text.
interface Changes {
  readonly minimum: Option.Option<string>
  readonly recommended: Option.Option<string>
  readonly storeUrl: Option.Option<string>
  readonly minimumOs: Option.Option<string>
}

const pickedUp = "Apps pick it up within five minutes, when they next read their manifest."

// What releases get from a policy, in a sentence.
const effectOf = (policy: Pick<ComponentVersionPolicy, "minimum" | "recommended">) => {
  const { minimum, recommended } = policy
  if (minimum !== undefined && (recommended === undefined || compareStoreVersions(recommended, minimum) <= 0)) {
    return `Releases below ${minimum} must update, to ${recommended ?? minimum}, in production.`
  }
  if (minimum !== undefined && recommended !== undefined) {
    return `Releases below ${minimum} must update; below ${recommended} they're offered ${recommended}, in production.`
  }
  return recommended === undefined
    ? "Releases aren't asked to update."
    : `Releases below ${recommended} are offered ${recommended}, in production.`
}

// The component's policy, if it has one.
const currentPolicy = Effect.fn("currentPolicy")(function* (of: PolicyOf) {
  const client = yield* apiClient(of.target)
  const { policies } = yield* client.releases
    .versionPolicies({ params: { project: of.project } })
    .pipe(Effect.catchTags(policyFailures(of)))
  return Option.fromUndefinedOr(policies.find((policy) => policy.component === of.component))
})

const showPolicy = Effect.fn("showPolicy")(function* (of: PolicyOf) {
  const client = yield* apiClient(of.target)
  const detail = yield* client.projects
    .project({ params: { project: of.project } })
    .pipe(Effect.catchTags(policyFailures(of)))
  if (!detail.components.some((each) => each.key === of.component)) {
    return yield* refuse(`${of.project} has no component ${of.component}.`)
  }
  const current = yield* currentPolicy(of)
  if (Option.isNone(current)) {
    return yield* Console.log(
      [
        `${of.component} has no version policy: its releases are never asked to update.`,
        `Set one: ./cluenori version-policy ${of.project} ${of.component} --minimum 0.4.0 --recommended 0.4.1`,
      ].join("\n"),
    )
  }
  const policy = current.value
  yield* Console.log(
    [
      `${of.component}'s version policy, set ${utcMinute(policy.setAt)}:`,
      ...columns([
        ["  Minimum", policy.minimum ?? "none"],
        ["  Recommended", policy.recommended ?? "none"],
        ["  Store", policy.storeUrl],
        ["  Minimum OS", policy.minimumOsVersion ?? "unknown"],
      ]),
      "",
      effectOf(policy),
    ].join("\n"),
  )
  if (policy.words.length === 0) {
    return yield* Console.log("Apps show the SDK's own words: the project has written none.")
  }
  yield* Console.log(
    [
      "",
      ...columns([
        ["Words", "Language", "Title"],
        ...policy.words.map((words) => [words.decision, words.locale, words.text.title]),
      ]),
    ].join("\n"),
  )
})

// Changes only what the options say, keeping the rest, words included, as the API replaces it whole.
const changePolicy = Effect.fn("changePolicy")(function* (of: PolicyOf, changes: Changes) {
  const given = yield* Schema.decodeEffect(VersionPolicyTo)({
    ...Option.match(changes.minimum, { onNone: () => ({}), onSome: (minimum) => ({ minimum }) }),
    ...Option.match(changes.recommended, { onNone: () => ({}), onSome: (recommended) => ({ recommended }) }),
    ...Option.match(changes.storeUrl, { onNone: () => ({}), onSome: (storeUrl) => ({ storeUrl }) }),
    ...Option.match(changes.minimumOs, { onNone: () => ({}), onSome: (minimumOsVersion) => ({ minimumOsVersion }) }),
  }).pipe(Effect.catchTag("SchemaError", (error) => refuse(`Not set: ${error.message}`)))
  const current = yield* currentPolicy(of)
  const kept = Option.match(current, {
    onNone: () => ({}),
    onSome: (policy) => ({
      ...(policy.minimum === undefined ? {} : { minimum: policy.minimum }),
      ...(policy.recommended === undefined ? {} : { recommended: policy.recommended }),
      storeUrl: policy.storeUrl,
      ...(policy.minimumOsVersion === undefined ? {} : { minimumOsVersion: policy.minimumOsVersion }),
      words: policy.words,
    }),
  })
  const client = yield* apiClient(of.target)
  const policy = yield* client.releases
    .setVersionPolicy({ params: { project: of.project, component: of.component }, payload: { ...kept, ...given } })
    .pipe(
      Effect.catchTags({
        ...policyFailures(of),
        VersionPolicyRefused: (refused) => refuse(`Not set: ${refused.reason}.`),
      }),
    )
  const found = Option.isNone(current) && Option.isNone(changes.storeUrl) ? ` Its store page: ${policy.storeUrl}.` : ""
  yield* Console.log(`${effectOf(policy)}${found}\n${pickedUp}`)
})

const clearPolicy = Effect.fn("clearPolicy")(function* (of: PolicyOf) {
  const current = yield* currentPolicy(of)
  if (Option.isNone(current)) {
    return yield* Console.log(`${of.component} has no version policy; there is nothing to clear.`)
  }
  const client = yield* apiClient(of.target)
  yield* client.releases
    .clearVersionPolicy({ params: { project: of.project, component: of.component } })
    .pipe(Effect.catchTags(policyFailures(of)))
  yield* Console.log(`${of.component} has no version policy now: its releases aren't asked to update.\n${pickedUp}`)
})

const versionFlag = (name: string, description: string) =>
  Flag.String(name).pipe(Flag.optional, Flag.withDescription(description))

/**
 * `cluenori version-policy <project> <component> [--minimum V] [--recommended V] [--store-url URL]
 * [--minimum-os V] [--clear]`.
 */
export const versionPolicy = Command.make(
  "version-policy",
  {
    project: Argument.String("project").pipe(Argument.withDescription("The project's key.")),
    component: Argument.String("component").pipe(
      Argument.withDescription("The app's component key, such as notes-ios."),
    ),
    minimum: versionFlag(
      "minimum",
      "The oldest version people may keep, such as 0.4.0: releases below it must update before they can be used.",
    ),
    recommended: versionFlag(
      "recommended",
      "The version to offer, such as 0.4.1: releases below it are offered it in a sheet people can close.",
    ),
    storeUrl: versionFlag(
      "store-url",
      "Where to update from, an https URL; without it, the App Store page of the app the component's App Store deploy target names.",
    ),
    minimumOs: versionFlag(
      "minimum-os",
      "The oldest OS version the release to update to runs on, such as 26.0: devices below it aren't blocked.",
    ),
    clear: Flag.Boolean("clear").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Remove the policy: the component's releases are no longer asked to update."),
    ),
    local,
  },
  (input) =>
    Effect.gen(function* () {
      const project = yield* parsed(ProjectKey, input.project, "a project key")
      const component = yield* parsed(ComponentKey, input.component, "a component key")
      const target = yield* apiTarget(input.local)
      const of: PolicyOf = { target, project, component }
      const changes: Changes = {
        minimum: input.minimum,
        recommended: input.recommended,
        storeUrl: input.storeUrl,
        minimumOs: input.minimumOs,
      }
      const changing = Object.values(changes).some(Option.isSome)
      if (input.clear && changing) {
        return yield* refuse("--clear removes the whole policy, so it takes no other options.")
      }
      if (input.clear) {
        return yield* clearPolicy(of)
      }
      if (changing) {
        return yield* changePolicy(of, changes)
      }
      return yield* showPolicy(of)
    }),
).pipe(
  Command.withDescription(
    "Show or set an app component's version policy: which of its releases must update, and which are offered an update, in the project's production environments. Options change only what they name; the rest is kept.",
  ),
)
