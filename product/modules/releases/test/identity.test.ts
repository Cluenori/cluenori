import type { AppStoreVersion, Build } from "@cluenori/app-store-connect"
import type { Tag } from "@cluenori/github"
import { CommitSha } from "@cluenori/github"
import { assert, describe, it } from "@effect/vitest"
import { DateTime } from "effect"

import { pullRequestOf, releaseOfBuild, shaInVersion, stageOf, tagFor, tagSearches } from "../src/identity.ts"

const sha = CommitSha.make("e91f09c1a2b3c4d5e6f708192a3b4c5d6e7f8091")
const tag = (name: string): Tag => ({ name, commit: sha })

const build = (overrides: Partial<Build> = {}): Build => ({
  id: "build-1",
  version: "2.4.0",
  buildNumber: "312",
  uploadedAt: DateTime.makeUnsafe(Date.UTC(2026, 9, 21)),
  processingState: "VALID",
  expired: false,
  ...overrides,
})

const version = (state: string, overrides: Partial<AppStoreVersion> = {}): AppStoreVersion => ({
  id: "version-1",
  version: "2.4.0",
  state,
  createdAt: DateTime.makeUnsafe(Date.UTC(2026, 9, 21)),
  buildNumber: "312",
  ...overrides,
})

// A live version in a phased release in `state`.
const phased = (state: string) => version("READY_FOR_SALE", { phasedRelease: { state, currentDay: 3 } })

describe("A release's identity", () => {
  it("finds a commit SHA inside a version, on its own", () => {
    assert.strictEqual(shaInVersion("2026.10.21-e91f09c"), "e91f09c")
    assert.strictEqual(shaInVersion("v1.2.3+abcdef1234"), "abcdef1234")
    assert.isUndefined(shaInVersion("2.4.0+312"))
    assert.isUndefined(shaInVersion("2026.10.21"))
    assert.isUndefined(shaInVersion("20261021-1"))
  })

  it("picks the tag named the version, or ending with it after a separator or a v", () => {
    const tags = [tag("dev-2026.10.21-e91f09c"), tag("prod-2026.10.21-e91f09c")]

    assert.strictEqual(tagFor(tags, "2026.10.21-e91f09c")?.name, "dev-2026.10.21-e91f09c")
    assert.strictEqual(tagFor([tag("v2.4.0"), tag("2.4.0")], "2.4.0")?.name, "2.4.0")
    assert.strictEqual(tagFor([tag("v2.4.0")], "2.4.0")?.name, "v2.4.0")
    assert.isUndefined(tagFor([tag("12.4.0"), tag("2.4.0-rc1")], "2.4.0"))
  })

  it("searches an app's release by itself, then by its marketing version", () => {
    assert.deepStrictEqual(tagSearches("2.4.0+312"), ["2.4.0+312", "2.4.0"])
    assert.deepStrictEqual(tagSearches("2026.10.21-e91f09c"), ["2026.10.21-e91f09c"])
  })

  it("reads the pull request a merge or a squash names on its first line", () => {
    assert.strictEqual(pullRequestOf("Merge pull request #12 from owner/branch\n\nDetails"), 12)
    assert.strictEqual(pullRequestOf("Record a media job's failed outcome (#41)"), 41)
    assert.isUndefined(pullRequestOf("Fix #12 in the exporter"))
    assert.isUndefined(pullRequestOf("Bump version\n\n(#7)"))
  })

  it("names an app's build as the release it reports", () => {
    assert.strictEqual(releaseOfBuild(build()), "2.4.0+312")
  })
})

describe("A build's stage in App Store Connect", () => {
  it("follows processing first", () => {
    assert.strictEqual(stageOf(build({ processingState: "PROCESSING" }), version("READY_FOR_SALE")), "processing")
    assert.strictEqual(stageOf(build({ processingState: "INVALID" }), undefined), "failed")
  })

  it("is in TestFlight without an App Store version, until it expires", () => {
    assert.strictEqual(stageOf(build(), undefined), "testing")
    assert.strictEqual(stageOf(build({ expired: true }), undefined), "expired")
  })

  it("follows the App Store version that ships it through review and release", () => {
    assert.strictEqual(stageOf(build(), version("WAITING_FOR_REVIEW")), "waitingForReview")
    assert.strictEqual(stageOf(build(), version("IN_REVIEW")), "inReview")
    assert.strictEqual(stageOf(build(), version("METADATA_REJECTED")), "rejected")
    assert.strictEqual(stageOf(build(), version("PENDING_DEVELOPER_RELEASE")), "pendingRelease")
    assert.strictEqual(stageOf(build(), version("READY_FOR_SALE")), "live")
    assert.strictEqual(stageOf(build(), version("REPLACED_WITH_NEW_VERSION")), "replaced")
    assert.strictEqual(stageOf(build(), version("SOMETHING_NEW")), "other")
  })

  it("is releasing while its phased release is active or paused, and live after", () => {
    assert.strictEqual(stageOf(build(), phased("ACTIVE")), "releasing")
    assert.strictEqual(stageOf(build(), phased("PAUSED")), "releasing")
    assert.strictEqual(stageOf(build(), phased("COMPLETE")), "live")
  })
})
