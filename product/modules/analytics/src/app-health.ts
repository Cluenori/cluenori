import { AppHealth, AppRelease } from "@cluenori/signals"
import { Schema } from "effect"

/** What a release's app health is compared by. */
export const HealthMeasure = Schema.Literals(["coldLaunch", "warmLaunch", "memory", "crashes", "hangs"]).annotate({
  identifier: "HealthMeasure",
})
export type HealthMeasure = typeof HealthMeasure.Type

/**
 * How a release's app health compares with the release before it, in the words of a release's
 * verdict: `worse` (a launch slower, memory higher, or crashes or hangs more often), `better`, `same`,
 * `tooEarly` (under an hour, or nothing measured enough in both to compare), `first` (no release
 * before it), `unmeasured` (no sessions or launches from it yet).
 */
export const HealthVerdict = Schema.Literals(["worse", "better", "same", "tooEarly", "first", "unmeasured"]).annotate({
  identifier: "HealthVerdict",
})
export type HealthVerdict = typeof HealthVerdict.Type

const PerThousand = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))

/**
 * One release's app health beside the release before it's: their measures, their crashes and hangs
 * per 1,000 sessions (absent until MetricKit reported of the release, or without sessions), the
 * verdict, and which measures got worse and which better.
 */
export const ReleaseHealth = Schema.Struct({
  release: AppRelease,
  health: AppHealth,
  previousHealth: Schema.optionalKey(AppHealth),
  crashesPerThousand: Schema.optionalKey(PerThousand),
  hangsPerThousand: Schema.optionalKey(PerThousand),
  previousCrashesPerThousand: Schema.optionalKey(PerThousand),
  previousHangsPerThousand: Schema.optionalKey(PerThousand),
  verdict: HealthVerdict,
  worse: Schema.Array(HealthMeasure),
  better: Schema.Array(HealthMeasure),
}).annotate({ identifier: "ReleaseHealth" })
export type ReleaseHealth = typeof ReleaseHealth.Type

/** The app health of the releases that sent anything in a period, the latest first seen first, at most 30. */
export const AppHealthList = Schema.Struct({ releases: Schema.Array(ReleaseHealth) }).annotate({
  identifier: "AppHealthList",
})
export type AppHealthList = typeof AppHealthList.Type
