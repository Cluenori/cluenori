import { Duration } from "effect"

import type { Evidence } from "./incident.ts"

// ---- Failing ----------------------------------------------------------------------------------

/** The window the failing detector looks at, back from now. */
export const failingWindow = Duration.minutes(15)

/** The window an operation's usual error rate comes from, ending an hour before it is learned. */
export const usualWindow = Duration.days(7)

// At least this many failures, so one failed request at night isn't an incident.
const failingMinimum = 5

/**
 * Whether an operation is failing: over the window, at least 5 failed, at least 2% of all, and at
 * least three times its usual error rate.
 */
export const isFailing = (counted: { readonly count: number; readonly errors: number }, usualRate: number) => {
  const rate = counted.count === 0 ? 0 : counted.errors / counted.count
  return counted.errors >= failingMinimum && rate >= 0.02 && rate >= 3 * usualRate
}

// ---- Stopped ----------------------------------------------------------------------------------

// Not learned: an operation that runs regularly isn't a job until someone says so. Guessing from
// its history alerted about an endpoint people call every half hour, and every alert must be real.
// Stopped incidents opened before stay readable; none open now.

// ---- Quiet: a guess, never an incident ---------------------------------------------------------

/**
 * The windows how often an operation runs is guessed from, back from now, each with the most minutes
 * it may have run in to be looked at: two days for one that runs every 15 minutes or less often, and
 * the last 6 hours for one that runs every 5 to 15 minutes. Busier operations cost a row a minute,
 * and run too often to have a rhythm worth telling.
 */
export const rhythmWindows = [
  { window: Duration.days(2), atMost: 200 },
  { window: Duration.hours(6), atMost: 72 },
] as const

// A rhythm needs this many runs, at least this far apart, most within a quarter of the usual gap.
const rhythmRuns = 6
const shortestGap = Duration.toMillis(Duration.minutes(5))
const regularShare = 0.8

// Telemetry arrives a minute or two after it happens; a late run gets this much more.
const arrivalGrace = Duration.toMillis(Duration.minutes(5))

/**
 * The gap an operation usually runs at, guessed from the starts of the minutes it ran in, oldest
 * first: the median gap between them, when it ran at least 6 times, at least 5 minutes apart, and 80%
 * of its gaps are within a quarter of the median. Undefined when it has no rhythm. A guess: an
 * endpoint an app calls every half hour has one too, so it only ever says "quiet", never "stopped".
 */
export const usualGapOf = (minutes: ReadonlyArray<number>): number | undefined => {
  if (minutes.length < rhythmRuns) {
    return undefined
  }
  const gaps = minutes.slice(1).map((minute, index) => minute - (minutes[index] ?? minute))
  const sorted = gaps.toSorted((left, right) => left - right)
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0
  if (median < shortestGap) {
    return undefined
  }
  const regular = gaps.filter((gap) => Math.abs(gap - median) <= median / 4).length
  return regular >= regularShare * gaps.length ? median : undefined
}

/** When an operation that last ran at `lastRanAt` and usually every `gapMs` is quiet: two gaps later, and a little. */
export const quietAt = (lastRanAt: number, gapMs: number) => lastRanAt + 2 * gapMs + arrivalGrace

// ---- Down -------------------------------------------------------------------------------------

/** How many failed checks in a row open a down incident. */
export const downAfter = 2

/** How long a check waits for an answer. */
export const checkTimeout = Duration.seconds(10)

// ---- An incident's life -----------------------------------------------------------------------

/** How long a problem is gone before its incident resolves. */
export const resolveAfter = Duration.minutes(10)

/** How soon a problem back after its incident resolved reopens it. */
export const reopenWithin = Duration.minutes(30)

/** How many times worse than last told a failure rate is before an incident worsens. */
export const worseTimes = 2

// ---- Words ------------------------------------------------------------------------------------

// `18%`, `2.5%`, `0.1%`; `none` for 0. Fixed digits, the same on every machine.
const percent = (rate: number) => {
  if (rate === 0) {
    return "none"
  }
  const value = rate * 100
  return `${value.toFixed(value >= 10 ? 0 : 1).replace(/\.0$/, "")}%`
}

// `hour`, `6 hours`, `15 minutes`.
const every = (gapMs: number) => {
  const minutes = Math.max(1, Math.round(gapMs / 60_000))
  if (minutes % 60 === 0) {
    const hours = minutes / 60
    return hours === 1 ? "hour" : `${hours} hours`
  }
  return minutes === 1 ? "minute" : `${minutes} minutes`
}

/**
 * What is wrong, in words without times, which depend on who reads them:
 * - `https://api.notes.app/health is down: HTTP 503`
 * - `POST /api/export: 18% failed, usually 0.1%`
 * - `cleanup.run stopped: it usually runs every hour`
 */
export const titleOf = (evidence: Evidence) => {
  switch (evidence._tag) {
    case "down":
      return `${evidence.url} is down: ${evidence.problem}`
    case "failing":
      return `${evidence.operation}: ${percent(evidence.failed / Math.max(1, evidence.count))} failed, usually ${percent(evidence.usualRate)}`
    case "stopped":
      return `${evidence.operation} stopped: it usually runs every ${every(evidence.usualGapMs)}`
  }
}
