import type { ProjectKey } from "@cluenori/foundation"
import type { KeptRequestRow } from "@cluenori/signals"
import { cn } from "cn"
import { DateTime } from "effect"

import { duration, moment } from "@/lib/format"
import { Link } from "@/router"

/**
 * One endpoint's single requests, each a row that opens its trace: when, the environment, how long
 * it took, as a bar against the slowest in the list with a tick at `slowAfterMs`, its endpoint's p95
 * (yellow past it), and its status (red when it failed).
 */
export function RequestList({
  project,
  rows,
  slowAfterMs,
}: {
  readonly project: ProjectKey
  readonly rows: ReadonlyArray<KeptRequestRow>
  readonly slowAfterMs?: number
}) {
  const longest = Math.max(1, ...rows.map((row) => row.durationMs))
  const tick = slowAfterMs !== undefined && slowAfterMs < longest ? (slowAfterMs / longest) * 100 : undefined
  return (
    <ul className="divide-y">
      {rows.map((row, index) => {
        const slow = slowAfterMs !== undefined && row.durationMs > slowAfterMs
        return (
          // A trace can hold two requests to one endpoint, so its ID alone isn't a key.
          <li key={`${row.trace} ${index}`}>
            <Link
              to={{ page: "trace", project, trace: row.trace, around: row.start }}
              className="grid grid-cols-[minmax(0,1fr)_4.5rem_3.5rem] items-center gap-x-5 px-5 py-3 hover:bg-accent/60 md:grid-cols-[9rem_9rem_minmax(0,1fr)_5rem_3.5rem]"
            >
              <span className="font-mono text-[13px] text-muted-foreground">
                {moment(DateTime.toEpochMillis(row.start))}
              </span>
              <span className="hidden truncate text-sm text-muted-foreground md:block">
                {row.environment ?? "No environment"}
              </span>
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
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
