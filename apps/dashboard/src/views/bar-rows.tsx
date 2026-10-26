import { cn } from "cn"
import { useCallback, useId, useState } from "react"
import type { KeyboardEvent, MouseEvent, PointerEvent } from "react"

import { count } from "@/lib/format"

/** One row: what it counts, a note under its name, its color, and a value for each column. */
export type BarRow = {
  readonly label: string
  /** Shown under the label, such as "68%" or "no SDK". */
  readonly note?: string
  readonly color: string
  /**
   * One value per column. `undefined` means nothing was reported then, drawn hatched, unlike zero,
   * which leaves the column empty above the baseline.
   */
  readonly values: ReadonlyArray<number | undefined>
  /**
   * The value that fills a row to the top, so rows of the same thing compare: the largest among
   * them. Without it, a row fills to its own largest column.
   */
  readonly most?: number
}

/** A run of the given columns, first to last, that one drawn column stands for. */
export type ColumnSpan = { readonly first: number; readonly last: number }

// Columns narrower than this many pixels are merged with their neighbors.
const narrowest = 6

const arrowMoves: Readonly<Record<string, number>> = { ArrowLeft: -1, ArrowRight: 1 }

/** The width of an element, kept current as it resizes: `ref` goes on the element. */
const useWidth = () => {
  const [width, setWidth] = useState(0)
  // Observes the element once it attaches; the returned cleanup stops when it detaches.
  const ref = useCallback((element: HTMLDivElement) => {
    const observer = new ResizeObserver((entries) => {
      setWidth(entries[0]?.contentRect.width ?? 0)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return { ref, width }
}

// The sum of a run of values; unknown only when every one of them is.
export const sumOf = (values: ReadonlyArray<number | undefined>) =>
  values.every((value) => value === undefined)
    ? undefined
    : values.reduce<number>((sum, value) => sum + (value ?? 0), 0)

/** The largest of a run of values, for merging columns of latency; unknown only when every one is. */
export const largestOf = (values: ReadonlyArray<number | undefined>) =>
  values.every((value) => value === undefined) ? undefined : Math.max(...values.map((value) => value ?? 0))

/**
 * Counts over time as rows of bars that share one time axis: a row per thing counted, each bar as
 * tall as its column's value. Pointing at a column, or moving with the arrow keys, shows every
 * row's value in it. On a narrow screen neighboring columns are merged, and `timeOf` gets the run
 * of columns one bar stands for. With `onPick`, a click or Enter on a column opens that moment;
 * `marked` is the column of the moment open, outlined within the rest, which stay as they are.
 */
export function BarRows({
  rows,
  ticks,
  timeOf,
  label,
  rowHeight = 44,
  format = count,
  combine = sumOf,
  marked,
  onPick,
}: {
  readonly rows: ReadonlyArray<BarRow>
  /** Labels under the chart, by column. */
  readonly ticks: ReadonlyArray<{ readonly column: number; readonly label: string }>
  /** When a run of columns was, for the tooltip. */
  readonly timeOf: (span: ColumnSpan) => string
  /** What the chart shows, for screen readers. */
  readonly label: string
  readonly rowHeight?: number
  /** How the tooltip writes a value: a count by default, or a duration for latency. */
  readonly format?: (value: number) => string
  /** How merged columns become one: added up by default, or the largest, for latency. */
  readonly combine?: (values: ReadonlyArray<number | undefined>) => number | undefined
  /** The given column of the moment open, marked on every row. */
  readonly marked?: number
  /** Opens the moment of a run of columns, the one clicked. */
  readonly onPick?: (span: ColumnSpan) => void
}) {
  const hatch = `${useId().replaceAll(":", "")}-hatch`
  const given = Math.max(...rows.map((row) => row.values.length), 1)
  const { ref, width } = useWidth()
  const group = width === 0 ? 1 : Math.max(1, Math.ceil((given * narrowest) / width))
  const columns = Math.ceil(given / group)
  const merged = rows.map((row) => ({
    ...row,
    values: Array.from({ length: columns }, (_, column) =>
      combine(row.values.slice(column * group, (column + 1) * group)),
    ),
  }))
  const spanOf = (column: number): ColumnSpan => ({
    first: column * group,
    last: Math.min(given, (column + 1) * group) - 1,
  })
  const [pointed, setPointed] = useState<number | undefined>(undefined)
  const slot = 100 / columns
  // Bars take most of their column; the gap shrinks as columns get narrow.
  const gap = columns > 48 ? 0.2 : 0.28

  const point = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    setPointed(Math.min(columns - 1, Math.max(0, Math.floor(((event.clientX - box.left) / box.width) * columns))))
  }
  // The column a keyboard or a screen reader reads: the pointed one, or the latest.
  const reading = pointed ?? columns - 1
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" && onPick !== undefined) {
      event.preventDefault()
      onPick(spanOf(reading))
      return
    }
    const by = arrowMoves[event.key]
    const to = { Home: 0, End: columns - 1 }[event.key] ?? (by === undefined ? undefined : reading + by)
    if (to !== undefined) {
      event.preventDefault()
      setPointed(Math.min(columns - 1, Math.max(0, to)))
    }
  }
  const markedColumn = marked === undefined || marked < 0 || marked >= given ? undefined : Math.floor(marked / group)
  const readout = `${timeOf(spanOf(reading))}: ${merged
    .map((row) => {
      const value = row.values[reading]
      return `${row.label} ${value === undefined ? "unknown" : format(value)}`
    })
    .join(", ")}`

  return (
    <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-x-4 sm:grid-cols-[8.5rem_minmax(0,1fr)]">
      <div className="flex flex-col gap-3">
        {rows.map((row) => (
          <div key={row.label} className="flex flex-col justify-end pb-0.5 leading-tight" style={{ height: rowHeight }}>
            <span className="flex items-center gap-2 truncate text-sm">
              <span className="size-2 shrink-0" style={{ backgroundColor: row.color }} />
              {row.label}
            </span>
            {row.note !== undefined && (
              <span className="pl-4 font-mono text-[13px] text-muted-foreground">{row.note}</span>
            )}
          </div>
        ))}
      </div>
      <div
        ref={ref}
        // A slider over the columns: the arrow keys, Home, and End move the reading, and a screen
        // reader says the column's time and every row's value.
        role="slider"
        tabIndex={0}
        aria-label={onPick === undefined ? label : `${label} Enter opens the moment shown.`}
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={columns - 1}
        aria-valuenow={reading}
        aria-valuetext={readout}
        className={cn(
          "relative touch-pan-y outline-offset-4 select-none focus-visible:outline-1",
          onPick !== undefined && "cursor-pointer",
        )}
        {...(onPick === undefined
          ? {}
          : {
              onClick: (event: MouseEvent<HTMLDivElement>) => {
                const box = event.currentTarget.getBoundingClientRect()
                const column = Math.min(
                  columns - 1,
                  Math.max(0, Math.floor(((event.clientX - box.left) / box.width) * columns)),
                )
                onPick(spanOf(column))
              },
            })}
        onPointerMove={point}
        onPointerDown={point}
        onPointerLeave={() => setPointed(undefined)}
        onKeyDown={move}
        onFocus={() => setPointed(reading)}
        onBlur={() => setPointed(undefined)}
      >
        {markedColumn !== undefined && (
          <span
            aria-hidden
            data-marked
            className="pointer-events-none absolute -inset-y-1 border-x border-foreground/60 bg-foreground/[0.08]"
            style={{ left: `${markedColumn * slot}%`, width: `max(3px, ${slot}%)` }}
          />
        )}
        {pointed !== undefined && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 bg-foreground/[0.06]"
            style={{ left: `${pointed * slot}%`, width: `${slot}%` }}
          />
        )}
        <div className="flex flex-col gap-3">
          {merged.map((row, index) => {
            const pattern = `${hatch}-${index}`
            const most = Math.max(
              1,
              ...(row.most === undefined
                ? row.values.map((value) => value ?? 0)
                : [combine(Array.from({ length: group }, () => row.most)) ?? 0]),
            )
            return (
              <svg
                key={row.label}
                width="100%"
                height={rowHeight}
                aria-hidden
                className="block overflow-visible border-b border-foreground/15"
              >
                <defs>
                  <pattern
                    id={pattern}
                    width="5"
                    height="5"
                    patternUnits="userSpaceOnUse"
                    patternTransform="rotate(45)"
                  >
                    <line
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="5"
                      stroke="var(--muted-foreground)"
                      strokeOpacity="0.35"
                      strokeWidth="1"
                    />
                  </pattern>
                </defs>
                {row.values.map((value, column) => {
                  const x = `${column * slot + (slot * gap) / 2}%`
                  const barWidth = `${slot * (1 - gap)}%`
                  if (value === undefined) {
                    return (
                      <rect
                        key={column}
                        x={`${column * slot}%`}
                        width={`${slot}%`}
                        y={0}
                        height={rowHeight}
                        fill={`url(#${pattern})`}
                      />
                    )
                  }
                  if (value === 0) {
                    return null
                  }
                  const height = Math.max(2, (value / most) * (rowHeight - 4))
                  return (
                    <rect key={column} x={x} width={barWidth} y={rowHeight - height} height={height} fill={row.color} />
                  )
                })}
              </svg>
            )
          })}
        </div>
        <div aria-hidden className="relative mt-2 h-5 font-mono text-[13px] text-muted-foreground">
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
        {pointed !== undefined && (
          <div
            className={cn(
              "pointer-events-none absolute top-0 z-10 min-w-40 border bg-popover px-3 py-2 text-[13px] shadow-lg",
              (pointed + 0.5) / columns > 0.6 && "-translate-x-full",
            )}
            style={{
              left:
                (pointed + 0.5) / columns > 0.6
                  ? `calc(${pointed * slot}% - 8px)`
                  : `calc(${(pointed + 1) * slot}% + 8px)`,
            }}
          >
            <span className="mb-1 block font-mono text-muted-foreground">{timeOf(spanOf(pointed))}</span>
            {merged.map((row) => {
              const value = row.values[pointed]
              return (
                <span key={row.label} className="flex items-center gap-2">
                  <span className="size-2 shrink-0" style={{ backgroundColor: row.color }} />
                  <span className="flex-1">{row.label}</span>
                  <span className="font-mono">{value === undefined ? "–" : format(value)}</span>
                </span>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
