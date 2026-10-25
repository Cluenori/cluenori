import type { AppStoreVersion, Build, Platform } from "@bagatka/app-store-connect"
import type { Tag } from "@cluenori/github"

import type { StoreStage } from "./release.ts"

// How a release is found in its repository and its store: the one place these rules live.

/**
 * The platform of the App Store builds and versions a release is: iPhone apps, as a deploy target
 * doesn't name a platform. The rest of an app's builds and versions are left out.
 */
export const appPlatform: Platform = "IOS"

/**
 * A commit SHA inside a version, such as `e91f09c` in `2026.10.21-e91f09c`: the last run of 7 to 40
 * hex characters with a letter among them, so a date such as `20261021` isn't one.
 */
export const shaInVersion = (version: string): string | undefined =>
  (version.match(/[0-9a-f]+/gi) ?? [])
    .findLast((run) => run.length >= 7 && run.length <= 40 && /[a-f]/i.test(run))
    ?.toLowerCase()

/**
 * The tag that names `version`: one named exactly so, or ending with it after a separator, such as
 * `prod-2026.10.21-e91f09c` or `v2.4.0`; of several, the first the client lists, the highest version
 * first.
 */
export const tagFor = (tags: ReadonlyArray<Tag>, version: string): Tag | undefined =>
  tags.find((tag) => tag.name === version) ??
  tags.find((tag) => {
    const prefix = tag.name.slice(0, tag.name.length - version.length)
    return tag.name.endsWith(version) && (prefix === "v" || /[^0-9A-Za-z]$/.test(prefix))
  })

/** What a version is searched for as in tags: the release itself, then an app's marketing version before `+`. */
export const tagSearches = (release: string): ReadonlyArray<string> => {
  const marketing = release.split("+")[0]
  return marketing === undefined || marketing === release ? [release] : [release, marketing]
}

/**
 * The pull request a commit came from, when its message names one the way GitHub writes merges:
 * `Merge pull request #12 from ...`, or a squash merge's `Title (#12)` on its first line.
 */
export const pullRequestOf = (message: string): number | undefined => {
  const firstLine = message.split("\n")[0] ?? ""
  const named = /^Merge pull request #(\d+)/.exec(firstLine) ?? /\(#(\d+)\)\s*$/.exec(firstLine)
  return named?.[1] === undefined ? undefined : Number(named[1])
}

/** The release an app's build is: its marketing version and build number, as an app reports them, `2.4.0+312`. */
export const releaseOfBuild = (build: Pick<Build, "version" | "buildNumber">) => `${build.version}+${build.buildNumber}`

// Apple's App Store version states, by the stage they are.
const stages: Readonly<Record<string, StoreStage>> = {
  READY_FOR_SALE: "live",
  READY_FOR_DISTRIBUTION: "live",
  IN_REVIEW: "inReview",
  WAITING_FOR_REVIEW: "waitingForReview",
  READY_FOR_REVIEW: "waitingForReview",
  WAITING_FOR_EXPORT_COMPLIANCE: "waitingForReview",
  PENDING_DEVELOPER_RELEASE: "pendingRelease",
  PENDING_APPLE_RELEASE: "pendingRelease",
  PROCESSING_FOR_APP_STORE: "pendingRelease",
  PROCESSING_FOR_DISTRIBUTION: "pendingRelease",
  ACCEPTED: "pendingRelease",
  REJECTED: "rejected",
  METADATA_REJECTED: "rejected",
  DEVELOPER_REJECTED: "rejected",
  INVALID_BINARY: "rejected",
  REPLACED_WITH_NEW_VERSION: "replaced",
  REMOVED_FROM_SALE: "replaced",
  DEVELOPER_REMOVED_FROM_SALE: "replaced",
  PREPARE_FOR_SUBMISSION: "testing",
}

/**
 * Where a build stands: its processing first, then the App Store version that ships it, when one
 * does, else TestFlight, unless it expired. A live version in a phased release that is active or
 * paused is still releasing.
 */
export const stageOf = (build: Build, shipping: AppStoreVersion | undefined): StoreStage => {
  if (build.processingState === "PROCESSING") {
    return "processing"
  }
  if (build.processingState === "FAILED" || build.processingState === "INVALID") {
    return "failed"
  }
  if (shipping !== undefined) {
    const stage = stages[shipping.state] ?? "other"
    const phased = shipping.phasedRelease?.state
    return stage === "live" && (phased === "ACTIVE" || phased === "PAUSED") ? "releasing" : stage
  }
  return build.expired ? "expired" : "testing"
}
