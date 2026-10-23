// The most bars drawn: more columns are added up a few at a time, so bars stay wide enough to read,
// as 288 five-minute columns of a day would not be.
const mostBars = 72

// A run of counts added up; unknown only when every one of them is.
const sumOf = (values: ReadonlyArray<number | undefined>) =>
  values.every((value) => value === undefined)
    ? undefined
    : values.reduce<number>((sum, value) => sum + (value ?? 0), 0)

/**
 * Counts over time as one bar a column, as tall as how many there were, its top in red for those
 * that failed, on the same scale, at least a sliver when any did, so a failure never hides. A column
 * nothing was reported for is unknown, not none: a pale column the full height, where none leaves
 * the column empty above the baseline. More than 72 columns are drawn added up a few at a time.
 * Labels under it name times, when given. It is a picture: the numbers that matter go beside it, and
 * `label` says what it shows to a screen reader.
 */
export function LoadBars({
  total,
  failed,
  height,
  label,
  ticks,
  color = "var(--blue)",
}: {
  /** How many there were in each column; undefined where nothing was reported. */
  readonly total: ReadonlyArray<number | undefined>
  /** How many of them failed, by the same columns. */
  readonly failed: ReadonlyArray<number | undefined>
  readonly height: number
  readonly label: string
  /** Labels under the chart, by column. */
  readonly ticks?: ReadonlyArray<{ readonly column: number; readonly label: string }>
  readonly color?: string
}) {
  const group = Math.max(1, Math.ceil(total.length / mostBars))
  const merged = (values: ReadonlyArray<number | undefined>) =>
    Array.from({ length: Math.ceil(total.length / group) }, (_, bar) =>
      sumOf(values.slice(bar * group, (bar + 1) * group)),
    )
  const bars = merged(total)
  const failedBars = merged(failed)
  const slot = 100 / Math.max(1, bars.length)
  const most = Math.max(1, ...bars.map((value) => value ?? 0))
  const gap = bars.length > 48 ? 0.2 : 0.3
  return (
    <div role="img" aria-label={label} className="flex flex-col gap-2">
      <svg width="100%" height={height} aria-hidden className="block overflow-visible border-b border-foreground/15">
        {bars.map((value, bar) => {
          const x = `${bar * slot + (slot * gap) / 2}%`
          const width = `${slot * (1 - gap)}%`
          if (value === undefined) {
            return <rect key={bar} x={x} width={width} y={0} height={height} fill="var(--muted)" />
          }
          if (value === 0) {
            return null
          }
          const barHeight = Math.max(2, (value / most) * (height - 2))
          const failures = failedBars[bar] ?? 0
          const failedHeight = failures === 0 ? 0 : Math.min(barHeight, Math.max(2, (failures / most) * (height - 2)))
          return (
            <g key={bar}>
              <rect x={x} width={width} y={height - barHeight} height={barHeight} fill={color} />
              {failedHeight > 0 && (
                <rect x={x} width={width} y={height - barHeight} height={failedHeight} fill="var(--failure)" />
              )}
            </g>
          )
        })}
      </svg>
      {ticks !== undefined && ticks.length > 0 && (
        <div aria-hidden className="relative h-5 font-mono text-[13px] text-muted-foreground">
          {ticks.map((tick) => (
            <span
              key={tick.column}
              className="absolute whitespace-nowrap"
              style={{ left: `${Math.floor(tick.column / group) * slot}%` }}
            >
              {tick.label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
