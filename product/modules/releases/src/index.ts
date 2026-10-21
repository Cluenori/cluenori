/**
 * Releases: each component's versions, as its telemetry reports them, each compared with the one
 * before it, so a deploy that made things worse shows. Reads Signals' counts by release and the
 * project's incidents; keeps nothing of its own.
 */
export {
  ComparedOperation,
  ReleaseDetail,
  ReleaseKey,
  ReleaseList,
  ReleaseListQuery,
  ReleaseNotFound,
  ReleaseSummary,
  Verdict,
} from "./release.ts"
export { ReleaseFilters, ReleasesGroup } from "./releases-api.ts"
export { releasesModule } from "./releases-module.ts"
export { comparedFrom, failingMoreRule, judgedAfterMs } from "./verdict.ts"
