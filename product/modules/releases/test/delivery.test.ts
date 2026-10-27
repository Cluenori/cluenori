import type { AppStoreConnect, AppStoreVersion, Build } from "@bagatka/app-store-connect"
import { AppId, AppStoreVersionId, BuildId } from "@bagatka/app-store-connect"
import { sketchOf } from "@bagatka/quantile-sketch"
import type { Actor } from "@cluenori/foundation"
import { ComponentKey, EnvelopeName, EnvironmentKey, MemberId, ReleaseVersion } from "@cluenori/foundation"
import type { WorkflowRun } from "@cluenori/github"
import { CommitSha, GitHub, Repository, WorkflowFile } from "@cluenori/github"
import { BundleId, ComponentName, ProjectName, Projects } from "@cluenori/projects"
import type { OperationCounts } from "@cluenori/signals"
import { BatchDigest, Signals } from "@cluenori/signals"
import { assert, describe, it } from "@effect/vitest"
import { DateTime, Effect, Layer, Option } from "effect"
import { TestClock } from "effect/testing"

import type { Delivery } from "../src/index.ts"
import { ReleaseSources, releasesModule, SemanticVersion } from "../src/index.ts"
import { inProject, noModel, notConnected } from "./in-object.ts"

// 2026-10-21T10:00:00Z, on a minute.
const start = 1792576800000
const minute = 60_000
const hour = 60 * minute

const api = ComponentKey.make("notes-api")
const worker = ComponentKey.make("notes-worker")
const ios = ComponentKey.make("notes-ios")
const dev = EnvironmentKey.make("dev")
const prod = EnvironmentKey.make("prod")
const internal = EnvironmentKey.make("internal")
const production = EnvironmentKey.make("production")
const old = ReleaseVersion.make("2026.10.20-a1b2c3d")
const first = ReleaseVersion.make("1.0.0+1")
const member: Actor = { _tag: "Member", id: MemberId.make("0199f7a2-5c1e-7d3a-9b2f-4e8a1c6d0f53") }
const workflow = WorkflowFile.make("deploy.yml")
const shaOf = (digit: string) => CommitSha.make(digit.repeat(40))

const delivery = releasesModule.queries.delivery.run({})
const report = (component: ComponentKey, input: Parameters<typeof releasesModule.ingest.report.run>[1]) =>
  releasesModule.ingest.report.run(component, input)

// A next step, in words.
const stepText = (next: Delivery["components"][number]["environments"][number]["next"]) => {
  if (next === undefined) {
    return undefined
  }
  return next._tag === "promote" ? `promote ${next.release} from ${next.from}` : "build latest"
}

// What each environment of a component holds, and what can go there next, as plain words.
const stagesOf = (shown: Delivery, component: ComponentKey) =>
  (shown.components.find((each) => each.component === component)?.environments ?? []).map((stage) => [
    stage.environment,
    stage.current?.summary.release,
    stepText(stage.next),
    stage.promotion?.state,
  ])

let batches = 0
// `count` runs of GET /api/notes by `release` in `environment` in the minute starting at `at`.
const ran = (component: ComponentKey, release: ReleaseVersion, environment: EnvironmentKey, at: number) =>
  Effect.gen(function* () {
    const signals = yield* Signals
    batches += 1
    const counts: OperationCounts = {
      bucket: DateTime.makeUnsafe(at - (at % minute)),
      operation: EnvelopeName.make("GET /api/notes"),
      environment,
      release,
      count: 100,
      errors: 0,
      totalMs: 2000,
      durations: sketchOf(Array.from({ length: 100 }, () => 20)).sketch,
    }
    const now = yield* DateTime.now
    yield* signals.recordTraces(component, {
      digest: BatchDigest.make(batches.toString(16).padStart(64, "0")),
      archive: new Uint8Array(0),
      from: now,
      to: now,
      spans: 1,
      counts: [counts],
      kept: [],
      traces: [],
    })
  })

// GitHub that starts workflows, run 7, and tells of `run`, if any.
const gitHubWhoseRun = (run?: WorkflowRun) =>
  Layer.succeed(
    GitHub,
    GitHub.of({
      tagsContaining: () => Effect.succeed([]),
      commit: () => Effect.succeedNone,
      compare: () => Effect.die("No comparison in these tests"),
      pullRequest: () => Effect.succeedNone,
      defaultBranch: () => Effect.succeed("main"),
      dispatchWorkflow: () => Effect.succeedSome({ id: 7, url: "https://github.com/notes/notes-api/actions/runs/7" }),
      workflowRuns: () => Effect.succeed(run === undefined ? [] : [run]),
      workflowRun: () => Effect.succeed(Option.fromNullishOr(run)),
      selfHostedRunners: () => Effect.succeed([]),
      setActionsSecret: () => Effect.die("No secret is written in these tests"),
      deleteActionsSecret: () => Effect.die("No secret is written in these tests"),
      publishRelease: () => Effect.die("No release is published in these tests"),
    }),
  )
const startingGitHub = gitHubWhoseRun()

const withSources = (github: Layer.Layer<GitHub>, appStore?: AppStoreConnect["Service"]) =>
  Layer.mergeAll(
    Layer.succeed(
      ReleaseSources,
      ReleaseSources.of({ appStoreConnect: Option.fromNullishOr(appStore), appStoreConnectManager: Option.none() }),
    ),
    github,
    noModel,
  )

describe("Delivery", () => {
  it.effect("shows what each environment runs, and promotes what the one before has that's newer", () =>
    inProject(
      "delivery",
      start,
      Effect.gen(function* () {
        const projects = yield* Projects
        yield* projects.create(member, ProjectName.make("Notes"))
        yield* projects.addComponent(member, { key: api, name: ComponentName.make("Notes API") })
        yield* projects.linkComponent(member, api, {
          repository: Repository.make("notes/notes-api"),
          deployTargets: [
            { environment: dev, workflow },
            { environment: prod, workflow },
          ],
        })
        yield* releasesModule.actions.setVersion.run(member, { component: api, version: SemanticVersion.make("1.0.0") })
        // Prod runs a release from before Cluenori numbered them; dev gets 1.0.0+1.
        yield* ran(api, old, prod, start - 2 * hour)
        yield* report(api, { release: first, environment: dev, commit: shaOf("b") })
        const before = yield* delivery

        yield* releasesModule.actions.promote.run(member, { component: api, release: first, environment: prod })
        const promoting = yield* delivery

        yield* TestClock.setTime(start + hour)
        yield* report(api, { release: first, environment: prod, commit: shaOf("b") })
        const promoted = yield* delivery

        // Rolled back: the old release deployed to prod again.
        yield* TestClock.setTime(start + 2 * hour)
        yield* report(api, { release: old, environment: prod, commit: shaOf("a") })
        const rolledBack = yield* delivery

        assert.deepStrictEqual(stagesOf(before, api), [
          [dev, first, "build latest", undefined],
          [prod, old, `promote ${first} from ${dev}`, undefined],
        ])
        assert.strictEqual(
          DateTime.toEpochMillis(before.components[0]?.environments[1]?.current?.since ?? DateTime.makeUnsafe(0)),
          start - 2 * hour,
        )
        assert.deepInclude(before.components[0]?.version, { version: SemanticVersion.make("1.0.0"), lastBuild: 0 })
        // While a promotion to prod hasn't ended, nothing more can go there.
        assert.deepStrictEqual(stagesOf(promoting, api)[1], [prod, old, undefined, "starting"])
        // Deployed: prod runs it, while its promotion, followed in the background, hasn't ended yet.
        assert.deepStrictEqual(stagesOf(promoted, api), [
          [dev, first, "build latest", undefined],
          [prod, first, undefined, "starting"],
        ])
        // Deployed again last, the old release is the one prod runs.
        assert.deepStrictEqual(stagesOf(rolledBack, api)[1], [prod, old, undefined, "starting"])
      }),
      withSources(startingGitHub),
    ),
  )

  it.effect("keeps a promotion that failed on its environment, and offers the step again", () =>
    inProject(
      "delivery-failed",
      start,
      Effect.gen(function* () {
        const projects = yield* Projects
        yield* projects.create(member, ProjectName.make("Notes"))
        yield* projects.addComponent(member, { key: api, name: ComponentName.make("Notes API") })
        yield* projects.linkComponent(member, api, {
          repository: Repository.make("notes/notes-api"),
          deployTargets: [
            { environment: dev, workflow },
            { environment: prod, workflow },
          ],
        })
        yield* ran(api, old, prod, start - 2 * hour)
        yield* report(api, { release: first, environment: dev, commit: shaOf("b") })
        yield* releasesModule.actions.promote.run(member, { component: api, release: first, environment: prod })
        yield* TestClock.setTime(start + 5 * minute)
        yield* releasesModule.background ?? Effect.void
        const failed = yield* delivery
        // Deployed after all, as by trying again: the failure is behind it.
        yield* TestClock.setTime(start + hour)
        yield* report(api, { release: first, environment: prod, commit: shaOf("b") })
        const deployed = yield* delivery

        const prodStage = failed.components[0]?.environments[1]
        assert.strictEqual(prodStage?.failedPromotion?.state, "failed")
        assert.strictEqual(stepText(prodStage?.next), `promote ${first} from ${dev}`)
        assert.isUndefined(prodStage?.promotion)
        assert.isUndefined(deployed.components[0]?.environments[1]?.failedPromotion)
      }),
      withSources(
        gitHubWhoseRun({
          id: 7,
          status: "completed",
          conclusion: "failure",
          createdAt: DateTime.makeUnsafe(start + 5_000),
          updatedAt: DateTime.makeUnsafe(start + 3 * minute),
          url: "https://github.com/notes/notes-api/actions/runs/7",
          displayTitle: "Deploy",
        }),
      ),
    ),
  )

  it.effect("shows a component without deploy targets where it runs, with nothing to do", () =>
    inProject(
      "delivery-untargeted",
      start,
      Effect.gen(function* () {
        const projects = yield* Projects
        yield* projects.create(member, ProjectName.make("Notes"))
        yield* projects.addComponent(member, { key: worker, name: ComponentName.make("Notes worker") })
        yield* ran(worker, first, prod, start - hour)
        yield* ran(worker, first, dev, start - 2 * hour)
        const shown = yield* delivery

        assert.deepStrictEqual(stagesOf(shown, worker), [
          [dev, first, undefined, undefined],
          [prod, first, undefined, undefined],
        ])
        assert.isUndefined(shown.components[0]?.environments[0]?.target)
      }),
      withSources(notConnected),
    ),
  )

  it.effect("has an app's TestFlight build in testing, and on the App Store the one out there", () => {
    const build = (buildNumber: string, hoursAgo: number): Build => ({
      id: BuildId.make(`build-${buildNumber}`),
      platform: "IOS",
      version: "0.3.0",
      buildNumber,
      uploadedAt: DateTime.makeUnsafe(start - hoursAgo * hour),
      processingState: "VALID",
      expired: false,
      internalTesting: "IN_BETA_TESTING",
    })
    const appStore: AppStoreConnect["Service"] = {
      app: (bundleId) =>
        Effect.succeedSome({
          id: AppId.make(bundleId === "com.example.notes" ? "1574205213" : "1574205214"),
          name: "Notes",
          bundleId,
        }),
      builds: (appId) => Effect.succeed(appId === "1574205213" ? [build("19", 30)] : [build("20", 2), build("19", 30)]),
      appStoreVersions: (appId) =>
        Effect.succeed(
          appId === "1574205213"
            ? [
                {
                  id: AppStoreVersionId.make("version-1"),
                  platform: "IOS",
                  version: "0.3.0",
                  state: "READY_FOR_SALE",
                  createdAt: DateTime.makeUnsafe(start - 30 * hour),
                  buildNumber: "19",
                } satisfies AppStoreVersion,
              ]
            : [],
        ),
      appLocales: () => Effect.succeed(["en-US"]),
      build: () => Effect.succeedNone,
      prepareVersion: () => Effect.die("Nothing is submitted in these tests"),
      submitForReview: () => Effect.die("Nothing is submitted in these tests"),
      releaseVersion: () => Effect.die("Nothing is released in these tests"),
      setPhasedRelease: () => Effect.die("Nothing is released in these tests"),
      setWhatToTest: () => Effect.die("Nothing is tested in these tests"),
    }
    return inProject(
      "delivery-app",
      start,
      Effect.gen(function* () {
        const projects = yield* Projects
        yield* projects.create(member, ProjectName.make("Notes"))
        yield* projects.addComponent(member, { key: ios, name: ComponentName.make("Notes") })
        yield* projects.linkComponent(member, ios, {
          repository: Repository.make("notes/notes-ios"),
          deployTargets: [
            {
              environment: internal,
              workflow: WorkflowFile.make("ios.yml"),
              appStore: { bundleId: BundleId.make("com.example.notes.internal"), distribution: "testFlight" },
            },
            {
              environment: production,
              workflow: WorkflowFile.make("ios.yml"),
              appStore: { bundleId: BundleId.make("com.example.notes"), distribution: "appStore" },
            },
          ],
        })
        yield* releasesModule.background ?? Effect.void
        const shown = yield* delivery

        assert.deepStrictEqual(stagesOf(shown, ios), [
          [internal, ReleaseVersion.make("0.3.0+20"), "build latest", undefined],
          [production, ReleaseVersion.make("0.3.0+19"), "promote 0.3.0+20 from internal", undefined],
        ])
      }),
      withSources(notConnected, appStore),
    )
  })
})
