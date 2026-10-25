import { sketchOf } from "@bagatka/quantile-sketch"
import type { AppStoreConnect, AppStoreVersion, Build } from "@cluenori/app-store-connect"
import { AppStoreConnectRefused } from "@cluenori/app-store-connect"
import type { Actor } from "@cluenori/foundation"
import { ComponentKey, EnvelopeName, EnvironmentKey, MemberId, Period, ReleaseVersion } from "@cluenori/foundation"
import type { Comparison, ReleaseToPublish } from "@cluenori/github"
import { CommitSha, GitHub, GitHubRefused, Repository } from "@cluenori/github"
import { BundleId, ComponentName, ProjectName, Projects } from "@cluenori/projects"
import type { OperationCounts } from "@cluenori/signals"
import { BatchDigest, Signals } from "@cluenori/signals"
import { assert, describe, it } from "@effect/vitest"
import { DateTime, Effect, Layer, Option } from "effect"
import { TestClock } from "effect/testing"

import { NoteLocale, NoteText, ReleaseSources, releasesModule } from "../src/index.ts"
import { inProject, noModel, notConnected } from "./in-object.ts"

// 2026-10-21T10:00:00Z, on a minute.
const start = 1792576800000
const minute = 60_000
const hour = 60 * minute

const api = ComponentKey.make("notes-api")
const ios = ComponentKey.make("notes-ios")
const production = EnvironmentKey.make("production")
const older = ReleaseVersion.make("2026.10.20-a1b2c3d")
const newer = ReleaseVersion.make("2026.10.21-e91f09c")
const member: Actor = { _tag: "Member", id: MemberId.make("0199f7a2-5c1e-7d3a-9b2f-4e8a1c6d0f53") }
const repository = Repository.make("notes/notes-api")
const shaOf = (digit: string) => CommitSha.make(digit.repeat(40))

// `count` runs of GET /api/notes by `release` in the minute starting at `at`.
const counts = (release: ReleaseVersion, at: number, count: number): OperationCounts => ({
  bucket: DateTime.makeUnsafe(at - (at % minute)),
  operation: EnvelopeName.make("GET /api/notes"),
  environment: production,
  release,
  count,
  errors: 0,
  totalMs: count * 20,
  durations: sketchOf(Array.from({ length: count }, () => 20)).sketch,
})

let batches = 0
const record = (entries: ReadonlyArray<OperationCounts>) =>
  Effect.gen(function* () {
    const signals = yield* Signals
    batches += 1
    const at = yield* DateTime.now
    yield* signals.recordTraces(api, {
      digest: BatchDigest.make(batches.toString(16).padStart(64, "0")),
      archive: new Uint8Array(0),
      from: at,
      to: at,
      spans: entries.length,
      counts: entries,
      kept: [],
      traces: [],
    })
  })

// Two releases of the API, the older ran first, each for two hours.
const twoReleases = record([
  counts(older, start - 5 * hour, 300),
  counts(older, start - 3 * hour, 300),
  counts(newer, start - 2 * hour, 300),
  counts(newer, start - 10 * minute, 300),
])

// The project, with the API and the app linked to their sources.
const linkedProject = Effect.gen(function* () {
  const projects = yield* Projects
  yield* projects.create(member, ProjectName.make("Notes"))
  yield* projects.addComponent(member, { key: api, name: ComponentName.make("Notes API") })
  yield* projects.addComponent(member, { key: ios, name: ComponentName.make("Notes iOS") })
  yield* projects.linkComponent(member, api, { repository })
  yield* projects.linkComponent(member, ios, {
    deployTargets: [
      { environment: production, appStore: { bundleId: BundleId.make("com.example.notes"), distribution: "appStore" } },
    ],
  })
})

const today = new Period({ from: DateTime.makeUnsafe(start - 6 * hour), to: DateTime.makeUnsafe(start) })
const list = releasesModule.queries.list.run({ period: today })

// Workflows these tests don't start.
const noWorkflows = {
  defaultBranch: () => Effect.die("No workflow in these tests"),
  dispatchWorkflow: () => Effect.die("No workflow in these tests"),
  workflowRuns: () => Effect.die("No workflow in these tests"),
  workflowRun: () => Effect.die("No workflow in these tests"),
  selfHostedRunners: () => Effect.succeed([]),
} satisfies Pick<
  GitHub["Service"],
  "defaultBranch" | "dispatchWorkflow" | "workflowRuns" | "workflowRun" | "selfHostedRunners"
>

// A release the fake GitHub published, and where.
interface Published {
  readonly repository: Repository
  readonly release: ReleaseToPublish
}

// GitHub with two tags, prod- of each release, and what changed between them; it keeps each
// release it publishes in `published`.
const fakeGitHub = (calls: Array<string>, published: Array<Published> = []): GitHub["Service"] => ({
  tagsContaining: (_repository, text) =>
    Effect.sync(() => {
      calls.push(`tags ${text}`)
      return [older, newer]
        .filter((release) => `prod-${release}`.includes(text))
        .map((release) => ({ name: `prod-${release}`, commit: release === older ? shaOf("a") : shaOf("b") }))
    }),
  commit: (_repository, ref) =>
    Effect.sync(() => {
      calls.push(`commit ${ref}`)
      return Option.some({
        sha: CommitSha.make(ref.padEnd(40, "0")),
        message: ref.startsWith("b") ? "Faster notes (#12)\n\nDetails" : "First release",
        author: "ada",
        committedAt: DateTime.makeUnsafe(start - 6 * hour),
        url: `https://github.com/notes/notes-api/commit/${ref}`,
      })
    }),
  compare: (_repository, base, head) =>
    Effect.sync((): Comparison => {
      calls.push(`compare ${base.slice(0, 1)}...${head.slice(0, 1)}`)
      return {
        status: "ahead",
        totalCommits: 2,
        commits: [
          {
            sha: shaOf("c"),
            message: "Cache notes",
            author: "ada",
            committedAt: DateTime.makeUnsafe(start - 4 * hour),
            url: "https://github.com/notes/notes-api/commit/c",
          },
          {
            sha: shaOf("b"),
            message: "Faster notes (#12)",
            author: "ada",
            committedAt: DateTime.makeUnsafe(start - 3 * hour),
            url: "https://github.com/notes/notes-api/commit/b",
          },
        ],
        filesChanged: 3,
        additions: 40,
        deletions: 12,
        url: "https://github.com/notes/notes-api/compare/a...b",
      }
    }),
  pullRequest: (_repository, number) =>
    Effect.succeedSome({
      number,
      title: "Faster notes",
      author: "ada",
      url: `https://github.com/notes/notes-api/pull/${number}`,
      labels: ["performance"],
    }),
  publishRelease: (publishedIn, release) =>
    Effect.sync(() => {
      published.push({ repository: publishedIn, release })
      return { url: `https://github.com/${publishedIn}/releases/tag/${release.tag}` }
    }),
  ...noWorkflows,
})

const build = (buildNumber: string, hoursAgo: number): Build => ({
  id: `build-${buildNumber}`,
  version: "2.4.0",
  buildNumber,
  uploadedAt: DateTime.makeUnsafe(start - hoursAgo * hour),
  processingState: "VALID",
  expired: false,
  internalTesting: "IN_BETA_TESTING",
})

// What these tests don't publish.
const noPublishing = {
  appLocales: () => Effect.succeed(["en-US"]),
  build: () => Effect.succeedNone,
  prepareVersion: () => Effect.die("Nothing is submitted in these tests"),
  submitForReview: () => Effect.die("Nothing is submitted in these tests"),
  releaseVersion: () => Effect.die("Nothing is released in these tests"),
  setPhasedRelease: () => Effect.die("Nothing is released in these tests"),
  setWhatToTest: () => Effect.die("Nothing is tested in these tests"),
} satisfies Partial<AppStoreConnect["Service"]>

// App Store Connect with two builds of 2.4.0, the later one live in a phased release.
const fakeAppStore = (reads: { count: number }): AppStoreConnect["Service"] => ({
  app: (bundleId) => Effect.succeedSome({ id: "app-1", name: "Notes", bundleId }),
  builds: () =>
    Effect.sync(() => {
      reads.count += 1
      return [build("313", 2), build("312", 5)]
    }),
  appStoreVersions: () =>
    Effect.succeed([
      {
        id: "version-1",
        version: "2.4.0",
        state: "READY_FOR_SALE",
        createdAt: DateTime.makeUnsafe(start - 2 * hour),
        buildNumber: "313",
        phasedRelease: { state: "ACTIVE", currentDay: 2 },
      } satisfies AppStoreVersion,
    ]),
  ...noPublishing,
})

const sourcesOf = (github: GitHub["Service"] | undefined, appStore: AppStoreConnect["Service"] | undefined) =>
  Layer.mergeAll(
    Layer.succeed(
      ReleaseSources,
      ReleaseSources.of({ appStoreConnect: Option.fromNullishOr(appStore), appStoreConnectManager: Option.none() }),
    ),
    noModel,
    github === undefined ? notConnected : Layer.succeed(GitHub, GitHub.of(github)),
  )

const sync = releasesModule.background ?? Effect.void

describe("Releases' sources", () => {
  it.effect("finds each release's commit by its tag, and what changed between them, with their pull requests", () => {
    const calls: Array<string> = []
    return inProject(
      "github",
      start,
      Effect.gen(function* () {
        yield* linkedProject
        yield* twoReleases
        yield* sync
        const { releases } = yield* list
        const detail = yield* releasesModule.queries.release.run({ component: api, release: newer })

        assert.deepStrictEqual(
          releases.map((release) => [release.release, release.commit?.tag, release.commit?.sha.slice(0, 1)]),
          [
            [newer, `prod-${newer}`, "b"],
            [older, `prod-${older}`, "a"],
          ],
        )
        assert.deepStrictEqual(
          detail.changes?.commits.map((commit) => [commit.message, commit.pullRequest]),
          [
            ["Faster notes (#12)", 12],
            ["Cache notes", undefined],
          ],
        )
        assert.deepStrictEqual(
          detail.changes?.pullRequests.map((pull) => [pull.number, pull.labels]),
          [[12, ["performance"]]],
        )
        assert.deepInclude(detail.changes, { filesChanged: 3, additions: 40, deletions: 12 })
        // A second run asks GitHub nothing more.
        const asked = calls.length
        yield* sync
        assert.strictEqual(calls.length, asked)
      }),
      sourcesOf(fakeGitHub(calls), undefined),
    )
  })

  it.effect("says when GitHub refuses, instead of showing no commits", () =>
    inProject(
      "github-refused",
      start,
      Effect.gen(function* () {
        yield* linkedProject
        yield* twoReleases
        yield* sync
        const { releases, problems } = yield* list

        assert.isTrue(releases.every((release) => release.commit === undefined))
        assert.deepStrictEqual(
          problems.map((problem) => [problem.component, problem.source]),
          [[api, "github"]],
        )
        assert.include(problems[0]?.problem ?? "", "Bad credentials")
        const detail = yield* releasesModule.queries.release.run({ component: api, release: newer })
        assert.deepStrictEqual(
          detail.problems.map((problem) => problem.source),
          ["github"],
        )
      }),
      sourcesOf(
        {
          ...fakeGitHub([]),
          tagsContaining: () => Effect.fail(new GitHubRefused({ status: 401, reason: "Bad credentials" })),
        },
        undefined,
      ),
    ),
  )

  it.effect("lists an app's builds as releases with their stage, and reads App Store Connect every 15 minutes", () => {
    const reads = { count: 0 }
    return inProject(
      "app-store",
      start,
      Effect.gen(function* () {
        yield* linkedProject
        yield* sync
        yield* TestClock.setTime(start + 5 * minute)
        yield* sync
        const { releases } = yield* list

        assert.strictEqual(reads.count, 1)
        assert.deepStrictEqual(
          releases.map((release) => [release.component, release.release, release.verdict, release.store?.stage]),
          [
            [ios, ReleaseVersion.make("2.4.0+313"), "unmeasured", "releasing"],
            [ios, ReleaseVersion.make("2.4.0+312"), "unmeasured", "testing"],
          ],
        )
        assert.strictEqual(releases[0]?.store?.phasedRelease?.day, 2)
        // A build is in the environment whose app it is in: production's, and not dev's.
        assert.deepStrictEqual(
          releases.map((release) => release.environment),
          [production, production],
        )
        const inProduction = yield* releasesModule.queries.list.run({ period: today, environment: production })
        const inDev = yield* releasesModule.queries.list.run({
          period: today,
          environment: EnvironmentKey.make("dev"),
        })
        assert.lengthOf(inProduction.releases, 2)
        assert.isEmpty(inDev.releases)
        yield* TestClock.setTime(start + 16 * minute)
        yield* sync
        assert.strictEqual(reads.count, 2)
      }),
      sourcesOf(undefined, fakeAppStore(reads)),
    )
  })

  it.effect("says when App Store Connect refuses the key", () =>
    inProject(
      "app-store-refused",
      start,
      Effect.gen(function* () {
        yield* linkedProject
        yield* sync
        const { problems } = yield* list

        assert.deepStrictEqual(
          problems.map((problem) => [problem.component, problem.source]),
          [[ios, "appStoreConnect"]],
        )
      }),
      sourcesOf(undefined, {
        ...fakeAppStore({ count: 0 }),
        app: () => Effect.fail(new AppStoreConnectRefused({ status: 401, reason: "NOT_AUTHORIZED" })),
      }),
    ),
  )
})

// The module's ingest writes, as the host runs them for a component.
const report = (component: ComponentKey, input: Parameters<typeof releasesModule.ingest.report.run>[1]) =>
  releasesModule.ingest.report.run(component, input)
const last = (component: ComponentKey, input: Parameters<typeof releasesModule.ingest.last.run>[1]) =>
  releasesModule.ingest.last.run(component, input)

describe("Deploy reports", () => {
  it.effect("records a deploy, its commit, and the commits since the one reported before", () =>
    inProject(
      "reports",
      start,
      Effect.gen(function* () {
        yield* linkedProject
        const before = yield* last(api, { environment: production })
        yield* report(api, { release: older, environment: production, commit: shaOf("a") })
        yield* TestClock.setTime(start + hour)
        const since = yield* last(api, { environment: production })
        yield* report(api, {
          release: newer,
          environment: production,
          commit: shaOf("b"),
          tag: `prod-${newer}`,
          commits: [
            { sha: shaOf("b"), message: "Faster notes (#12)", author: "ada", committedAt: DateTime.makeUnsafe(start) },
            { sha: shaOf("c"), message: "Cache notes", author: "ada", committedAt: DateTime.makeUnsafe(start) },
          ],
        })
        // Reported again, as a retried CI step would, it keeps its first deploy.
        yield* TestClock.setTime(start + 2 * hour)
        yield* report(api, { release: newer, environment: production, commit: shaOf("b") })
        const { releases } = yield* releasesModule.queries.list.run({
          period: new Period({ from: DateTime.makeUnsafe(start - hour), to: DateTime.makeUnsafe(start + 3 * hour) }),
        })
        const detail = yield* releasesModule.queries.release.run({ component: api, release: newer })

        assert.deepStrictEqual(before, {})
        assert.deepStrictEqual(since, { release: older, commit: shaOf("a") })
        assert.deepStrictEqual(
          releases.map((release) => [
            release.release,
            release.verdict,
            DateTime.toEpochMillis(release.deployedAt ?? DateTime.makeUnsafe(0)),
          ]),
          [
            [newer, "unmeasured", start + hour],
            [older, "unmeasured", start],
          ],
        )
        assert.deepInclude(releases[0]?.commit, {
          sha: shaOf("b"),
          tag: `prod-${newer}`,
          message: "Faster notes (#12)",
          url: `https://github.com/notes/notes-api/commit/${shaOf("b")}`,
        })
        assert.deepStrictEqual(
          detail.changes?.commits.map((commit) => [commit.message, commit.pullRequest]),
          [
            ["Faster notes (#12)", 12],
            ["Cache notes", undefined],
          ],
        )
        assert.isUndefined(detail.changes?.url)
      }),
    ),
  )
})

describe("GitHub's Releases page", () => {
  const notes = [{ locale: NoteLocale.make("en-US"), text: NoteText.make("Notes open twice as fast.") }]

  it.effect(
    "publishes a release once deployed to production, with its commits, and again when its notes change",
    () => {
      const published: Array<Published> = []
      return inProject(
        "github-releases",
        start,
        Effect.gen(function* () {
          yield* linkedProject
          yield* report(api, { release: older, environment: production, commit: shaOf("a"), tag: `prod-${older}` })
          yield* sync
          yield* TestClock.setTime(start + hour)
          yield* report(api, {
            release: newer,
            environment: production,
            commit: shaOf("b"),
            tag: `prod-${newer}`,
            commits: [
              {
                sha: shaOf("b"),
                message: "Faster notes (#12)",
                author: "ada",
                committedAt: DateTime.makeUnsafe(start),
              },
              { sha: shaOf("c"), message: "Cache notes", author: "ada", committedAt: DateTime.makeUnsafe(start) },
            ],
          })
          // Reported again, as a retried CI step would, or deployed to dev: neither is published.
          yield* report(api, { release: newer, environment: production, commit: shaOf("b") })
          yield* report(api, {
            release: ReleaseVersion.make("2026.10.21-dddddd1"),
            environment: EnvironmentKey.make("dev"),
            commit: shaOf("d"),
          })
          yield* sync
          yield* releasesModule.actions.saveNotes.run(member, { component: api, release: newer, notes })
          yield* sync
          yield* sync
          const detail = yield* releasesModule.queries.release.run({ component: api, release: newer })

          assert.deepStrictEqual(
            published.map((each) => [each.repository, each.release.tag, each.release.name, each.release.latest]),
            [
              [repository, `prod-${older}`, older, true],
              [repository, `prod-${newer}`, newer, true],
              [repository, `prod-${newer}`, newer, true],
            ],
          )
          const [first, second, again] = published.map((each) => each.release)
          assert.strictEqual(first?.body, "")
          assert.strictEqual(second?.commit, shaOf("b"))
          assert.strictEqual(
            second?.body,
            [
              "## What changed",
              "- Faster notes (#12) ([bbbbbbb](https://github.com/notes/notes-api/commit/b))\n- Cache notes ([ccccccc](https://github.com/notes/notes-api/commit/c))",
              "https://github.com/notes/notes-api/compare/a...b",
            ].join("\n\n"),
          )
          assert.isTrue(again?.body.startsWith("Notes open twice as fast.\n\n## What changed"))
          assert.strictEqual(detail.gitHubRelease?.url, `https://github.com/notes/notes-api/releases/tag/prod-${newer}`)
        }),
        sourcesOf(fakeGitHub([], published), undefined),
      )
    },
  )

  it.effect("takes a release that only ran there as the one before, for what changed since", () => {
    const published: Array<Published> = []
    return inProject(
      "github-releases-ran",
      start,
      Effect.gen(function* () {
        yield* linkedProject
        yield* twoReleases
        yield* report(api, {
          release: ReleaseVersion.make("1.0.0+1"),
          environment: production,
          commit: shaOf("f"),
          tag: "v1.0.0+1",
        })
        yield* sync

        assert.deepStrictEqual(
          published.map((each) => each.release.tag),
          ["v1.0.0+1"],
        )
        assert.include(published[0]?.release.body, "## What changed")
      }),
      sourcesOf(fakeGitHub([], published), undefined),
    )
  })

  it.effect("says what to change when GitHub refuses to publish, and publishes once it may", () => {
    const published: Array<Published> = []
    const allowed = { now: false }
    const github = fakeGitHub([], published)
    return inProject(
      "github-releases-refused",
      start,
      Effect.gen(function* () {
        yield* linkedProject
        yield* report(api, { release: older, environment: production, commit: shaOf("a") })
        yield* sync
        const refused = yield* list
        allowed.now = true
        yield* TestClock.setTime(start + minute)
        yield* sync
        const after = yield* list
        const detail = yield* releasesModule.queries.release.run({ component: api, release: older })

        assert.deepStrictEqual(
          refused.problems.map((problem) => [problem.component, problem.source]),
          [[api, "github"]],
        )
        assert.include(refused.problems[0]?.problem, "give Cluenori's app Contents: Read and write")
        assert.isEmpty(after.problems)
        assert.deepStrictEqual(
          published.map((each) => each.release.tag),
          [`v${older}`],
        )
        assert.isDefined(detail.gitHubRelease)
      }),
      sourcesOf(
        {
          ...github,
          publishRelease: (forRepository, release) =>
            allowed.now
              ? github.publishRelease(forRepository, release)
              : Effect.fail(
                  new GitHubRefused({
                    status: 403,
                    reason: `${forRepository}'s releases can't be written with this token: it needs Contents: write`,
                  }),
                ),
        },
        undefined,
      ),
    )
  })

  it.effect("publishes an app's release once it is out on the App Store, not when it is uploaded", () => {
    const published: Array<Published> = []
    const shipping = { state: "WAITING_FOR_REVIEW" }
    const appStore: AppStoreConnect["Service"] = {
      ...fakeAppStore({ count: 0 }),
      appStoreVersions: () =>
        Effect.sync(() => [
          {
            id: "version-1",
            version: "2.4.0",
            state: shipping.state,
            createdAt: DateTime.makeUnsafe(start - 2 * hour),
            buildNumber: "313",
          } satisfies AppStoreVersion,
        ]),
    }
    const shipped = ReleaseVersion.make("2.4.0+313")
    return inProject(
      "github-releases-app-store",
      start,
      Effect.gen(function* () {
        const projects = yield* Projects
        yield* projects.create(member, ProjectName.make("Notes"))
        yield* projects.addComponent(member, { key: ios, name: ComponentName.make("Notes iOS") })
        yield* projects.linkComponent(member, ios, {
          repository: Repository.make("notes/notes-ios"),
          deployTargets: [
            {
              environment: production,
              appStore: { bundleId: BundleId.make("com.example.notes"), distribution: "appStore" },
            },
          ],
        })
        // CI reports the build it uploaded to the App Store app.
        yield* report(ios, { release: shipped, environment: production, commit: shaOf("e"), tag: "v2.4.0+313" })
        yield* sync
        const inReview = published.length
        shipping.state = "READY_FOR_SALE"
        yield* TestClock.setTime(start + 16 * minute)
        yield* sync

        assert.strictEqual(inReview, 0)
        assert.deepStrictEqual(
          published.map((each) => [each.repository, each.release.tag, each.release.commit]),
          [[Repository.make("notes/notes-ios"), "v2.4.0+313", shaOf("e")]],
        )
      }),
      sourcesOf(fakeGitHub([], published), appStore),
    )
  })
})
