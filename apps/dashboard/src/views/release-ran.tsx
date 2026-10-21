import type { ReleaseSummary } from "@cluenori/releases"
import { cn } from "cn"
import { DateTime } from "effect"

import { clockTime, dayOf, moment } from "@/lib/format"

type Ran = Pick<ReleaseSummary, "firstSeen" | "lastSeen">

// When a release last ran, as its time range ends: the time alone on the day it started.
const endOf = (release: Ran) => {
  const from = DateTime.toEpochMillis(release.firstSeen)
  const to = DateTime.toEpochMillis(release.lastSeen)
  return dayOf(from) === dayOf(to) ? clockTime(to) : moment(to)
}

/**
 * When a release ran, from the first minute it ran in to the last: "Oct 20, 14:05 – 18:30", the
 * day once when it is one; "Oct 21, 09:12 – live", marked, while it still runs. Where it doesn't
 * fit, its end wraps under its start, so no time is ever cut.
 */
export function ReleaseRan({
  release,
  live,
  className,
}: {
  readonly release: Ran
  /** Whether it still runs (`isLive`). */
  readonly live: boolean
  readonly className?: string
}) {
  return (
    <span className={cn("flex min-w-0 flex-wrap items-center gap-x-2 font-mono whitespace-nowrap", className)}>
      <span>{moment(DateTime.toEpochMillis(release.firstSeen))} –</span>
      {live ? (
        <span className="flex items-center gap-1.5 font-sans">
          <span className="size-1.5 rounded-full bg-mint" />
          live
        </span>
      ) : (
        <span>{endOf(release)}</span>
      )}
    </span>
  )
}
