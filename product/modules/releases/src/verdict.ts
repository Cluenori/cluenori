import type { OperationRow, OperationTable } from "@cluenori/signals"
import { slowerOf } from "@cluenori/signals"

import type { ComparedOperation, Verdict } from "./release.ts"

// What makes a release better or worse than the one before it: the one place these rules live.

/** An operation compares once it ran this many times in both releases: fewer say little. */
export const comparedFrom = 100

/** A release with nothing worse is judged once it ran this long. */
export const judgedAfterMs = 3_600_000

/**
 * An operation fails more when it failed at least 5 times, at least 2% of the time, and at least
 * three times as often as in the release before; as the Failing incident compares with the usual.
 */
export const failingMoreRule = { failures: 5, rate: 0.02, times: 3 } as const

const rateOf = (count: number, errors: number) => (count === 0 ? 0 : errors / count)

// Whether `now` runs, `nowErrors` of them failed, fail more than `before` runs, `beforeErrors` failed.
const failsMore = (now: number, nowErrors: number, before: number, beforeErrors: number) =>
  nowErrors >= failingMoreRule.failures &&
  rateOf(now, nowErrors) >= failingMoreRule.rate &&
  rateOf(now, nowErrors) >= failingMoreRule.times * rateOf(before, beforeErrors)

// The biggest change first: of the p95 against the one before, and of the failure rate.
const byP95Ratio = (left: ComparedOperation, right: ComparedOperation) =>
  right.p95Ms / right.previousP95Ms - left.p95Ms / left.previousP95Ms
const byRateChange = (left: ComparedOperation, right: ComparedOperation) =>
  rateOf(right.count, right.errors) -
  rateOf(right.previousCount, right.previousErrors) -
  (rateOf(left.count, left.errors) - rateOf(left.previousCount, left.previousErrors))

/** What moved between two releases' operations. */
export interface Comparison {
  readonly slower: ReadonlyArray<ComparedOperation>
  readonly faster: ReadonlyArray<ComparedOperation>
  readonly failingMore: ReadonlyArray<ComparedOperation>
  readonly failingLess: ReadonlyArray<ComparedOperation>
  /** Operations compared: those that ran 100 times in both. */
  readonly compared: number
  readonly newOperations: ReadonlyArray<OperationRow["operation"]>
}

/**
 * Compares a release's operations with the release before it's, each table of one component and
 * environment. Slower and faster use the same rule as Today's "slower": a p95 at least 1.5 times
 * the other's, and 100 ms more.
 */
export const compare = (current: OperationTable, previous: OperationTable): Comparison => {
  const before = new Map(previous.rows.map((row) => [row.operation, row] as const))
  const compared = current.rows.flatMap((row): ReadonlyArray<ComparedOperation> => {
    const earlier = before.get(row.operation)
    return earlier === undefined || row.count < comparedFrom || earlier.count < comparedFrom
      ? []
      : [
          {
            operation: row.operation,
            count: row.count,
            errors: row.errors,
            p95Ms: row.p95Ms,
            previousCount: earlier.count,
            previousErrors: earlier.errors,
            previousP95Ms: earlier.p95Ms,
          },
        ]
  })
  return {
    slower: compared
      .filter((row) => slowerOf({ lastDayP95Ms: row.p95Ms, usualP95Ms: row.previousP95Ms }) !== undefined)
      .toSorted(byP95Ratio),
    faster: compared
      .filter((row) => slowerOf({ lastDayP95Ms: row.previousP95Ms, usualP95Ms: row.p95Ms }) !== undefined)
      .toSorted((left, right) => byP95Ratio(right, left)),
    failingMore: compared
      .filter((row) => failsMore(row.count, row.errors, row.previousCount, row.previousErrors))
      .toSorted(byRateChange),
    failingLess: compared
      .filter((row) => failsMore(row.previousCount, row.previousErrors, row.count, row.errors))
      .toSorted((left, right) => byRateChange(right, left)),
    compared: compared.length,
    newOperations: current.rows.filter((row) => !before.has(row.operation)).map((row) => row.operation),
  }
}

/**
 * The verdict on a release that ran for `ranMs` with `newErrors` errors first seen in it, from its
 * comparison with the release before it; `first` without one. Anything worse makes it worse at once;
 * otherwise it is too early until it ran an hour and an operation compares.
 */
export const verdictOf = (comparison: Comparison | undefined, newErrors: number, ranMs: number): Verdict => {
  if (comparison === undefined) {
    return "first"
  }
  if (comparison.slower.length > 0 || comparison.failingMore.length > 0 || newErrors > 0) {
    return "worse"
  }
  if (ranMs < judgedAfterMs || comparison.compared === 0) {
    return "tooEarly"
  }
  return comparison.faster.length > 0 || comparison.failingLess.length > 0 ? "better" : "same"
}
