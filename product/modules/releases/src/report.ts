import type { ComponentKey } from "@cluenori/foundation"
import { defaultProjectSettings, isProduction, Projects } from "@cluenori/projects"
import { DateTime, Effect } from "effect"

import { pullRequestOf } from "./identity.ts"
import { ReleaseRecords } from "./records.ts"
import type { LastReport, LastReportQuery, ReleaseChanges, ReleaseReport } from "./release.ts"

/**
 * Records a deploy `cluenori-release` reported for `component`: the release and its commit, now;
 * and, when it listed the commits since the release reported before in the same environment, what
 * changed between them, until GitHub's comparison replaces it. A release reported again in the
 * same environment keeps its first deploy time. A release deployed to a production environment,
 * other than reported again there, is to be published on its repository's Releases page; an app's
 * build, uploaded to an App Store app, is once App Store Connect says it is out.
 */
export const reportDeploy = Effect.fn("Releases.reportDeploy")(function* (
  component: ComponentKey,
  report: ReleaseReport,
) {
  const records = yield* ReleaseRecords
  const projects = yield* Projects
  const now = yield* DateTime.now
  const before = yield* records.deploys(component)
  const previous = before.find(
    (deploy) => deploy.environment === report.environment && deploy.release !== report.release,
  )
  const reportedAgain = before.find((deploy) => deploy.environment === report.environment)?.release === report.release
  yield* records.saveDeploy({
    component,
    environment: report.environment,
    release: report.release,
    commit: report.commit,
    deployedAt: now,
  })
  const linked = (yield* projects.components.pipe(Effect.orElseSucceed(() => []))).find(
    (each) => each.key === component,
  )
  const settings = yield* projects.settings.pipe(
    Effect.catchTag("ProjectNotFound", () => Effect.succeed(defaultProjectSettings)),
  )
  // A rollback, an older release deployed again, is the latest there again. An app's build reported
  // to an environment whose target is an App Store app was only uploaded: it reaches production
  // when App Store Connect says it is out.
  const uploaded = linked?.deployTargets?.some(
    (target) => target.environment === report.environment && target.appStore !== undefined,
  )
  if (
    linked?.repository !== undefined &&
    uploaded !== true &&
    !reportedAgain &&
    isProduction(settings, report.environment)
  ) {
    yield* records.queueGitHubRelease({
      component,
      release: report.release,
      environment: report.environment,
      reachedAt: now,
    })
  }
  const urlOf = (sha: string) =>
    linked?.repository === undefined ? {} : { url: `https://github.com/${linked.repository}/commit/${sha}` }
  const own = report.commits?.find((commit) => commit.sha === report.commit)
  // A report of the same commit again adds to what is known of it, as a retried CI step would.
  const known = (yield* records.commits(component)).get(report.release)
  yield* records.saveCommit(component, report.release, {
    ...(known?.sha === report.commit ? known : {}),
    sha: report.commit,
    ...(report.tag === undefined ? {} : { tag: report.tag }),
    ...(own === undefined ? {} : { message: own.message, author: own.author, committedAt: own.committedAt }),
    ...urlOf(report.commit),
  })
  if (previous !== undefined && report.commits !== undefined) {
    const changes: ReleaseChanges = {
      totalCommits: report.commits.length,
      commits: report.commits.map((commit) => {
        const pullRequest = pullRequestOf(commit.message)
        return {
          sha: commit.sha,
          message: commit.message,
          author: commit.author,
          committedAt: commit.committedAt,
          ...urlOf(commit.sha),
          ...(pullRequest === undefined ? {} : { pullRequest }),
        }
      }),
      pullRequests: [],
    }
    yield* records.saveChanges(component, report.release, previous.release, changes)
  }
})

/** The last deploy reported of `component`, in the query's environment or any: what the next report's commits start after. */
export const lastDeploy = Effect.fn("Releases.lastDeploy")(function* (component: ComponentKey, query: LastReportQuery) {
  const records = yield* ReleaseRecords
  const deploys = yield* records.deploys(component)
  const latest = deploys.find((deploy) => query.environment === undefined || deploy.environment === query.environment)
  const last: LastReport = latest === undefined ? {} : { release: latest.release, commit: latest.commit }
  return last
})
