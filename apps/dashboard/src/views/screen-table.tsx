import { cn } from "cn"

import { compact, count } from "@/lib/format"
import { EndpointName } from "@/views/endpoint-name"
import type { Latency, Slower } from "@/views/endpoint-table"
import { LatencyCell, percentiles, SlowerTag } from "@/views/endpoint-table"

/** One screen of an app, or a page in a browser: how often it was shown, and how long it took. */
export type ScreenLatency = Latency & {
  readonly screen: string
  readonly component: string
  readonly views: number
  readonly slower?: Slower
}

/**
 * An app's screens by how long they took to show: p50, p80, p95, and p99, each a value beside a
 * filled cell, as in the endpoint table, then how often each was shown. A screen that got slower
 * says so beside its name.
 */
export function ScreenTable({
  rows,
  color,
  heading,
}: {
  readonly rows: ReadonlyArray<ScreenLatency>
  readonly color: string
  /** What the first column names: "Screen" on a phone, "Page" in a browser. */
  readonly heading: string
}) {
  // On a phone only p50 and p95 show, so names fit.
  const grid =
    "grid grid-cols-[minmax(0,1fr)_repeat(2,4.5rem)] gap-x-3 sm:grid-cols-[minmax(0,1fr)_repeat(4,4.5rem)_4rem]"
  return (
    <div className="flex flex-col">
      <div className={cn(grid, "border-b pb-2 text-sm text-muted-foreground")}>
        <span>{heading}</span>
        {percentiles.map((column) => (
          <span key={column.key} className={cn("font-mono", !column.always && "hidden sm:block")}>
            {column.key}
          </span>
        ))}
        <span className="hidden justify-self-end sm:block">Views</span>
      </div>
      {rows.map((row) => (
        <div key={row.screen} className={cn(grid, "min-h-12 items-center border-b py-2")}>
          <span className="flex min-w-0 items-baseline gap-2.5">
            <EndpointName endpoint={row.screen} className="text-[15px]" />
            {row.slower !== undefined && <SlowerTag slower={row.slower} />}
          </span>
          {percentiles.map((column) => (
            <LatencyCell
              key={column.key}
              milliseconds={column.of(row)}
              color={color}
              className={cn(!column.always && "hidden sm:flex")}
            />
          ))}
          <span
            className="hidden text-right font-mono text-[13px] text-muted-foreground sm:block"
            title={`${count(row.views)} views`}
          >
            {row.views >= 10_000 ? compact(row.views) : count(row.views)}
          </span>
        </div>
      ))}
    </div>
  )
}
