import type { AppHealth, LaunchTimes, MemoryUse } from "@cluenori/signals"
import { slowerOf } from "@cluenori/signals"

import type { HealthMeasure, HealthVerdict } from "./app-health.ts"

// What makes a release's app health better or worse than the release before it's: the one place
// these rules live. Launches use the same rule as an operation's "slower" (concept, "Quality: worse
// than usual"); memory and rates have rules of their own, of the same idea.

/** A launch kind compares once it ran this many times, prewarmed ones left out, in both releases. */
export const launchesCompared = 50

/** Memory compares once it was measured this many times in both releases. */
export const memoryCompared = 50

/** Crashes and hangs compare once both releases had this many sessions and MetricKit reported of both. */
export const sessionsCompared = 200

/** Peak memory is higher when its p95 is at least 1.25 times the release before's, and 50 MB more. */
export const memoryRule = { times: 1.25, byBytes: 50_000_000 } as const

/**
 * Crashes or hangs come more often when there were at least 5 of them, at least twice as many per
 * session as in the release before, and at least 2 more per 1,000 sessions.
 */
export const rateRule = { atLeast: 5, times: 2, byPerThousand: 2 } as const

/** A release with nothing worse is judged once it ran this long. */
export const judgedAfterMs = 3_600_000

type Move = "worse" | "better" | "same"

/** How many of `count` there were per 1,000 sessions; absent without sessions. */
export const perThousand = (count: number, sessions: number) => (sessions === 0 ? undefined : (count * 1000) / sessions)

const launchMove = (current: LaunchTimes | undefined, previous: LaunchTimes | undefined): Move | undefined => {
  if (
    current === undefined ||
    previous === undefined ||
    current.launches < launchesCompared ||
    previous.launches < launchesCompared
  ) {
    return undefined
  }
  if (slowerOf({ lastDayP95Ms: current.firstFrameP95Ms, usualP95Ms: previous.firstFrameP95Ms }) !== undefined) {
    return "worse"
  }
  if (slowerOf({ lastDayP95Ms: previous.firstFrameP95Ms, usualP95Ms: current.firstFrameP95Ms }) !== undefined) {
    return "better"
  }
  return "same"
}

const higher = (bytes: number, than: number) => bytes >= than * memoryRule.times && bytes - than >= memoryRule.byBytes

const memoryMove = (current: MemoryUse | undefined, previous: MemoryUse | undefined): Move | undefined => {
  if (
    current === undefined ||
    previous === undefined ||
    current.samples < memoryCompared ||
    previous.samples < memoryCompared
  ) {
    return undefined
  }
  if (higher(current.peakP95Bytes, previous.peakP95Bytes)) {
    return "worse"
  }
  if (higher(previous.peakP95Bytes, current.peakP95Bytes)) {
    return "better"
  }
  return "same"
}

// Whether `count` in `sessions` is more often than `before` in `beforeSessions`.
const moreOften = (count: number, sessions: number, before: number, beforeSessions: number) => {
  const rate = (count * 1000) / sessions
  const earlier = (before * 1000) / beforeSessions
  return count >= rateRule.atLeast && rate >= rateRule.times * earlier && rate - earlier >= rateRule.byPerThousand
}

const rateMove = (current: AppHealth, previous: AppHealth, kind: "crashes" | "hangs"): Move | undefined => {
  const now = current.diagnostics
  const before = previous.diagnostics
  if (
    now === undefined ||
    before === undefined ||
    current.sessions < sessionsCompared ||
    previous.sessions < sessionsCompared
  ) {
    return undefined
  }
  if (moreOften(now[kind], current.sessions, before[kind], previous.sessions)) {
    return "worse"
  }
  if (moreOften(before[kind], previous.sessions, now[kind], current.sessions)) {
    return "better"
  }
  return "same"
}

/** What moved between two releases' health, and how many measures compared at all. */
export interface HealthComparison {
  readonly worse: ReadonlyArray<HealthMeasure>
  readonly better: ReadonlyArray<HealthMeasure>
  readonly compared: number
}

/** Compares a release's health with the release before it's, measure by measure. */
export const compareHealth = (current: AppHealth, previous: AppHealth): HealthComparison => {
  const moves: ReadonlyArray<readonly [HealthMeasure, Move | undefined]> = [
    ["coldLaunch", launchMove(current.cold, previous.cold)],
    ["warmLaunch", launchMove(current.warm, previous.warm)],
    ["memory", memoryMove(current.memory, previous.memory)],
    ["crashes", rateMove(current, previous, "crashes")],
    ["hangs", rateMove(current, previous, "hangs")],
  ]
  return {
    worse: moves.flatMap(([measure, move]) => (move === "worse" ? [measure] : [])),
    better: moves.flatMap(([measure, move]) => (move === "better" ? [measure] : [])),
    compared: moves.filter(([, move]) => move !== undefined).length,
  }
}

/**
 * The verdict on a release that ran for `ranMs`, from its comparison with the release before it;
 * `first` without one. Anything worse makes it worse at once; otherwise it is too early until it ran
 * an hour and a measure compares.
 */
export const healthVerdictOf = (
  current: AppHealth,
  comparison: HealthComparison | undefined,
  ranMs: number,
): HealthVerdict => {
  if (current.sessions === 0 && current.cold === undefined && current.warm === undefined) {
    return "unmeasured"
  }
  if (comparison === undefined) {
    return "first"
  }
  if (comparison.worse.length > 0) {
    return "worse"
  }
  if (ranMs < judgedAfterMs || comparison.compared === 0) {
    return "tooEarly"
  }
  return comparison.better.length > 0 ? "better" : "same"
}
