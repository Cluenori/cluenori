import type { ProjectKey } from "@cluenori/foundation"
import type { KeptTraceRow } from "@cluenori/signals"
import { cn } from "cn"
import { DateTime } from "effect"
import { ChevronRightIcon } from "lucide-react"

import { duration, moment } from "@/lib/format"
import type { Filters } from "@/router"
import { Link } from "@/router"
import { OperationName } from "@/views/operation-name"

/**
 * Requests, each a row that opens its trace: when it started, its operation when the list is of
 * several, the environment, how long it took, as a bar against the slowest in the list with a tick
 * at `slowAfterMs`, its operation's p95 (yellow past it), and its status (red when it failed).
 */
export function TraceList({
  project,
  rows,
  slowAfterMs,
  traceFilters,
  showOperation = false,
}: {
  readonly project: ProjectKey
  readonly rows: ReadonlyArray<KeptTraceRow>
  readonly slowAfterMs?: number
  /** The environment and release the page shows, which a trace opened from it keeps. */
  readonly traceFilters: Pick<Filters, "environment" | "release">
  /** Each row names its operation: the requests are of several. */
  readonly showOperation?: boolean
}) {
  const longest = Math.max(1, ...rows.map((row) => row.durationMs))
  const tick = slowAfterMs !== undefined && slowAfterMs < longest ? (slowAfterMs / longest) * 100 : undefined
  return (
    <ul className="divide-y">
      {rows.map((row, index) => {
        const slow = slowAfterMs !== undefined && row.durationMs > slowAfterMs
        return (
          // A trace can hold one operation twice, so its ID alone isn't a key.
          <li key={`${row.trace} ${index}`}>
            <Link
              to={{ page: "trace", project, trace: row.trace, around: row.start, ...traceFilters }}
              className={cn(
                "grid items-center gap-x-5 gap-y-1 px-5 py-3 outline-none hover:bg-accent/60 focus-visible:bg-accent",
                showOperation
                  ? "grid-cols-[minmax(0,1fr)_4.5rem_3.5rem] md:grid-cols-[9rem_minmax(0,1fr)_minmax(0,12rem)_5rem_3.5rem_1rem]"
                  : "grid-cols-[minmax(0,1fr)_4.5rem_3.5rem] md:grid-cols-[9rem_9rem_minmax(0,1fr)_5rem_3.5rem_1rem]",
              )}
            >
              <span className="flex min-w-0 flex-col">
                <span className="font-mono text-[13px] text-muted-foreground">
                  {moment(DateTime.toEpochMillis(row.start))}
                </span>
                {showOperation && <OperationName name={row.operation} className="text-sm md:hidden" />}
              </span>
              {showOperation ? (
                <OperationName name={row.operation} className="hidden text-sm md:flex" />
              ) : (
                <span className="hidden truncate text-sm text-muted-foreground md:block">
                  {row.environment ?? "No environment"}
                </span>
              )}
              <span aria-hidden className="relative hidden h-2 bg-muted md:block">
                <span
                  className={cn("block h-full bg-muted-foreground/40", slow && "bg-yellow", row.failed && "bg-failure")}
                  style={{ width: `max(2px, ${(row.durationMs / longest) * 100}%)` }}
                />
                {tick !== undefined && (
                  <span className="absolute -inset-y-1 w-px bg-foreground/50" style={{ left: `${tick}%` }} />
                )}
              </span>
              <span className={cn("text-right font-mono text-[13px]", slow && "text-yellow")}>
                {duration(row.durationMs)}
              </span>
              <span
                className={cn(
                  "text-right font-mono text-[13px]",
                  row.failed ? "text-failure" : "text-muted-foreground",
                )}
              >
                {row.status ?? (row.failed ? "failed" : "")}
              </span>
              <ChevronRightIcon aria-hidden className="hidden size-4 text-muted-foreground md:block" />
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
