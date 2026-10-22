import type { AppStoreConnect } from "@bagatka/app-store-connect"
import type { Commit, Repository } from "@bagatka/github"
import { GitHub } from "@bagatka/github"
import type { ComponentKey, EnvironmentKey } from "@cluenori/foundation"
import { ReleaseVersion } from "@cluenori/foundation"
import type { BundleId } from "@cluenori/projects"
import { Projects } from "@cluenori/projects"
import { DateTime, Duration, Effect, Option, Schema } from "effect"

import type { KnownRelease } from "./catalog.ts"
import { knownReleases, previousOf } from "./catalog.ts"
import { pullRequestOf, releaseOfBuild, shaInVersion, stageOf, tagFor, tagSearches } from "./identity.ts"
import type { Sync } from "./records.ts"
import { ReleaseRecords } from "./records.ts"
import type { MergedPullRequest, ReleaseChanges, ReleaseCommit, StoreBuild } from "./release.ts"
import { ReleaseSources } from "./sources.ts"

// A release whose commit wasn't found is looked for again after this long.
const lookAgainAfter = Duration.hours(1)
// App Store Connect is read this often per app.
const storeEvery = Duration.minutes(15)
// Each run looks up at most this many commits, and compares at most this many pairs, so a project
// with many new releases catches up over a few minutes without a burst of requests.
const lookupsPerRun = 5
const comparesPerRun = 2
// GitHub lists at most this many of a comparison's files, so counts past it would understate.
const filesListed = 300
// Of the pull requests a comparison names, this many are read.
const pullRequestsRead = 30
// Of an app's builds and App Store versions, this many of the latest are kept.
const buildsRead = 50
const versionsRead = 20

const firstLine = (message: string) => message.split("\n")[0] ?? ""

const commitOf = (commit: Commit, tag: string | undefined): ReleaseCommit => ({
  sha: commit.sha,
  ...(tag === undefined ? {} : { tag }),
  message: firstLine(commit.message),
  author: commit.author,
  committedAt: commit.committedAt,
  url: commit.url,
})

// The commit a release is, from GitHub: its deploy's, the tag that names it, or a SHA in its version.
const findCommit = Effect.fn("Releases.findCommit")(function* (
  github: GitHub["Service"],
  repository: Repository,
  release: KnownRelease,
) {
  if (release.deploy !== undefined) {
    const deployed = yield* github.commit(repository, release.deploy.commit)
    return Option.map(deployed, (commit) => commitOf(commit, undefined))
  }
  for (const text of tagSearches(release.release)) {
    const tags = yield* github.tagsContaining(repository, text)
    const tag = tagFor(tags, text)
    if (tag !== undefined) {
      const tagged = yield* github.commit(repository, tag.commit)
      return Option.map(tagged, (commit) => commitOf(commit, tag.name))
    }
  }
  const sha = shaInVersion(release.release)
  if (sha === undefined) {
    return Option.none<ReleaseCommit>()
  }
  const named = yield* github.commit(repository, sha)
  return Option.map(named, (commit) => commitOf(commit, undefined))
})

// What changed from one commit to another, with the pull requests its commits name.
const compareCommits = Effect.fn("Releases.compareCommits")(function* (
  github: GitHub["Service"],
  repository: Repository,
  base: ReleaseCommit,
  head: ReleaseCommit,
) {
  const comparison = yield* github.compare(repository, base.sha, head.sha)
  const newestFirst = comparison.commits.toReversed()
  const numbers = [
    ...new Set(newestFirst.flatMap((commit) => Option.toArray(Option.fromNullishOr(pullRequestOf(commit.message))))),
  ]
  const pullRequests = yield* Effect.forEach(numbers.slice(0, pullRequestsRead), (number) =>
    github.pullRequest(repository, number),
  )
  const changes: ReleaseChanges = {
    totalCommits: comparison.totalCommits,
    commits: newestFirst.map((commit) => {
      const pullRequest = pullRequestOf(commit.message)
      return {
        sha: commit.sha,
        message: firstLine(commit.message),
        author: commit.author,
        committedAt: commit.committedAt,
        url: commit.url,
        ...(pullRequest === undefined ? {} : { pullRequest }),
      }
    }),
    pullRequests: pullRequests.flatMap((found) =>
      Option.toArray(
        Option.map(found, (pull): MergedPullRequest => ({
          number: pull.number,
          title: pull.title,
          author: pull.author,
          url: pull.url,
          labels: pull.labels,
        })),
      ),
    ),
    // Counts of a list GitHub cut short would read as exact, so they are left out.
    ...(comparison.filesChanged >= filesListed
      ? {}
      : { filesChanged: comparison.filesChanged, additions: comparison.additions, deletions: comparison.deletions }),
    url: comparison.url,
  }
  return changes
})

// Finds the commits of a component's releases, and what changed between them, a few each run.
const syncRepository = Effect.fn("Releases.syncRepository")(function* (
  github: GitHub["Service"],
  component: ComponentKey,
  repository: Repository,
  releases: ReadonlyArray<KnownRelease>,
) {
  const records = yield* ReleaseRecords
  const now = yield* DateTime.now
  const own = releases.filter((release) => release.component === component)
  const found = new Map(yield* records.commits(component))
  let lookups = 0
  for (const release of own) {
    if (lookups >= lookupsPerRun) {
      break
    }
    if (found.has(release.release)) {
      continue
    }
    const tried = yield* records.lookupTriedAt(component, release.release)
    if (Option.isSome(tried) && Duration.isLessThan(DateTime.distance(tried.value, now), lookAgainAfter)) {
      continue
    }
    lookups += 1
    const commit = yield* findCommit(github, repository, release)
    if (Option.isSome(commit)) {
      yield* records.saveCommit(component, release.release, commit.value)
      found.set(release.release, commit.value)
    } else {
      yield* records.saveLookup(component, release.release, now)
    }
  }
  let compares = 0
  for (const release of own) {
    if (compares >= comparesPerRun) {
      break
    }
    const previous = previousOf(releases, release)
    const head = found.get(release.release)
    const base = previous === undefined ? undefined : found.get(previous.release)
    if (previous === undefined || head === undefined || base === undefined || base.sha === head.sha) {
      continue
    }
    // Changes a deploy report listed are replaced by GitHub's, which add pull requests and files.
    const known = yield* records.changes(component, release.release, previous.release)
    if (Option.isSome(known) && known.value.url !== undefined) {
      continue
    }
    compares += 1
    const changes = yield* compareCommits(github, repository, base, head)
    yield* records.saveChanges(component, release.release, previous.release, changes)
  }
})

// Reads the builds and App Store versions of the app an environment's builds go to; a problem, if
// App Store Connect has no such app.
const syncStore = Effect.fn("Releases.syncStore")(function* (
  appStoreConnect: AppStoreConnect["Service"],
  component: ComponentKey,
  environment: EnvironmentKey,
  bundleId: BundleId,
) {
  const records = yield* ReleaseRecords
  const app = yield* appStoreConnect.app(bundleId)
  if (Option.isNone(app)) {
    return Option.some(`App Store Connect has no app with the bundle ID ${bundleId} on the API key's team.`)
  }
  const builds = yield* appStoreConnect.builds(app.value.id, buildsRead)
  const versions = yield* appStoreConnect.appStoreVersions(app.value.id, versionsRead)
  const stored = builds.flatMap((build) => {
    const release = Schema.decodeOption(ReleaseVersion)(releaseOfBuild(build))
    // Not handled: a version or build number with characters a release can't have; it is left out,
    // and would take a mapping of Apple's versions to releases.
    if (Option.isNone(release)) {
      return []
    }
    const shipping = versions.find(
      (version) => version.version === build.version && version.buildNumber === build.buildNumber,
    )
    const phased = shipping?.phasedRelease
    const storeBuild: StoreBuild = {
      version: build.version,
      buildNumber: build.buildNumber,
      uploadedAt: build.uploadedAt,
      stage: stageOf(build, shipping),
      ...(shipping === undefined ? {} : { appStoreState: shipping.state }),
      ...(build.internalTesting === undefined ? {} : { internalTesting: build.internalTesting }),
      ...(build.externalTesting === undefined ? {} : { externalTesting: build.externalTesting }),
      ...(phased === undefined
        ? {}
        : {
            phasedRelease: {
              state: phased.state,
              ...(phased.startedAt === undefined ? {} : { startedAt: phased.startedAt }),
              ...(phased.currentDay === undefined ? {} : { day: phased.currentDay }),
            },
          }),
      ...(shipping?.earliestReleaseAt === undefined ? {} : { earliestReleaseAt: shipping.earliestReleaseAt }),
    }
    return [{ component, release: release.value, build: storeBuild }]
  })
  yield* records.replaceStoreBuilds(component, environment, stored)
  return Option.none<string>()
})

// Reads each of a component's apps, one for each deploy target with one, at most every 15 minutes,
// and notes the first problem.
const syncStores = Effect.fn("Releases.syncStores")(function* (
  appStoreConnect: AppStoreConnect["Service"],
  component: ComponentKey,
  targets: ReadonlyArray<{ readonly environment: EnvironmentKey; readonly bundleId: BundleId }>,
  lastRead: DateTime.Utc | undefined,
) {
  const records = yield* ReleaseRecords
  const now = yield* DateTime.now
  if (lastRead !== undefined && Duration.isLessThan(DateTime.distance(lastRead, now), storeEvery)) {
    return
  }
  const problems = yield* Effect.forEach(targets, (target) =>
    syncStore(appStoreConnect, component, target.environment, target.bundleId),
  )
  const problem = problems.flatMap((each) => Option.toArray(each))[0]
  yield* records.saveSync({ component, source: "appStoreConnect", at: now, problem })
})

// What a source said when it refused or failed, for the person who fixes it. GitHub's refusals
// through the workspace's app say what to do; App Store Connect's are about its key.
const problemOf = (
  source: "GitHub" | "App Store Connect",
  error: { readonly _tag: string; readonly reason: string },
) => {
  if (!error._tag.endsWith("Refused")) {
    return `${source} didn't answer: ${error.reason}. Cluenori tries again.`
  }
  return source === "GitHub"
    ? `GitHub refused: ${error.reason}.`
    : `${source} refused: ${error.reason}. Check its credentials and what they may read.`
}

// Notes what a source said for the releases list, and in the log when it is new; the next minute
// tries again.
const noteProblem = Effect.fn("Releases.noteProblem")(function* (
  component: ComponentKey,
  source: "github" | "appStoreConnect",
  problem: string,
  syncs: ReadonlyArray<Sync>,
) {
  const records = yield* ReleaseRecords
  const at = yield* DateTime.now
  const before = syncs.find((sync) => sync.component === component && sync.source === source)
  if (before?.problem !== problem) {
    yield* Effect.logWarning("A release source failed", { component, source, problem })
  }
  yield* records.saveSync({ component, source, at, problem })
})

/**
 * The module's background work, each minute on the project's alarm: for each component linked to
 * a repository, finds a few releases' commits and what changed between them; for each with deploy
 * targets in App Store apps, reads App Store Connect every 15 minutes, each app's builds as its
 * environment's. A source that refuses or fails is noted for the
 * releases list, and the next minute tries again; nothing else is held up by it.
 */
export const syncReleases = Effect.gen(function* () {
  const projects = yield* Projects
  const sources = yield* ReleaseSources
  const github = yield* GitHub
  const records = yield* ReleaseRecords
  const components = yield* projects.components.pipe(Effect.catchTag("ProjectNotFound", () => Effect.succeed([])))
  // Each component's apps: its deploy targets with an App Store app.
  const appsOf = (component: (typeof components)[number]) =>
    (component.deployTargets ?? []).flatMap((target) =>
      target.appStore === undefined ? [] : [{ environment: target.environment, bundleId: target.appStore.bundleId }],
    )
  if (components.every((component) => component.repository === undefined && appsOf(component).length === 0)) {
    return
  }
  const releases = yield* knownReleases
  const syncs = yield* records.syncs
  for (const component of components) {
    if (component.repository !== undefined) {
      const repository = component.repository
      yield* syncRepository(github, component.key, repository, releases).pipe(
        Effect.andThen(DateTime.now),
        Effect.flatMap((at) =>
          records.saveSync({ component: component.key, source: "github", at, problem: undefined }),
        ),
        Effect.catchTags({
          GitHubRefused: (error) => noteProblem(component.key, "github", problemOf("GitHub", error), syncs),
          GitHubUnavailable: (error) => noteProblem(component.key, "github", problemOf("GitHub", error), syncs),
        }),
      )
    }
    const apps = appsOf(component)
    if (apps.length > 0 && Option.isSome(sources.appStoreConnect)) {
      const lastRead = syncs.find((sync) => sync.component === component.key && sync.source === "appStoreConnect")
      yield* syncStores(sources.appStoreConnect.value, component.key, apps, lastRead?.at).pipe(
        Effect.catchTags({
          AppStoreConnectRefused: (error) =>
            noteProblem(component.key, "appStoreConnect", problemOf("App Store Connect", error), syncs),
          AppStoreConnectUnavailable: (error) =>
            noteProblem(component.key, "appStoreConnect", problemOf("App Store Connect", error), syncs),
        }),
      )
    }
  }
})
