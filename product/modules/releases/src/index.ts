/**
 * Releases: each component's versions, as its telemetry, its CI's deploy reports, and App Store
 * Connect know them, each compared with the one before it, with its commit and what changed in its
 * repository since; and promoting one to an environment, by starting its deploy workflow on GitHub.
 * Reads Signals' counts and errors by release and the project's incidents; keeps commits, changes,
 * store builds, deploys and promotions of its own.
 */
export {
  ChangedCommit,
  ComparedOperation,
  LastReport,
  LastReportQuery,
  MergedPullRequest,
  PhasedRelease,
  ReleaseChanges,
  ReleaseCommit,
  ReleaseDetail,
  ReleaseKey,
  ReleaseList,
  ReleaseListQuery,
  ReleaseNotFound,
  ReleaseReport,
  ReleaseSource,
  ReleaseSummary,
  ReportedCommit,
  SourceProblem,
  StoreBuild,
  StoreStage,
  Verdict,
} from "./release.ts"
export {
  DraftNotes,
  DraftUnavailable,
  NoteLocale,
  NotesDraft,
  NotesStyle,
  NoteText,
  ReleaseNote,
  ReleaseNotes,
  SaveNotes,
} from "./note.ts"
export { defaultNotesStyle } from "./notes.ts"
export {
  BuildNumber,
  ComponentVersion,
  ComponentVersions,
  compareVersions,
  NumberCommit,
  NumberedRelease,
  SemanticVersion,
  SetVersion,
  VersionNotSet,
  VersionRefused,
} from "./version.ts"
export { localLabel, ResolvedRunner, RunnerAnswer, RunnerQuery } from "./runner.ts"
export {
  AppStoreReleaseType,
  AppStoreSubmission,
  hasEnded,
  PromoteRelease,
  Promotion,
  PromotionFix,
  PromotionId,
  PromotionInProgress,
  PromotionNotFound,
  PromotionReason,
  PromotionRefused,
  PromotionRun,
  PromotionState,
  PromotionUnavailable,
  ReleaseApproved,
  Runner,
} from "./promotion.ts"
export {
  NotesStyleSet,
  PromotionEnded,
  PromotionReleased,
  PromotionStarted,
  PromotionSubmitted,
  ReleaseNotesSaved,
  ReleaseNumbered,
  VersionSet,
} from "./releases-activity.ts"
export type { ReleasesSettings } from "./sources.ts"
export { ReleaseFilters, ReleasesGroup } from "./releases-api.ts"
export { ReleaseRecords } from "./records.ts"
export { releasesLayer, releasesModule } from "./releases-module.ts"
export { ReleaseSources } from "./sources.ts"
export { comparedFrom, failingMoreRule, judgedAfterMs } from "./verdict.ts"
