import { cn } from "cn"
import { ArrowDownIcon, ArrowUpIcon } from "lucide-react"

import { compact, count, duration, share } from "@/lib/format"
import { speedPlace } from "@/lib/speed"
import type { Route } from "@/router"
import { Link } from "@/router"
import { OperationName } from "@/views/operation-name"

/** Latency percentiles, by nearest rank. */
export type Latency = {
  readonly p50Ms: number
  readonly p80Ms: number
  readonly p95Ms: number
  readonly p99Ms: number
}

/** An operation that got slower lately: its p95 over the last day, and its usual p95, the 7 days before. */
export type Slower = { readonly p95Ms: number; readonly usualP95Ms: number }

/**
 * One operation's row: its name, component, environment when the sender gave one, count,
 * failures, average, and latency percentiles, and whether it got slower.
 */
export type OperationLatency = Latency & {
  readonly operation: string
  readonly component: string
  readonly environment?: string
  readonly count: number
  readonly errors: number
  readonly averageMs: number
  readonly slower?: Slower
}

/**
 * A latency as a value beside a cell filled as high as it is on a log scale from 1 ms to 10 s, in
 * the color of what it measures, so a column of them reads at a glance.
 */
export function LatencyCell({
  milliseconds,
  color,
  className,
}: {
  readonly milliseconds: number
  readonly color: string
  readonly className?: string
}) {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <span className="relative h-7 w-3 shrink-0 bg-muted">
        <span
          className="absolute inset-x-0 bottom-0"
          style={{ height: `${Math.max(10, speedPlace(milliseconds) * 100)}%`, backgroundColor: color }}
        />
      </span>
      <span className="font-mono text-[13px] whitespace-nowrap">{duration(milliseconds)}</span>
    </span>
  )
}

/** The tag beside something timed that got slower, with how much in its tooltip. */
export function SlowerTag({ slower }: { readonly slower: Slower }) {
  return (
    <span
      className="shrink-0 font-mono text-xs text-yellow"
      title={`p95 ${duration(slower.p95Ms)} over the last day, usually ${duration(slower.usualP95Ms)}`}
    >
      slower
    </span>
  )
}

/** What operations can be sorted by; `time` is time in total, the count times the average. */
export type SortKey = "time" | "operation" | "p50" | "p80" | "p95" | "p99" | "errors" | "count"
export type Sort = { readonly key: SortKey; readonly descending: boolean }
export const byTimeInTotal: Sort = { key: "time", descending: true }

// The percentiles a phone shows too are marked `always`.
export const percentiles: ReadonlyArray<{
  readonly key: SortKey
  readonly always: boolean
  readonly of: (latency: Latency) => number
}> = [
  { key: "p50", always: true, of: (latency) => latency.p50Ms },
  { key: "p80", always: false, of: (latency) => latency.p80Ms },
  { key: "p95", always: true, of: (latency) => latency.p95Ms },
  { key: "p99", always: false, of: (latency) => latency.p99Ms },
]

const errorRateOf = (row: OperationLatency) => (row.count === 0 ? 0 : row.errors / row.count)

const valueOf = (row: OperationLatency, key: Exclude<SortKey, "operation">) => {
  switch (key) {
    case "time":
      return row.count * row.averageMs
    case "p50":
      return row.p50Ms
    case "p80":
      return row.p80Ms
    case "p95":
      return row.p95Ms
    case "p99":
      return row.p99Ms
    case "errors":
      return errorRateOf(row)
    case "count":
      return row.count
  }
}

// Operation names are machine text, so they sort by code point, not by any locale.
const byName = (left: OperationLatency, right: OperationLatency) => {
  if (left.operation === right.operation) {
    return 0
  }
  return left.operation < right.operation ? -1 : 1
}

/** `rows` in the order of `sort`. */
export const sortOperations = <Row extends OperationLatency>(
  rows: ReadonlyArray<Row>,
  sort: Sort,
): ReadonlyArray<Row> =>
  rows.toSorted((left, right) => {
    const order = sort.key === "operation" ? byName(left, right) : valueOf(left, sort.key) - valueOf(right, sort.key)
    return sort.descending ? -order : order
  })

/**
 * Operations by latency: p50, p80, p95, and p99, each a value beside a cell filled as high as it is
 * on a log scale from 1 ms to 10 s; then the error rate and the count. An operation that got
 * slower says so beside its name, and so does its environment when the rows are of more than one.
 * Every row opens its operation. With `onSort`, a click on a column's name sorts by it.
 */
export function OperationTable<Row extends OperationLatency>({
  rows,
  colorOf,
  linkOf,
  sort,
  onSort,
}: {
  readonly rows: ReadonlyArray<Row>
  readonly colorOf: (component: string) => string
  /** The page each row opens. */
  readonly linkOf: (row: Row) => Route
  readonly sort?: Sort
  readonly onSort?: (sort: Sort) => void
}) {
  const environments = new Set(rows.map((row) => row.environment))
  // On a phone only p50 and p95 show, so operation names fit.
  const grid =
    "grid grid-cols-[minmax(0,1fr)_repeat(2,4.5rem)] gap-x-3 sm:grid-cols-[minmax(0,1fr)_repeat(4,4.5rem)_3.5rem_4rem]"

  const header = (key: SortKey, label: string, className?: string) => {
    if (onSort === undefined || sort === undefined) {
      return <span className={className}>{label}</span>
    }
    const active = sort.key === key
    const Arrow = sort.descending ? ArrowDownIcon : ArrowUpIcon
    return (
      <button
        type="button"
        aria-label={`Sort by ${label}`}
        aria-pressed={active}
        // A click sorts by a column, the largest first, or names A to Z; a second click reverses it.
        onClick={() =>
          onSort(active ? { key, descending: !sort.descending } : { key, descending: key !== "operation" })
        }
        className={cn(
          "flex items-center gap-1 text-left hover:text-foreground focus-visible:text-foreground focus-visible:outline-1 focus-visible:outline-ring",
          active && "text-foreground",
          className,
        )}
      >
        {label}
        {active && <Arrow className="size-3.5" />}
      </button>
    )
  }

  return (
    <div className="flex flex-col">
      <div className={cn(grid, "border-b pb-2 text-sm text-muted-foreground")}>
        {header("operation", "Operation")}
        {percentiles.map((column) => (
          <span key={column.key} className={cn(!column.always && "hidden sm:block")}>
            {header(column.key, column.key, "font-mono")}
          </span>
        ))}
        <span className="hidden justify-self-end sm:block">{header("errors", "Errors")}</span>
        <span className="hidden justify-self-end sm:block">{header("count", "Count")}</span>
      </div>
      {rows.map((row) => {
        const errorRate = errorRateOf(row)
        return (
          <Link
            key={`${row.component} ${row.environment ?? ""} ${row.operation}`}
            to={linkOf(row)}
            className={cn(grid, "items-center border-b py-2 outline-none hover:bg-accent/60 focus-visible:bg-accent")}
          >
            <span className="flex min-w-0 items-baseline gap-2.5">
              <OperationName name={row.operation} className="text-[15px]" />
              {environments.size > 1 && (
                <span className="shrink-0 font-mono text-xs text-muted-foreground">
                  {row.environment ?? "no environment"}
                </span>
              )}
              {row.slower !== undefined && <SlowerTag slower={row.slower} />}
            </span>
            {percentiles.map((column) => (
              <LatencyCell
                key={column.key}
                milliseconds={column.of(row)}
                color={colorOf(row.component)}
                className={cn(!column.always && "hidden sm:flex")}
              />
            ))}
            <span
              className={cn(
                "hidden text-right font-mono text-[13px] sm:block",
                errorRate >= 0.01 ? "text-failure" : "text-muted-foreground",
              )}
            >
              {row.errors === 0 ? "none" : share(row.errors, row.count)}
            </span>
            <span
              className="hidden text-right font-mono text-[13px] text-muted-foreground sm:block"
              title={`${count(row.count)} counted`}
            >
              {row.count >= 10_000 ? compact(row.count) : count(row.count)}
            </span>
          </Link>
        )
      })}
    </div>
  )
}
