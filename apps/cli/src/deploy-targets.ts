import { EnvironmentKey } from "@cluenori/foundation"
import { Repository, WorkflowFile } from "@cluenori/github"
import type { AppStoreTarget, DeployTarget } from "@cluenori/projects"
import { BundleId, ComponentLinks } from "@cluenori/projects"
import { Effect, Option, Schema } from "effect"

import { refuse } from "./api-client.ts"
import { optionalKey, parsed } from "./question.ts"

/**
 * What `component link` was given: its repository, and each `--deploy`, `--testflight` and
 * `--app-store`, as `<environment>=<workflow file>` or `<environment>=<bundle ID>`.
 */
export interface LinkOptions {
  readonly repository: Option.Option<string>
  readonly deploy: ReadonlyArray<string>
  readonly testFlight: ReadonlyArray<string>
  readonly appStore: ReadonlyArray<string>
  /** The component it is deployed with, by that one's deploy targets. */
  readonly shipsWith?: Option.Option<string>
}

// The flag a value came with, and an example of one, for a refusal.
const examples = {
  deploy: "production=deploy.yml",
  testflight: "beta=com.example.notes.beta",
  "app-store": "production=com.example.notes",
}
type LinkFlag = keyof typeof examples

// `production=deploy.yml`: an environment, and the text after the first `=`.
const pairOf = Effect.fn("pairOf")(function* (flag: LinkFlag, text: string) {
  const separator = text.indexOf("=")
  if (separator === -1) {
    return yield* refuse(`--${flag} ${text} isn't <environment>=<…>, such as --${flag} ${examples[flag]}.`)
  }
  const environment = yield* parsed(EnvironmentKey, text.slice(0, separator), "an environment key")
  return { environment, value: text.slice(separator + 1) }
})

const workflowOf = Effect.fn("workflowOf")(function* (text: string) {
  const pair = yield* pairOf("deploy", text)
  const workflow = yield* parsed(WorkflowFile, pair.value, "a workflow's file name")
  return { environment: pair.environment, workflow }
})

const appOf = Effect.fn("appOf")(function* (flag: "testflight" | "app-store", text: string) {
  const pair = yield* pairOf(flag, text)
  const bundleId = yield* parsed(BundleId, pair.value, "a bundle ID")
  const appStore: AppStoreTarget = { bundleId, distribution: flag === "testflight" ? "testFlight" : "appStore" }
  return { environment: pair.environment, appStore }
})

// The first item that names an environment an item before it named.
const secondFor = <A extends { readonly environment: EnvironmentKey }>(items: ReadonlyArray<A>) =>
  items.find((item, index) => items.findIndex((other) => other.environment === item.environment) !== index)

/**
 * The component links `options` say: the repository, and one deploy target for each environment
 * they name, with its workflow, its App Store Connect app, or both, in the order the environments
 * first appear in `--deploy`, then `--testflight`, then `--app-store`. Refuses, saying why, a value
 * that isn't `<environment>=<…>`, a key, workflow file or bundle ID its Schema refuses, two
 * workflows or two apps for one environment, a workflow without a repository, and more than 20
 * environments.
 */
export const componentLinksOf = Effect.fn("componentLinksOf")(function* (options: LinkOptions) {
  const repository = yield* optionalKey(Repository, options.repository, "a repository, owner/name")
  const workflows = yield* Effect.forEach(options.deploy, workflowOf)
  const testFlightApps = yield* Effect.forEach(options.testFlight, (text) => appOf("testflight", text))
  const appStoreApps = yield* Effect.forEach(options.appStore, (text) => appOf("app-store", text))
  const apps = [...testFlightApps, ...appStoreApps]
  const secondWorkflow = secondFor(workflows)
  if (secondWorkflow !== undefined) {
    return yield* refuse(
      `${secondWorkflow.environment} has two workflows: give each environment one --deploy, as each has one deploy target.`,
    )
  }
  const secondApp = secondFor(apps)
  if (secondApp !== undefined) {
    return yield* refuse(
      `${secondApp.environment} has two apps: give each environment one --testflight or --app-store, as each has one deploy target.`,
    )
  }
  if (workflows.length > 0 && Option.isNone(repository)) {
    return yield* refuse(
      "Deploy workflows run in the component's repository: link it too, with --repository owner/name.",
    )
  }
  const environments = [...new Set([...workflows, ...apps].map((each) => each.environment))]
  const deployTargets = environments.map((environment) => {
    const workflow = workflows.find((each) => each.environment === environment)?.workflow
    const appStore = apps.find((each) => each.environment === environment)?.appStore
    const target: DeployTarget = {
      environment,
      ...(workflow === undefined ? {} : { workflow }),
      ...(appStore === undefined ? {} : { appStore }),
    }
    return target
  })
  const links = {
    ...Option.match(repository, { onNone: () => ({}), onSome: (value) => ({ repository: value }) }),
    ...(deployTargets.length === 0 ? {} : { deployTargets }),
    ...Option.match(options.shipsWith ?? Option.none(), {
      onNone: () => ({}),
      onSome: (shipsWith) => ({ shipsWith }),
    }),
  }
  // The Schema is the authority on what links may be saved, such as at most 20 deploy targets.
  return yield* Schema.decodeEffect(ComponentLinks)(links).pipe(
    Effect.catchTag("SchemaError", (error) => refuse(`Those links can't be saved: ${error.message}`)),
  )
})

// Where an environment's builds go in App Store Connect, in words.
const appText = (app: AppStoreTarget) => {
  switch (app.distribution) {
    case "testFlight":
      return `${app.bundleId} in TestFlight`
    case "appStore":
      return `${app.bundleId} on the App Store`
  }
}

/**
 * A component's deploy targets, a line for each environment: the workflow that deploys there, then
 * the App Store Connect app its builds go to, such as
 * `beta        ios.yml, then com.notesapp.notes.beta in TestFlight`.
 */
export const deployTargetLines = (targets: ReadonlyArray<DeployTarget>) => {
  const width = Math.max(...targets.map((target) => target.environment.length))
  return targets.map((target) => {
    const steps = [
      ...(target.workflow === undefined ? [] : [target.workflow]),
      ...(target.appStore === undefined ? [] : [appText(target.appStore)]),
    ]
    return `${target.environment.padEnd(width)}  ${steps.join(", then ")}`
  })
}
