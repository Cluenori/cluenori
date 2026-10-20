import { cn } from "cn"

import { duration, moment } from "@/lib/format"
import type { KeptRequest } from "@/project-facts"
import { failedRequest, originColor, originLabel } from "@/project-facts"
import { Link } from "@/router"
import { EndpointName } from "@/views/endpoint-name"

/**
 * Single requests, each a row that opens its trace: when, the endpoint, the origin, how long it
 * took (yellow when slow for its endpoint), and its status (red when it failed). On one endpoint's
 * page, `withEndpoint` is false, so every row doesn't repeat it.
 */
export function RequestList({
  project,
  rows,
  withEndpoint = true,
}: {
  readonly project: string
  readonly rows: ReadonlyArray<KeptRequest>
  readonly withEndpoint?: boolean
}) {
  const grid = withEndpoint
    ? "grid-cols-[minmax(0,1fr)_4.5rem_3rem] md:grid-cols-[9rem_minmax(0,1fr)_7rem_5rem_3rem]"
    : "grid-cols-[minmax(0,1fr)_4.5rem_3rem] md:grid-cols-[9rem_minmax(0,1fr)_5rem_3rem]"
  return (
    <ul className="divide-y">
      {rows.map((row) => (
        <li key={row.trace}>
          <Link
            to={{ page: "trace", project, trace: row.trace }}
            className={cn("grid items-center gap-x-5 px-5 py-3 hover:bg-accent/60", grid)}
          >
            <span className={cn("font-mono text-[13px] text-muted-foreground", withEndpoint && "hidden md:block")}>
              {moment(row.time)}
            </span>
            {withEndpoint && <EndpointName endpoint={row.endpoint} className="text-[15px]" />}
            <span className="hidden items-center gap-2 text-sm text-muted-foreground md:flex">
              <span className="size-2" style={{ backgroundColor: originColor(row.origin) }} />
              {originLabel(row.origin)}
            </span>
            <span className={cn("text-right font-mono text-[13px]", row.slow && "text-yellow")}>
              {duration(row.durationMs)}
            </span>
            <span
              className={cn(
                "text-right font-mono text-[13px]",
                failedRequest(row) ? "text-failure" : "text-muted-foreground",
              )}
            >
              {row.status}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
