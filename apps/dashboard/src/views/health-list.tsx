import type { ReleaseHealth } from "@cluenori/analytics"
import { cn } from "cn"
import { DateTime } from "effect"
import { ChevronRightIcon } from "lucide-react"

import { healthKeyOf, healthWordsOf } from "@/app-facts"
import { count, ratio } from "@/lib/format"
import { liveForMs } from "@/project-facts"
import type { Route } from "@/router"
import { Link } from "@/router"
import { verdictClass } from "@/views/release-list"
import { ReleaseRan } from "@/views/release-ran"

// Wide, a row is a line of columns under their names; on a phone, the release, when it sent, and its
// numbers stack, each named in place.
const grid =
  "lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_5.5rem_5.5rem_6.5rem_minmax(0,1.6fr)_1rem] lg:items-center lg:gap-x-5"

/**
 * Releases of a project's apps by their app health, the latest first seen first: each one's version,
 * its component in its color and its environment when the list has more than one; when it sent,
 * live while it sent in the last 15 minutes; its people, sessions, and crashes per 1,000 sessions,
 * once MetricKit reported of it; and how it compares with the release before it, in words. Each row
 * opens the release's app health. With none, it says when releases appear.
 */
export function HealthList({
  releases,
  asOf,
  colorOf,
  linkOf,
}: {
  readonly releases: ReadonlyArray<ReleaseHealth>
  /** The time the list is of, which "live" is measured from. */
  readonly asOf: DateTime.Utc
  readonly colorOf: (component: string) => string
  /** The page each row opens. */
  readonly linkOf: (release: ReleaseHealth) => Route
}) {
  const environments = new Set(releases.map((each) => each.release.environment))
  if (releases.length === 0) {
    return (
      <p className="max-w-3xl px-5 py-6 text-sm text-muted-foreground">
        No app sent anything in this period. A release appears once an app with the Cluenori SDK runs it.
      </p>
    )
  }
  return (
    <div className="flex flex-col">
      <div className={cn(grid, "hidden border-b px-5 py-2.5 text-sm text-muted-foreground")}>
        <span>Release</span>
        <span>Sent</span>
        <span className="text-right">People</span>
        <span className="text-right">Sessions</span>
        <span className="text-right">Crashes / 1,000</span>
        <span>Against the release before</span>
      </div>
      <ul className="divide-y">
        {releases.map((each) => {
          const { release, health } = each
          const verdict = healthWordsOf(each)
          const live = DateTime.toEpochMillis(asOf) - DateTime.toEpochMillis(release.lastSeen) < liveForMs
          return (
            <li
              key={healthKeyOf(each)}
              className={cn(grid, "relative flex flex-col gap-1 px-5 py-3 hover:bg-accent/60 focus-within:bg-accent")}
            >
              {/* The row's link covers the whole row. */}
              <Link
                to={linkOf(each)}
                className="flex min-w-0 flex-col outline-none after:absolute after:inset-0 after:content-['']"
              >
                <span className="truncate font-mono text-[15px]">{release.release}</span>
                <span className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
                  <span className="size-2 shrink-0" style={{ backgroundColor: colorOf(release.component) }} />
                  <span className="truncate">
                    {release.component}
                    {environments.size > 1 && `, ${release.environment}`}
                  </span>
                </span>
              </Link>
              <ReleaseRan ran={release} live={live} className="text-sm lg:text-[15px]" />
              {/* On a phone the numbers share a line, each named; wide, each is a column. */}
              <span className="flex flex-wrap gap-x-4 font-mono text-sm lg:contents lg:text-[15px]">
                <span className="lg:text-right">
                  {count(health.people)}
                  <span className="font-sans text-muted-foreground lg:hidden"> people</span>
                </span>
                <span className="lg:text-right">
                  {count(health.sessions)}
                  <span className="font-sans text-muted-foreground lg:hidden"> sessions</span>
                </span>
                {each.crashesPerThousand === undefined ? (
                  // Before MetricKit reported of it, how often it crashes isn't known.
                  <span className="font-sans text-muted-foreground lg:text-right">
                    <span className="lg:hidden">crashes </span>unknown
                  </span>
                ) : (
                  <span className={cn("lg:text-right", each.worse.includes("crashes") && "text-yellow-ink")}>
                    {ratio(each.crashesPerThousand)}
                    <span className="font-sans text-muted-foreground lg:hidden"> crashes per 1,000 sessions</span>
                  </span>
                )}
              </span>
              <span className={cn("text-sm lg:text-[15px]", verdictClass[verdict.tone])}>{verdict.words}</span>
              <ChevronRightIcon aria-hidden className="hidden size-4 text-muted-foreground lg:block" />
            </li>
          )
        })}
      </ul>
    </div>
  )
}
