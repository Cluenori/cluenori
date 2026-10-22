// What the releases pages say about promotions, deploy targets and versions, worked out once from
// the API's answers. Only those pages say these, so they load with them, not with the first load
// (`src/project-facts.ts` has the rules every page says). Every rule is pure.

import type { EnvironmentKey, MemberId } from "@cluenori/foundation"
import type { Member } from "@cluenori/members"
import type { DeployTarget } from "@cluenori/projects"
import type { ComponentVersion, Promotion, PromotionState } from "@cluenori/releases"
import { hasEnded } from "@cluenori/releases"

// ---- Promotions ------------------------------------------------------------------------------------

/**
 * How a promotion's state reads: moving on GitHub or in App Store Connect (starting, queued,
 * running, processing, in review), waiting for someone (to approve its environment on GitHub, or to
 * release it once App Store review approved it), succeeded, failed or rejected, cancelled, or no
 * longer followed.
 */
export type PromotionTone = "moving" | "waiting" | "succeeded" | "failed" | "cancelled" | "lost"

/** Each state of a promotion in words, and its tone. */
export const promotionStates: Readonly<
  Record<PromotionState, { readonly words: string; readonly tone: PromotionTone }>
> = {
  starting: { words: "Starting", tone: "moving" },
  queued: { words: "Queued", tone: "moving" },
  waiting: { words: "Waiting for approval on GitHub", tone: "waiting" },
  running: { words: "Running", tone: "moving" },
  processing: { words: "Processing in App Store Connect", tone: "moving" },
  inReview: { words: "In App Store review", tone: "moving" },
  approved: { words: "Approved", tone: "waiting" },
  releasing: { words: "Releasing on the App Store", tone: "moving" },
  succeeded: { words: "Succeeded", tone: "succeeded" },
  failed: { words: "Failed", tone: "failed" },
  cancelled: { words: "Cancelled", tone: "cancelled" },
  rejected: { words: "Rejected in review", tone: "failed" },
  lost: { words: "Not followed — see GitHub", tone: "lost" },
}

/** How often a release's page asks again while a promotion of it runs: Cluenori asks GitHub each minute. */
export const promotionsAskedEveryMs = 15_000

/** Whether any of `promotions` hasn't ended, so its page asks for them again until each has. */
export const isFollowing = (promotions: ReadonlyArray<Promotion>) =>
  promotions.some((promotion) => !hasEnded(promotion.state))

/**
 * A release's promotions as its page shows them, the latest first: the API's, with one `started`
 * just now in front until the API's answer has it.
 */
export const promotionsShown = (
  promotions: ReadonlyArray<Promotion>,
  started: Promotion | undefined,
): ReadonlyArray<Promotion> =>
  started === undefined || promotions.some((promotion) => promotion.id === started.id)
    ? promotions
    : [started, ...promotions]

/**
 * Who started a promotion, in words: "you", a member by their email when the members are known,
 * "a member" when not, "an owner" for the first owner, who has none, and "an agent or process"
 * for one no member started.
 */
export const starterOf = (
  startedBy: MemberId | undefined,
  me: MemberId | undefined,
  members: ReadonlyArray<Member> | undefined,
) => {
  if (startedBy === undefined) {
    return "an agent or process"
  }
  if (startedBy === me) {
    return "you"
  }
  const member = members?.find((each) => each.id === startedBy)
  if (member === undefined) {
    return "a member"
  }
  return member.email ?? (member.role === "owner" ? "an owner" : "a member")
}

// ---- Deploy targets --------------------------------------------------------------------------------

/** Where an App Store Connect app's builds go, in words. */
export const distributionWords: Readonly<Record<"testFlight" | "appStore", string>> = {
  testFlight: "TestFlight",
  appStore: "App Store",
}

/** Whether a deploy target's builds go to App Store review, which needs the release's notes. */
export const goesToReview = (target: DeployTarget) => target.appStore?.distribution === "appStore"

/**
 * The environment a draft of a release's notes is for, by default: the target that goes to App
 * Store review, else the first that goes to an App Store Connect app, else the first.
 */
export const draftEnvironmentOf = (targets: ReadonlyArray<DeployTarget>): EnvironmentKey | undefined =>
  (targets.find(goesToReview) ?? targets.find((target) => target.appStore !== undefined) ?? targets[0])?.environment

// ---- Versions --------------------------------------------------------------------------------------

/** Which part of a version a bump raises. */
export type VersionPart = "patch" | "minor" | "major"

/** A version bumped: `1.4.2` is `1.4.3`, `1.5.0` or `2.0.0`, the parts after the one raised reset. */
export const bumpedVersion = (version: string, part: VersionPart) => {
  const [major = 0, minor = 0, patch = 0] = version.split(".").map(Number)
  switch (part) {
    case "patch":
      return `${major}.${minor}.${patch + 1}`
    case "minor":
      return `${major}.${minor + 1}.0`
    case "major":
      return `${major + 1}.0.0`
  }
}

/** The release a component's next build will be: `1.4.0+58` after build 57. */
export const nextReleaseOf = (line: ComponentVersion) => `${line.version}+${line.lastBuild + 1}`
