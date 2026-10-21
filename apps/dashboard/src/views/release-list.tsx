import type { ReleaseSummary } from "@cluenori/releases"
import { cn } from "cn"
import type { DateTime } from "effect"
import { ChevronRightIcon } from "lucide-react"

import { count, share } from "@/lib/format"
import type { VerdictTone } from "@/project-facts"
import { isLive, verdictOf } from "@/project-facts"
import type { Route } from "@/router"
import { Link } from "@/router"
import { ReleaseRan } from "@/views/release-ran"

/** The color a verdict's words are in: yellow for worse, mint for better, gray for no news. */
export const verdictClass: Readonly<Record<VerdictTone, string>> = {
  warning: "text-yellow",
  better: "text-mint",
  quiet: "text-muted-foreground",
}

// Wide, a row is a line of columns under their names; on a phone, the release and what it ran
// stack, its numbers named in place.
const grid =
  "md:grid md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)_5rem_5.5rem_minmax(0,1.3fr)_1rem] md:items-center md:gap-x-5"

/**
 * Releases, as listed: each one's version, its component in its color and its environment when
 * the list has more than one, when it ran, how many operations it ran and what share failed, and
 * how it compares with the release before it, in words. Each row opens its release. With none, it
 * says when releases appear.
 */
export function ReleaseList({
  releases,
  asOf,
  colorOf,
  linkOf,
}: {
  readonly releases: ReadonlyArray<ReleaseSummary>
  /** The time the list is of, which "live" is measured from. */
  readonly asOf: DateTime.Utc
  readonly colorOf: (component: string) => string
  /** The page each row opens. */
  readonly linkOf: (release: ReleaseSummary) => Route
}) {
  const environments = new Set(releases.map((release) => release.environment))
  if (releases.length === 0) {
    return (
      <p className="px-5 py-6 text-sm text-muted-foreground">
        No releases in this period: a release appears once a service reports{" "}
        <span className="font-mono">service.version</span>.
      </p>
    )
  }
  return (
    <div className="flex flex-col">
      <div className={cn(grid, "hidden border-b px-5 py-2.5 text-sm text-muted-foreground")}>
        <span>Release</span>
        <span>Ran</span>
        <span className="text-right">Runs</span>
        <span className="text-right">Error rate</span>
        <span>Against the release before</span>
      </div>
      <ul className="divide-y">
        {releases.map((release) => {
          const verdict = verdictOf(release)
          return (
            <li key={`${release.component} ${release.environment ?? ""} ${release.release}`}>
              <Link
                to={linkOf(release)}
                className={cn(
                  grid,
                  "flex flex-col gap-1 px-5 py-3 outline-none hover:bg-accent/60 focus-visible:bg-accent",
                )}
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-mono text-[15px]">{release.release}</span>
                  <span className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
                    <span className="size-2 shrink-0" style={{ backgroundColor: colorOf(release.component) }} />
                    <span className="truncate">
                      {release.component}
                      {environments.size > 1 && `, ${release.environment ?? "no environment"}`}
                    </span>
                  </span>
                </span>
                <ReleaseRan release={release} live={isLive(release, asOf)} className="text-sm md:text-[15px]" />
                {/* On a phone the numbers share a line, each named; wide, each is a column. */}
                <span className="flex gap-4 font-mono text-sm md:contents md:text-[15px]">
                  <span className="md:text-right">
                    {count(release.count)}
                    <span className="font-sans text-muted-foreground md:hidden"> runs</span>
                  </span>
                  <span className="md:text-right">
                    {share(release.errors, release.count)}
                    <span className="font-sans text-muted-foreground md:hidden"> failed</span>
                  </span>
                </span>
                <span className={cn("text-sm md:text-[15px]", verdictClass[verdict.tone])}>{verdict.words}</span>
                <ChevronRightIcon className="hidden size-4 text-muted-foreground md:block" />
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
