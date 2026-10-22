import { CommitSha } from "@bagatka/github"
import { Instant, ComponentKey, ReleaseVersion } from "@cluenori/foundation"
import { Schema } from "effect"

/** A component version, `MAJOR.MINOR.PATCH`, such as `1.4.0`: what its next builds are a release of. */
export const SemanticVersion = Schema.String.check(
  Schema.isPattern(/^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/, {
    expected: "MAJOR.MINOR.PATCH, such as 1.4.0",
  }),
).pipe(Schema.brand("SemanticVersion"))
export type SemanticVersion = typeof SemanticVersion.Type

/** A build number, from 1: the part after `+` in a release. */
export const BuildNumber = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(999_999_999))
export type BuildNumber = typeof BuildNumber.Type

const partsOf = (version: SemanticVersion) => version.split(".").map(Number)

/** How `left` orders against `right`: negative when it is lower, 0 when the same, positive when higher. */
export const compareVersions = (left: SemanticVersion, right: SemanticVersion) => {
  const ours = partsOf(left)
  const theirs = partsOf(right)
  const differing = ours.findIndex((part, index) => part !== theirs[index])
  return differing === -1 ? 0 : (ours[differing] ?? 0) - (theirs[differing] ?? 0)
}

/** The release a version's build is: `1.4.0+58`. */
export const releaseOf = (version: SemanticVersion, build: number) => ReleaseVersion.make(`${version}+${build}`)

/**
 * A component's version line: the version its next builds are numbered in, the last build number
 * given (0 before the first), and when a member last set it. Build numbers never go back: a new
 * version continues them.
 */
export const ComponentVersion = Schema.Struct({
  component: ComponentKey,
  version: SemanticVersion,
  lastBuild: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  setAt: Instant,
}).annotate({ identifier: "ComponentVersion" })
export type ComponentVersion = typeof ComponentVersion.Type

/** The project's components' version lines, by component; one never set isn't listed. */
export const ComponentVersions = Schema.Struct({ versions: Schema.Array(ComponentVersion) }).annotate({
  identifier: "ComponentVersions",
})
export type ComponentVersions = typeof ComponentVersions.Type

/**
 * Set a component's version: the same or higher than its current one, such as a bump of its patch,
 * minor or major. `firstBuild` raises where its build numbers continue from, above the last given,
 * such as for an app whose store builds were numbered before Cluenori numbered them.
 */
export const SetVersion = Schema.Struct({
  component: ComponentKey,
  version: SemanticVersion,
  firstBuild: Schema.optionalKey(BuildNumber),
}).annotate({ identifier: "SetVersion" })
export type SetVersion = typeof SetVersion.Type

/** The version wasn't set, for the reason given: lower than the current one, or a first build already given. */
export class VersionRefused extends Schema.TaggedError<VersionRefused>()("VersionRefused", {
  reason: Schema.String,
}) {}

/** The component has no version yet, so its commits can't be numbered: a member sets it first. */
export class VersionNotSet extends Schema.TaggedError<VersionNotSet>()("VersionNotSet", {
  component: ComponentKey,
}) {}

/** Number `commit`: what a component's CI asks before it builds. */
export const NumberCommit = Schema.Struct({ commit: CommitSha }).annotate({ identifier: "NumberCommit" })
export type NumberCommit = typeof NumberCommit.Type

/** The release a commit is, for good: built again, for any environment, it is the same release. */
export const NumberedRelease = Schema.Struct({
  release: ReleaseVersion,
  version: SemanticVersion,
  build: BuildNumber,
  commit: CommitSha,
}).annotate({ identifier: "NumberedRelease" })
export type NumberedRelease = typeof NumberedRelease.Type
