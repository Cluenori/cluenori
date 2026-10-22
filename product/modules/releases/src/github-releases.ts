import type { GitHubRefused } from "@bagatka/github"
import { GitHub } from "@bagatka/github"
import { Projects } from "@cluenori/projects"
import { DateTime, Effect, Option } from "effect"

import type { KnownRelease } from "./catalog.ts"
import { knownReleases, previousOf } from "./catalog.ts"
import type { ReleaseNote } from "./note.ts"
import type { ReleaseToPublish } from "./records.ts"
import { ReleaseRecords } from "./records.ts"
import type { ReleaseChanges } from "./release.ts"
import { noteProblem, problemOf } from "./sync.ts"

// Each run publishes at most this many releases, so many reaching production at once go out over a
// few minutes.
const publishedPerRun = 3
// A release's page lists at most this many of its commits.
const commitsListed = 50

// Whether a release reached the people in its environment: it ran there, was deployed there, or was
// out on the App Store, now or before a newer version replaced it.
const reachedPeople = (release: KnownRelease) =>
  release.ran !== undefined ||
  release.deploy !== undefined ||
  release.store?.stage === "releasing" ||
  release.store?.stage === "live" ||
  release.store?.stage === "replaced"

/**
 * What a release's page on GitHub says, in Markdown: its notes, in English when it has them, else
 * its first language's; then the commits since the release before it there, newest first, at most
 * 50; then the link comparing the two. Empty for a release with none of them.
 */
export const releaseBody = (
  notes: ReadonlyArray<ReleaseNote>,
  changes: ReleaseChanges | undefined,
  compareUrl: string | undefined,
) => {
  const note =
    notes.find((each) => each.locale === "en-US") ?? notes.find((each) => each.locale.startsWith("en")) ?? notes[0]
  const commits = changes?.commits.slice(0, commitsListed) ?? []
  const more = (changes?.totalCommits ?? 0) - commits.length
  const changed =
    commits.length === 0
      ? []
      : [
          "## What changed",
          [
            ...commits.map((commit) => {
              const short = commit.sha.slice(0, 7)
              return `- ${commit.message} (${commit.url === undefined ? short : `[${short}](${commit.url})`})`
            }),
            ...(more > 0 ? [`- And ${more} more`] : []),
          ].join("\n"),
        ]
  return [
    ...(note === undefined ? [] : [note.text]),
    ...changed,
    ...(compareUrl === undefined ? [] : [compareUrl]),
  ].join("\n\n")
}

// What to do when GitHub refuses to publish, for the person who fixes it: Cluenori reaches GitHub as
// the workspace's app, whose permissions an owner changes on GitHub.
const refusalOf = (release: ReleaseToPublish, error: GitHubRefused) =>
  error.status === 403 || error.status === 404
    ? `GitHub refused to publish ${release.release}: ${error.reason}. On GitHub, give Cluenori's app Contents: Read and write in its settings, then accept the new permission where it is installed.`
    : `GitHub refused to publish ${release.release}: ${error.reason}.`

/**
 * Publishes the releases that reached production on their repositories' Releases pages, a few each
 * run, the earliest first: as their tag (the one reported, else `v<release>`, made on their commit),
 * marked latest, with their notes and the commits since the release before them there. A release
 * waits while its component has no repository or its commit isn't found; a refusal or a GitHub
 * that doesn't answer is noted as the component's GitHub problem, and the next run tries again.
 * Publishing again updates the same page.
 */
export const publishGitHubReleases = Effect.gen(function* () {
  const records = yield* ReleaseRecords
  const toPublish = yield* records.gitHubReleasesToPublish
  if (toPublish.length === 0) {
    return
  }
  const projects = yield* Projects
  const github = yield* GitHub
  const components = yield* projects.components.pipe(Effect.catchTag("ProjectNotFound", () => Effect.succeed([])))
  const releases = yield* knownReleases
  const syncs = yield* records.syncs
  let published = 0
  for (const each of toPublish) {
    const repository = components.find((component) => component.key === each.component)?.repository
    const commits = yield* records.commits(each.component)
    const commit = commits.get(each.release)
    if (published >= publishedPerRun || repository === undefined || commit === undefined) {
      continue
    }
    published += 1
    const known = releases.find(
      (release) =>
        release.component === each.component &&
        release.release === each.release &&
        release.environment === each.environment,
    )
    const previous = known === undefined ? undefined : previousOf(releases.filter(reachedPeople), known)
    const changes =
      previous === undefined ? Option.none() : yield* records.changes(each.component, each.release, previous.release)
    const tag = commit.tag ?? `v${each.release}`
    const previousTag = previous === undefined ? undefined : commits.get(previous.release)?.tag
    const compareUrl =
      Option.getOrUndefined(changes)?.url ??
      (previousTag === undefined
        ? undefined
        : `https://github.com/${repository}/compare/${encodeURIComponent(previousTag)}...${encodeURIComponent(tag)}`)
    const notes = yield* records.notes(each.component, each.release)
    yield* github
      .publishRelease(repository, {
        tag,
        commit: commit.sha,
        name: each.release,
        body: releaseBody(notes, Option.getOrUndefined(changes), compareUrl),
        latest: true,
      })
      .pipe(
        Effect.flatMap((page) =>
          Effect.flatMap(DateTime.now, (at) => records.saveGitHubRelease(each, { url: page.url, publishedAt: at })),
        ),
        Effect.catchTags({
          GitHubRefused: (error) => noteProblem(each.component, "github", refusalOf(each, error), syncs),
          GitHubUnavailable: (error) => noteProblem(each.component, "github", problemOf("GitHub", error), syncs),
        }),
      )
  }
})
