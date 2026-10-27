import type { AppStoreConnect, AppStoreVersion } from "@bagatka/app-store-connect"
import { AppId, AppStoreVersionId, BuildId, ReviewSubmissionId } from "@bagatka/app-store-connect"
import type { Actor } from "@cluenori/foundation"
import { ActivityLog, ComponentKey, EnvironmentKey, MemberId, ProcessName, ReleaseVersion } from "@cluenori/foundation"
import type { WorkflowRun } from "@cluenori/github"
import { CommitSha, GitHub, Repository, WorkflowFile, WorkflowNotFound } from "@cluenori/github"
import { BundleId, ComponentName, ProjectName, Projects } from "@cluenori/projects"
import { assert, describe, it } from "@effect/vitest"
import { DateTime, Effect, Layer, Option } from "effect"
import { TestClock } from "effect/testing"

import { NoteLocale, NoteText, PromotionReason, ReleaseSources, releasesModule, SemanticVersion } from "../src/index.ts"
import { inProject, noModel } from "./in-object.ts"

// 2026-10-21T10:00:00Z, on a minute.
const start = 1792576800000
const minute = 60_000

const api = ComponentKey.make("notes-api")
const production = EnvironmentKey.make("production")
const dev = EnvironmentKey.make("dev")
const release = ReleaseVersion.make("2026.10.21-e91f09c")
const repository = Repository.make("notes/notes-api")
const workflow = WorkflowFile.make("promote-to-prod.yml")
const member: Actor = { _tag: "Member", id: MemberId.make("0199f7a2-5c1e-7d3a-9b2f-4e8a1c6d0f53") }

// The project, with the API linked to its repository and its workflow for production, and the
// release deployed to dev.
const project = Effect.gen(function* () {
  const projects = yield* Projects
  yield* projects.create(member, ProjectName.make("Notes"))
  yield* projects.addComponent(member, { key: api, name: ComponentName.make("Notes API") })
  yield* projects.linkComponent(member, api, {
    repository,
    deployTargets: [{ environment: production, workflow }],
  })
  yield* releasesModule.ingest.report.run(api, { release, environment: dev, commit: CommitSha.make("b".repeat(40)) })
})

const promote = (environment: EnvironmentKey, reason?: string) =>
  releasesModule.actions.promote.run(member, {
    component: api,
    release,
    environment,
    ...(reason === undefined ? {} : { reason: PromotionReason.make(reason) }),
  })

const follow = releasesModule.background ?? Effect.void

const runOf = (id: number, status: WorkflowRun["status"], conclusion?: string): WorkflowRun => ({
  id,
  status,
  ...(conclusion === undefined ? {} : { conclusion }),
  createdAt: DateTime.makeUnsafe(start + 5_000),
  updatedAt: DateTime.makeUnsafe(start + 3 * minute),
  url: `https://github.com/notes/notes-api/actions/runs/${id}`,
  displayTitle: "Promote to production",
})

// What the fake GitHub was asked to start, and the runs it has now.
interface FakeState {
  readonly dispatched: Array<{ readonly workflow: string; readonly ref: string; readonly inputs: object }>
  runs: ReadonlyArray<WorkflowRun>
}

// GitHub that starts workflows, naming the run when `named`, and answers about runs as `runs` says now.
const fakeGitHub = (state: FakeState, named: boolean): GitHub["Service"] => ({
  tagsContaining: () => Effect.succeed([]),
  commit: () => Effect.succeedNone,
  compare: () => Effect.die("No comparison in these tests"),
  pullRequest: () => Effect.succeedNone,
  defaultBranch: () => Effect.succeed("main"),
  dispatchWorkflow: (_repository, file, ref, inputs) =>
    Effect.sync(() => {
      state.dispatched.push({ workflow: file, ref, inputs })
      return named ? Option.some({ id: 7, url: "https://github.com/notes/notes-api/actions/runs/7" }) : Option.none()
    }),
  workflowRuns: () => Effect.sync(() => state.runs),
  workflowRun: (_repository, id) => Effect.sync(() => Option.fromNullishOr(state.runs.find((run) => run.id === id))),
  selfHostedRunners: () => Effect.succeed([]),
  setActionsSecret: () => Effect.die("No secret is written in these tests"),
  publishRelease: (publishedIn, published) =>
    Effect.succeed({ url: `https://github.com/${publishedIn}/releases/tag/${published.tag}` }),
})

const withGitHub = (github: GitHub["Service"]) =>
  Layer.mergeAll(
    Layer.succeed(
      ReleaseSources,
      ReleaseSources.of({ appStoreConnect: Option.none(), appStoreConnectManager: Option.none() }),
    ),
    noModel,
    Layer.succeed(GitHub, GitHub.of(github)),
  )

// App Store Connect with one app, whose build of the release is processed once `processed`, and
// whose version is in `versionState`; what it was asked to write, in order.
interface FakeStore {
  processed: boolean
  versionState: string | undefined
  readonly written: Array<string>
}

const fakeAppStore = (store: FakeStore): AppStoreConnect["Service"] => ({
  app: (bundleId) => Effect.succeedSome({ id: AppId.make("1574205213"), name: "Notes", bundleId }),
  builds: () => Effect.succeed([]),
  appStoreVersions: () =>
    Effect.sync(() =>
      store.versionState === undefined
        ? []
        : [
            // The app's Mac version of the same number, already out: a promotion follows its iPhone one.
            {
              id: AppStoreVersionId.make("version-mac"),
              platform: "MAC_OS",
              version: "0.6.0",
              state: "READY_FOR_SALE",
              createdAt: DateTime.makeUnsafe(start),
              buildNumber: "2",
            } satisfies AppStoreVersion,
            {
              id: AppStoreVersionId.make("version-9"),
              platform: "IOS",
              version: "0.6.0",
              state: store.versionState,
              createdAt: DateTime.makeUnsafe(start),
              buildNumber: "2",
            } satisfies AppStoreVersion,
          ],
    ),
  appLocales: () => Effect.succeed(["en-US"]),
  build: (_appId, platform, version, buildNumber) =>
    Effect.sync(() =>
      Option.some({
        id: BuildId.make("build-2"),
        platform,
        version,
        buildNumber,
        uploadedAt: DateTime.makeUnsafe(start),
        processingState: store.processed ? "VALID" : "PROCESSING",
        expired: false,
      }),
    ),
  prepareVersion: (_appId, request) =>
    Effect.sync(() => {
      store.written.push(`prepare ${request.version} ${request.buildId} ${request.releaseType} ${request.phased}`)
      store.written.push(...request.whatsNew.map((note) => `whatsNew ${note.locale} ${note.text}`))
      return {
        versionId: AppStoreVersionId.make("version-9"),
        version: request.version,
        state: "PREPARE_FOR_SUBMISSION",
      }
    }),
  submitForReview: (_appId, _platform, versionId) =>
    Effect.sync(() => {
      store.written.push(`submit ${versionId}`)
      store.versionState = "WAITING_FOR_REVIEW"
      return { submissionId: ReviewSubmissionId.make("submission-1"), state: "WAITING_FOR_REVIEW" }
    }),
  releaseVersion: (versionId) =>
    Effect.sync(() => {
      store.written.push(`release ${versionId}`)
    }),
  setPhasedRelease: () => Effect.die("No phased release changes in these tests"),
  setWhatToTest: (buildId, notes) =>
    Effect.sync(() => {
      store.written.push(...notes.map((note) => `whatToTest ${buildId} ${note.locale} ${note.text}`))
    }),
})

describe("Promotions", () => {
  it.effect("start the deploy workflow with the release and environment, and follow its run until it ends", () => {
    const state: FakeState = { dispatched: [], runs: [] }
    return inProject(
      "promotions",
      start,
      Effect.gen(function* () {
        yield* project
        const started = yield* promote(production, "Faster notes")
        const again = yield* promote(production).pipe(Effect.flip)
        const log = yield* ActivityLog
        const [startedEntry] = yield* log.latest

        assert.deepStrictEqual(state.dispatched, [
          {
            workflow,
            ref: "main",
            inputs: { release, environment: production, commit: "b".repeat(40), runner: "auto" },
          },
        ])
        assert.deepInclude(started, {
          component: api,
          release,
          environment: production,
          repository,
          workflow,
          startedBy: MemberId.make("0199f7a2-5c1e-7d3a-9b2f-4e8a1c6d0f53"),
          reason: PromotionReason.make("Faster notes"),
          state: "starting",
          run: { id: 7, url: "https://github.com/notes/notes-api/actions/runs/7" },
        })
        assert.strictEqual(again._tag, "PromotionInProgress")
        assert.strictEqual(startedEntry?.name, "promotion.started")
        assert.deepInclude(startedEntry?.attrs, { reason: "Faster notes", workflow: "promote-to-prod.yml" })

        state.runs = [runOf(7, "waiting")]
        yield* TestClock.setTime(start + minute)
        yield* follow
        const waiting = yield* releasesModule.queries.release.run({ component: api, release })
        assert.deepStrictEqual(
          waiting.promotions.map((promotion) => promotion.state),
          ["waiting"],
        )
        assert.deepStrictEqual(waiting.deployTargets, [{ environment: production, workflow }])
        assert.strictEqual(waiting.repository, repository)

        state.runs = [runOf(7, "completed", "success")]
        yield* TestClock.setTime(start + 4 * minute)
        yield* follow
        const ended = yield* releasesModule.queries.release.run({ component: api, release })
        const [endedEntry] = yield* log.latest
        assert.deepInclude(ended.promotions[0], { state: "succeeded" })
        assert.strictEqual(
          DateTime.toEpochMillis(ended.promotions[0]?.endedAt ?? DateTime.makeUnsafe(0)),
          start + 3 * minute,
        )
        assert.strictEqual(endedEntry?.name, "promotion.ended")
        assert.deepStrictEqual(endedEntry?.actor, { _tag: "System", process: ProcessName.make("releases.promotions") })

        // Once it ended, the release can be promoted again.
        const next = yield* promote(production)
        assert.strictEqual(next.state, "starting")
      }),
      withGitHub(fakeGitHub(state, true)),
    )
  })

  it.effect("find the run GitHub didn't name, and lose one that never shows", () => {
    const state: FakeState = { dispatched: [], runs: [] }
    return inProject(
      "promotions-unnamed",
      start,
      Effect.gen(function* () {
        yield* project
        const started = yield* promote(production)
        assert.isUndefined(started.run)

        state.runs = [runOf(41, "in_progress")]
        yield* TestClock.setTime(start + minute)
        yield* follow
        const found = yield* releasesModule.queries.release.run({ component: api, release })
        assert.deepInclude(found.promotions[0], { state: "running", run: { id: 41, url: runOf(41, "queued").url } })

        // A second promotion, after the first ended, finds no run of its own for 10 minutes.
        state.runs = [runOf(41, "completed", "failure")]
        yield* TestClock.setTime(start + 2 * minute)
        yield* follow
        yield* promote(production)
        yield* TestClock.setTime(start + 13 * minute)
        yield* follow
        const lost = yield* releasesModule.queries.release.run({ component: api, release })
        assert.deepStrictEqual(
          lost.promotions.map((promotion) => [promotion.state, promotion.run?.id]),
          [
            ["lost", undefined],
            ["failed", 41],
          ],
        )
      }),
      withGitHub(fakeGitHub(state, false)),
    )
  })

  it.effect("refuse, saying what to fix, and start nothing", () => {
    const state: FakeState = { dispatched: [], runs: [] }
    return inProject(
      "promotions-refused",
      start,
      Effect.gen(function* () {
        yield* project
        const noWorkflow = yield* promote(dev).pipe(Effect.flip)
        const unknown = yield* releasesModule.actions.promote
          .run(member, { component: api, release: ReleaseVersion.make("1.0.0"), environment: production })
          .pipe(Effect.flip)
        const missing = yield* promote(production).pipe(Effect.flip)

        assert.deepInclude(noWorkflow, { _tag: "PromotionRefused", fix: "links" })
        assert.include(noWorkflow._tag === "PromotionRefused" ? noWorkflow.reason : "", "no deploy target for dev")
        assert.strictEqual(unknown._tag, "ReleaseNotFound")
        assert.deepInclude(missing, { _tag: "PromotionRefused", fix: "repository" })
        assert.include(missing._tag === "PromotionRefused" ? missing.reason : "", "on its default branch, main")
        assert.isEmpty(state.dispatched)
        const detail = yield* releasesModule.queries.release.run({ component: api, release })
        assert.isEmpty(detail.promotions)
      }),
      withGitHub({
        ...fakeGitHub(state, true),
        dispatchWorkflow: (_repository, file) => Effect.fail(new WorkflowNotFound({ workflow: file })),
      }),
    )
  })

  it.effect("take an app's build through App Store review, with its notes, and release it once approved", () => {
    const state: FakeState = { dispatched: [], runs: [] }
    const store: FakeStore = { processed: false, versionState: undefined, written: [] }
    const appStore = fakeAppStore(store)
    const app = ComponentKey.make("notes-ios")
    const appRelease = ReleaseVersion.make("0.6.0+2")
    return inProject(
      "promotions-app-store",
      start,
      Effect.gen(function* () {
        const projects = yield* Projects
        yield* projects.create(member, ProjectName.make("Notes"))
        yield* projects.addComponent(member, { key: app, name: ComponentName.make("Notes") })
        yield* projects.linkComponent(member, app, {
          repository: Repository.make("notes/notes-ios"),
          deployTargets: [
            {
              environment: production,
              workflow: WorkflowFile.make("ios.yml"),
              appStore: { bundleId: BundleId.make("com.example.notes"), distribution: "appStore" },
            },
          ],
        })
        yield* releasesModule.ingest.report.run(app, {
          release: appRelease,
          environment: dev,
          commit: CommitSha.make("d".repeat(40)),
        })
        yield* releasesModule.actions.saveNotes.run(member, {
          component: app,
          release: appRelease,
          notes: [{ locale: NoteLocale.make("en-US"), text: NoteText.make("Faster notes.") }],
        })
        const started = yield* releasesModule.actions.promote.run(member, {
          component: app,
          release: appRelease,
          environment: production,
          submission: { releaseType: "manual", phased: false },
        })
        const states: Array<string> = []
        const followed = Effect.gen(function* () {
          yield* releasesModule.background ?? Effect.void
          const [latest] = (yield* releasesModule.queries.release.run({ component: app, release: appRelease }))
            .promotions
          states.push(latest?.state ?? "none")
          return latest
        })

        state.runs = [{ ...runOf(7, "completed", "success"), url: started.run?.url ?? "" }]
        yield* TestClock.setTime(start + minute)
        yield* followed
        yield* TestClock.setTime(start + 2 * minute)
        yield* followed
        store.processed = true
        yield* TestClock.setTime(start + 3 * minute)
        yield* followed
        store.versionState = "PENDING_DEVELOPER_RELEASE"
        yield* TestClock.setTime(start + 60 * minute)
        const approved = yield* followed
        const released = yield* releasesModule.actions.releaseApproved.run(member, {
          promotion: approved?.id ?? started.id,
        })
        store.versionState = "READY_FOR_SALE"
        yield* TestClock.setTime(start + 61 * minute)
        yield* followed
        const log = yield* ActivityLog
        const names = (yield* log.latest).map((entry) => entry.name)

        assert.deepStrictEqual(state.dispatched[0]?.inputs, {
          release: appRelease,
          environment: production,
          commit: "d".repeat(40),
          runner: "auto",
        })
        assert.deepStrictEqual(states, ["processing", "processing", "inReview", "approved", "succeeded"])
        assert.deepStrictEqual(store.written, [
          "prepare 0.6.0 build-2 manual false",
          "whatsNew en-US Faster notes.",
          "submit version-9",
          "release version-9",
        ])
        assert.strictEqual(released.state, "releasing")
        assert.includeMembers(names, ["promotion.submitted", "promotion.released", "promotion.ended"])
      }),
      Layer.mergeAll(
        Layer.succeed(
          ReleaseSources,
          ReleaseSources.of({ appStoreConnect: Option.some(appStore), appStoreConnectManager: Option.some(appStore) }),
        ),
        Layer.succeed(GitHub, GitHub.of(fakeGitHub(state, true))),
        noModel,
      ),
    )
  })

  it.effect("number the default branch's newest commit and promote it, once the component has a version", () => {
    const state: FakeState = { dispatched: [], runs: [] }
    const newest = CommitSha.make("e".repeat(40))
    return inProject(
      "promotions-latest",
      start,
      Effect.gen(function* () {
        const projects = yield* Projects
        yield* projects.create(member, ProjectName.make("Notes"))
        yield* projects.addComponent(member, { key: api, name: ComponentName.make("Notes API") })
        yield* projects.linkComponent(member, api, { repository, deployTargets: [{ environment: dev, workflow }] })
        const unversioned = yield* releasesModule.actions.promoteLatest
          .run(member, { component: api, environment: dev })
          .pipe(Effect.flip)
        yield* releasesModule.actions.setVersion.run(member, { component: api, version: SemanticVersion.make("1.0.0") })
        const started = yield* releasesModule.actions.promoteLatest.run(member, { component: api, environment: dev })
        // Before it is deployed anywhere, the release opens with its promotion, and takes notes.
        const opened = yield* releasesModule.queries.release.run({ component: api, release: started.release })
        const notes = [{ locale: NoteLocale.make("en-US"), text: NoteText.make("Notes open faster.") }]
        yield* releasesModule.actions.saveNotes.run(member, { component: api, release: started.release, notes })
        const unknown = yield* releasesModule.queries.release
          .run({ component: api, release: ReleaseVersion.make("1.0.0+9") })
          .pipe(Effect.flip)

        assert.deepInclude(unversioned, { _tag: "PromotionRefused", fix: "version" })
        assert.strictEqual(started.release, ReleaseVersion.make("1.0.0+1"))
        assert.strictEqual(opened.summary.verdict, "unmeasured")
        assert.strictEqual(opened.summary.commit?.sha, newest)
        assert.deepStrictEqual(
          opened.promotions.map((promotion) => promotion.id),
          [started.id],
        )
        assert.strictEqual(unknown._tag, "ReleaseNotFound")
        assert.deepStrictEqual(state.dispatched, [
          {
            workflow,
            ref: "main",
            inputs: { release: ReleaseVersion.make("1.0.0+1"), environment: dev, commit: newest, runner: "auto" },
          },
        ])
      }),
      withGitHub({
        ...fakeGitHub(state, true),
        commit: (_repository, ref) =>
          Effect.succeed(
            ref === "main"
              ? Option.some({
                  sha: newest,
                  message: "Faster notes",
                  author: "ada",
                  committedAt: DateTime.makeUnsafe(start),
                  url: "https://github.com/notes/notes-api/commit/e",
                })
              : Option.none(),
          ),
      }),
    )
  })

  it.effect("refuse the App Store without an App Manager key", () =>
    inProject(
      "promotions-no-manager",
      start,
      Effect.gen(function* () {
        const projects = yield* Projects
        yield* projects.create(member, ProjectName.make("Notes"))
        yield* projects.addComponent(member, { key: api, name: ComponentName.make("Notes API") })
        yield* projects.linkComponent(member, api, {
          deployTargets: [
            {
              environment: production,
              appStore: { bundleId: BundleId.make("com.example.notes"), distribution: "appStore" },
            },
          ],
        })
        yield* releasesModule.ingest.report.run(api, {
          release,
          environment: dev,
          commit: CommitSha.make("b".repeat(40)),
        })
        const refused = yield* promote(production).pipe(Effect.flip)
        assert.deepInclude(refused, { _tag: "PromotionRefused", fix: "appStore" })
      }),
    ),
  )

  it.effect("refuse until Cluenori is connected to GitHub", () =>
    inProject(
      "promotions-unconnected",
      start,
      Effect.gen(function* () {
        yield* project
        const refused = yield* promote(production).pipe(Effect.flip)

        assert.deepInclude(refused, { _tag: "PromotionRefused", fix: "github" })
        assert.include(refused._tag === "PromotionRefused" ? refused.reason : "", "isn't connected to GitHub")
      }),
    ),
  )
})
