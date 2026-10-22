import { ComponentLinks } from "@cluenori/projects"
import { assert, describe, it } from "@effect/vitest"
import { Effect, Option, Schema } from "effect"

import { componentLinksOf, deployTargetLines } from "../src/deploy-targets.ts"
import type { LinkOptions } from "../src/deploy-targets.ts"

const none: LinkOptions = { repository: Option.none(), deploy: [], testFlight: [], appStore: [] }

// a notes app's app: three environments, each with its workflow and the app its builds go to.
const notesIos: LinkOptions = {
  repository: Option.some("notesapp/notes-ios"),
  deploy: ["internal=ios.yml", "beta=ios.yml", "production=ios.yml"],
  testFlight: ["internal=com.notesapp.notes.internal", "beta=com.notesapp.notes.beta"],
  appStore: ["production=com.notesapp.notes"],
}

// The links as plain data, as the API is sent them.
const linksOf = (options: LinkOptions) =>
  componentLinksOf(options).pipe(Effect.flatMap(Schema.encodeEffect(ComponentLinks)))

// What a refusal said.
const refusalOf = (options: LinkOptions) =>
  componentLinksOf(options).pipe(
    Effect.flip,
    Effect.map((refused) => refused.message),
  )

describe("componentLinksOf", () => {
  it.effect("merges a workflow and an app into one deploy target for each environment", () =>
    Effect.gen(function* () {
      const links = yield* linksOf(notesIos)
      assert.deepStrictEqual(links, {
        repository: "notesapp/notes-ios",
        deployTargets: [
          {
            environment: "internal",
            workflow: "ios.yml",
            appStore: { bundleId: "com.notesapp.notes.internal", distribution: "testFlight" },
          },
          {
            environment: "beta",
            workflow: "ios.yml",
            appStore: { bundleId: "com.notesapp.notes.beta", distribution: "testFlight" },
          },
          {
            environment: "production",
            workflow: "ios.yml",
            appStore: { bundleId: "com.notesapp.notes", distribution: "appStore" },
          },
        ],
      })
    }),
  )

  it.effect("keeps a workflow without an app, and an app without a workflow or a repository", () =>
    Effect.gen(function* () {
      const service = yield* linksOf({
        ...none,
        repository: Option.some("notesapp/notes-api"),
        deploy: ["dev=deploy.yml", "prod=deploy.yml"],
      })
      assert.deepStrictEqual(service.deployTargets, [
        { environment: "dev", workflow: "deploy.yml" },
        { environment: "prod", workflow: "deploy.yml" },
      ])
      const app = yield* linksOf({ ...none, appStore: ["production=com.notesapp.notes"] })
      assert.deepStrictEqual(app, {
        deployTargets: [
          { environment: "production", appStore: { bundleId: "com.notesapp.notes", distribution: "appStore" } },
        ],
      })
    }),
  )

  it.effect("links nothing when no option is given, which unlinks", () =>
    Effect.gen(function* () {
      const links = yield* linksOf(none)
      assert.deepStrictEqual(links, {})
    }),
  )

  it.effect("refuses a value without an environment", () =>
    Effect.gen(function* () {
      const refusal = yield* refusalOf({ ...none, repository: Option.some("a/b"), deploy: ["ios.yml"] })
      assert.strictEqual(refusal, "--deploy ios.yml isn't <environment>=<…>, such as --deploy production=deploy.yml.")
    }),
  )

  it.effect("refuses two workflows for one environment", () =>
    Effect.gen(function* () {
      const refusal = yield* refusalOf({
        ...none,
        repository: Option.some("a/b"),
        deploy: ["prod=deploy.yml", "prod=other.yml"],
      })
      assert.strictEqual(
        refusal,
        "prod has two workflows: give each environment one --deploy, as each has one deploy target.",
      )
    }),
  )

  it.effect("refuses two apps for one environment, even one for TestFlight and one for the App Store", () =>
    Effect.gen(function* () {
      const refusal = yield* refusalOf({
        ...none,
        testFlight: ["beta=com.notesapp.notes.beta"],
        appStore: ["beta=com.notesapp.notes"],
      })
      assert.strictEqual(
        refusal,
        "beta has two apps: give each environment one --testflight or --app-store, as each has one deploy target.",
      )
    }),
  )

  it.effect("refuses a workflow without the repository it runs in", () =>
    Effect.gen(function* () {
      const refusal = yield* refusalOf({ ...none, deploy: ["prod=deploy.yml"] })
      assert.strictEqual(
        refusal,
        "Deploy workflows run in the component's repository: link it too, with --repository owner/name.",
      )
    }),
  )

  it.effect("refuses what the Schemas refuse, saying their rule", () =>
    Effect.gen(function* () {
      const environment = yield* refusalOf({ ...none, appStore: ["Production=com.notesapp.notes"] })
      assert.match(environment, /^"Production" isn't an environment key: Expected lowercase/)
      const bundle = yield* refusalOf({ ...none, testFlight: ["beta=live notes"] })
      assert.match(bundle, /^"live notes" isn't a bundle ID: Expected letters, digits/)
      const workflow = yield* refusalOf({ ...none, repository: Option.some("a/b"), deploy: ["prod=deploy.txt"] })
      assert.match(workflow, /^"deploy.txt" isn't a workflow's file name: /)
    }),
  )

  it.effect("refuses more than 20 environments, as the links' Schema does", () =>
    Effect.gen(function* () {
      const many = Array.from({ length: 21 }, (_, index) => `env-${index + 1}=com.example.app`)
      const refusal = yield* refusalOf({ ...none, testFlight: many })
      assert.match(refusal, /^Those links can't be saved: /)
    }),
  )
})

describe("deployTargetLines", () => {
  it.effect("says each environment's workflow, then its app, aligned", () =>
    Effect.gen(function* () {
      const links = yield* componentLinksOf({ ...notesIos, deploy: ["internal=ios.yml", "beta=ios.yml"] })
      assert.deepStrictEqual(deployTargetLines(links.deployTargets ?? []), [
        "internal    ios.yml, then com.notesapp.notes.internal in TestFlight",
        "beta        ios.yml, then com.notesapp.notes.beta in TestFlight",
        "production  com.notesapp.notes on the App Store",
      ])
    }),
  )
})
