/**
 * Releases: each component's versions, as its telemetry, its CI's deploy reports, and App Store
 * Connect know them, each compared with the one before it, with its commit and what changed in its
 * repository since. Reads Signals' counts and errors by release and the project's incidents; keeps
 * commits, changes, store builds and deploys of its own.
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
export type { ReleasesSettings } from "./sources.ts"
export { ReleaseFilters, ReleasesGroup } from "./releases-api.ts"
export { ReleaseRecords } from "./records.ts"
export { releasesLayer, releasesModule } from "./releases-module.ts"
export { ReleaseSources } from "./sources.ts"
export { comparedFrom, failingMoreRule, judgedAfterMs } from "./verdict.ts"
