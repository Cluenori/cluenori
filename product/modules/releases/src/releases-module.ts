import { defineModule, moduleAction, moduleIngest, moduleQuery } from "@cluenori/foundation"
import { Effect, Layer, Schema } from "effect"

import { DraftNotes, DraftUnavailable, NotesDraft, NotesStyle, ReleaseNotes, SaveNotes } from "./note.ts"
import { draftNotes, notesStyle, saveNotes, setNotesStyle } from "./notes.ts"
import { componentVersions, numberCommit, setVersion } from "./numbering.ts"
import { followPromotions, promote, promoteLatest, releaseApproved } from "./promote.ts"
import {
  PromoteLatest,
  PromoteRelease,
  Promotion,
  PromotionInProgress,
  PromotionNotFound,
  PromotionRefused,
  PromotionUnavailable,
  ReleaseApproved,
} from "./promotion.ts"
import { ReleaseRecords } from "./records.ts"
import {
  LastReport,
  LastReportQuery,
  ReleaseDetail,
  ReleaseKey,
  ReleaseList,
  ReleaseListQuery,
  ReleaseNotFound,
  ReleaseReport,
} from "./release.ts"
import { ReleasesGroup } from "./releases-api.ts"
import { listReleases, releaseDetail } from "./releases.ts"
import { lastDeploy, reportDeploy } from "./report.ts"
import { resolveRunner } from "./resolve-runner.ts"
import { RunnerAnswer, RunnerQuery } from "./runner.ts"
import type { ReleasesSettings } from "./sources.ts"
import { ReleaseSources } from "./sources.ts"
import { syncReleases } from "./sync.ts"
import {
  ComponentVersion,
  ComponentVersions,
  NumberCommit,
  NumberedRelease,
  SetVersion,
  VersionNotSet,
  VersionRefused,
} from "./version.ts"

/**
 * The module's own services in a project's Durable Object: its records, on the project's database,
 * and its client for App Store Connect, from the settings the host reads. GitHub is the host's.
 */
export const releasesLayer = (settings: ReleasesSettings) =>
  Layer.mergeAll(ReleaseRecords.layer, ReleaseSources.layer(settings))

/**
 * The module, as the host serves it: its queries, actions and ingest writes run in the project's
 * Durable Object, its records and clients are built there from its settings, and its background
 * work finds commits and store builds, and follows promotions, on the project's alarm.
 */
export const releasesModule = defineModule({
  id: "releases",
  scope: "project",
  queries: {
    /** The releases of a period, each compared with the one before it. Reads only. */
    list: moduleQuery({ input: ReleaseListQuery, success: ReleaseList, error: Schema.Never, run: listReleases }),
    /** One release compared with the one before it. Fails with `ReleaseNotFound`. Reads only. */
    release: moduleQuery({ input: ReleaseKey, success: ReleaseDetail, error: ReleaseNotFound, run: releaseDetail }),
    /** The components' versions: what their next builds are numbered in. Reads only. */
    versions: moduleQuery({
      input: Schema.Struct({}),
      success: ComponentVersions,
      error: Schema.Never,
      run: () => componentVersions,
    }),
    /** How the project's release notes read, for drafts to follow. Reads only. */
    notesStyle: moduleQuery({
      input: Schema.Struct({}),
      success: NotesStyle,
      error: Schema.Never,
      run: () => notesStyle,
    }),
  },
  api: ReleasesGroup,
  layer: releasesLayer,
  background: syncReleases.pipe(Effect.andThen(followPromotions)),
  ingest: {
    /** A deploy, from `cluenori-release`. */
    report: moduleIngest({ input: ReleaseReport, success: Schema.Void, error: Schema.Never, run: reportDeploy }),
    /** The last deploy reported, which the next report's commits start after. */
    last: moduleIngest({ input: LastReportQuery, success: LastReport, error: Schema.Never, run: lastDeploy }),
    /** The release a commit is, from `cluenori-release number`: numbered once, for good. */
    number: moduleIngest({ input: NumberCommit, success: NumberedRelease, error: VersionNotSet, run: numberCommit }),
    /** Where a build runs for a CI told `auto`, from `cluenori-release runner`. */
    runner: moduleIngest({ input: RunnerQuery, success: RunnerAnswer, error: Schema.Never, run: resolveRunner }),
  },
  actions: {
    /**
     * Starts a release's deploy workflow for an environment, for the member who asks. Fails with
     * `ReleaseNotFound`, `PromotionInProgress`, `PromotionRefused` or `PromotionUnavailable`.
     */
    promote: moduleAction({
      input: PromoteRelease,
      success: Promotion,
      error: Schema.Union([ReleaseNotFound, PromotionInProgress, PromotionRefused, PromotionUnavailable]),
      run: promote,
    }),
    /** Numbers a commit with no release yet, the default branch's newest unless given, and promotes it. */
    promoteLatest: moduleAction({
      input: PromoteLatest,
      success: Promotion,
      error: Schema.Union([ReleaseNotFound, PromotionInProgress, PromotionRefused, PromotionUnavailable]),
      run: promoteLatest,
    }),
    /** Releases an App Store promotion approved in review and waiting for a member. */
    releaseApproved: moduleAction({
      input: ReleaseApproved,
      success: Promotion,
      error: Schema.Union([PromotionNotFound, PromotionRefused, PromotionUnavailable]),
      run: releaseApproved,
    }),
    /** Sets a component's version, which its next builds are numbered in. Fails with `VersionRefused`. */
    setVersion: moduleAction({ input: SetVersion, success: ComponentVersion, error: VersionRefused, run: setVersion }),
    /** Replaces a release's notes. Fails with `ReleaseNotFound`. */
    saveNotes: moduleAction({ input: SaveNotes, success: ReleaseNotes, error: ReleaseNotFound, run: saveNotes }),
    /** Drafts a release's notes with the project's language model; saves nothing. */
    draftNotes: moduleAction({
      input: DraftNotes,
      success: NotesDraft,
      error: Schema.Union([ReleaseNotFound, DraftUnavailable]),
      run: draftNotes,
    }),
    /** Sets how the project's release notes read. */
    setNotesStyle: moduleAction({ input: NotesStyle, success: NotesStyle, error: Schema.Never, run: setNotesStyle }),
  },
})
