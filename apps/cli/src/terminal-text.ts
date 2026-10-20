import { DateTime } from "effect"

// What the CLI prints is read by people and agents at a terminal. It doesn't depend on the
// machine's locale or time zone: numbers are written the en-US way, and times in UTC.
const wholeNumbers = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 })
const percent = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 })

/** `12,408`. */
export const count = (value: number) => wholeNumbers.format(value)

/** `0.4%` of `whole`, or `0%` when there is no whole. */
export const share = (part: number, whole: number) => percent.format(whole === 0 ? 0 : part / whole)

/** A duration as people read it: `0.09ms`, `4.2ms`, `182ms`, `1.2s`. */
export const milliseconds = (value: number) => {
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}s`
  }
  if (value >= 10) {
    return `${value.toFixed(0)}ms`
  }
  if (value >= 1) {
    return `${value.toFixed(1)}ms`
  }
  return `${value.toFixed(2)}ms`
}

/** `2026-10-19 08:15 UTC`. */
export const utcMinute = (time: DateTime.Utc) => `${DateTime.formatIso(time).slice(0, 16).replace("T", " ")} UTC`

/** `2026-10-19 08:15:30 UTC`. */
export const utcSecond = (time: DateTime.Utc) => `${DateTime.formatIso(time).slice(0, 19).replace("T", " ")} UTC`

/** `08:15:30.250`: the time of day in UTC, to the millisecond, for lines of one request. */
export const utcClock = (time: DateTime.Utc) => DateTime.formatIso(time).slice(11, 23)

/** Rows of text as columns: the first left-aligned, the others right-aligned, two spaces apart. */
export const columns = (rows: ReadonlyArray<ReadonlyArray<string>>) => {
  const widths = rows.reduce<Array<number>>(
    (most, row) => row.map((cell, index) => Math.max(most[index] ?? 0, cell.length)),
    [],
  )
  return rows.map((row) =>
    row
      .map((cell, index) => (index === 0 ? cell.padEnd(widths[index] ?? 0) : cell.padStart(widths[index] ?? 0)))
      .join("  ")
      .trimEnd(),
  )
}
