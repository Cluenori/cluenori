// Latency on the one scale every view uses: a place on a log scale from 1 ms to 10 s, where 10 ms,
// 100 ms, and 1 s are equal steps.

const scaleFrom = 1
const scaleTo = 10_000

const logOf = (milliseconds: number) => Math.log10(Math.max(milliseconds, 0.01))

/** Where a duration sits on the scale from 1 ms to 10 s: 0 at the bottom, 1 at the top. */
export const speedPlace = (milliseconds: number) => {
  const place = (logOf(milliseconds) - logOf(scaleFrom)) / (logOf(scaleTo) - logOf(scaleFrom))
  return Math.min(1, Math.max(0, place))
}
