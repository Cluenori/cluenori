import type { ReleaseSummary } from "@cluenori/releases"
import { cn } from "cn"
import { DateTime } from "effect"
import { ChevronRightIcon } from "lucide-react"

import { clockTime, count, dayOf, moment, share } from "@/lib/format"
import type { Ran, VerdictTone } from "@/project-facts"
import { isLive, ranOf, storeStageOf, verdictOf } from "@/project-facts"
import type { Route } from "@/router"
import { Link } from "@/router"
import { CommitName } from "@/views/commit-name"
import { ReleaseRan } from "@/views/release-ran"

/**
 * The color a verdict's words are in: yellow for worse, mint for better, gray for no news, each in
 * the ink that reads on a panel in light mode too.
 */
export const verdictClass: Readonly<Record<VerdictTone, string>> = {
  warning: "text-yellow-ink",
  better: "text-mint-ink",
  quiet: "text-muted-foreground",
}

// Wide, a row is a line of columns under their names; on a phone, the release, how it shipped and
// what it ran stack, its numbers named in place.
const grid =
  "lg:grid lg:grid-cols-[minmax(0,0.95fr)_minmax(0,0.95fr)_minmax(0,1.35fr)_4.5rem_5rem_minmax(0,1.5fr)_1rem] lg:items-center lg:gap-x-5"

// When a deploy was reported: the time alone on the day the release first ran, as its "Ran" says the day.
const deployedText = (deployedAt: DateTime.Utc, ran: Ran | undefined) => {
  const at = DateTime.toEpochMillis(deployedAt)
  return ran !== undefined && dayOf(at) === dayOf(DateTime.toEpochMillis(ran.firstSeen)) ? clockTime(at) : moment(at)
}

/**
 * How a release shipped: its commit, by tag or short SHA, linked to GitHub; and where its app's build
 * stands in App Store Connect, or when its deploy was reported. Nothing when none of them is known.
 */
function Shipped({ release }: { readonly release: ReleaseSummary }) {
  const stage = release.store === undefined ? undefined : storeStageOf(release.store)
  const deployed = release.deployedAt === undefined ? undefined : deployedText(release.deployedAt, ranOf(release))
  return (
    <span className="flex min-w-0 flex-col text-sm">
      {release.commit !== undefined && <CommitName commit={release.commit} className="text-[15px]" />}
      {(stage !== undefined || deployed !== undefined) && (
        <span className="flex min-w-0 flex-wrap gap-x-2 text-muted-foreground">
          {stage !== undefined && (
            <span className={cn("text-pretty", stage.failed && "text-failure")}>{stage.words}</span>
          )}
          {deployed !== undefined && (
            <span>
              Deployed <span className="font-mono whitespace-nowrap">{deployed}</span>
            </span>
          )}
        </span>
      )}
    </span>
  )
}

/**
 * Releases, as listed: each one's version, its component in its color and its environment when
 * the list has more than one; how it shipped (its commit, its store stage, its deploy); when it ran,
 * how many operations it ran and what share failed; and how it compares with the release before it,
 * in words. A release without telemetry says so, and shows no numbers. Each row opens its release;
 * its commit opens on GitHub. With none, it says when releases appear.
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
      <p className="max-w-3xl px-5 py-6 text-sm text-muted-foreground">
        No releases in this period. A release appears once a service reports{" "}
        <span className="font-mono">service.version</span>, its CI reports a deploy with{" "}
        <span className="font-mono">cluenori-release</span>, or a linked app has a build in App Store Connect.
      </p>
    )
  }
  return (
    <div className="flex flex-col">
      <div className={cn(grid, "hidden border-b px-5 py-2.5 text-sm text-muted-foreground")}>
        <span>Release</span>
        <span>Shipped</span>
        <span>Ran</span>
        <span className="text-right">Runs</span>
        <span className="text-right">Error rate</span>
        <span>Against the release before</span>
      </div>
      <ul className="divide-y">
        {releases.map((release) => {
          const verdict = verdictOf(release)
          const ran = ranOf(release)
          const { count: runs, errors } = release
          return (
            <li
              key={`${release.component} ${release.environment ?? ""} ${release.release}`}
              className={cn(grid, "relative flex flex-col gap-1 px-5 py-3 hover:bg-accent/60 focus-within:bg-accent")}
            >
              {/* The row's link covers the whole row; the commit's link sits above it. */}
              <Link
                to={linkOf(release)}
                className="flex min-w-0 flex-col outline-none after:absolute after:inset-0 after:content-['']"
              >
                <span className="truncate font-mono text-[15px]">{release.release}</span>
                <span className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
                  <span className="size-2 shrink-0" style={{ backgroundColor: colorOf(release.component) }} />
                  <span className="truncate">
                    {release.component}
                    {/* A build only the store knows hasn't run anywhere, so it has no environment to name. */}
                    {environments.size > 1 &&
                      (release.environment !== undefined || ran !== undefined) &&
                      `, ${release.environment ?? "no environment"}`}
                  </span>
                </span>
              </Link>
              <Shipped release={release} />
              {ran === undefined ? (
                <span className="text-sm text-muted-foreground lg:text-[15px]">No telemetry yet</span>
              ) : (
                <ReleaseRan ran={ran} live={isLive(release, asOf)} className="text-sm lg:text-[15px]" />
              )}
              {/* On a phone the numbers share a line, each named; wide, each is a column. */}
              {runs === undefined || errors === undefined ? (
                <span className="hidden lg:col-span-2 lg:block" />
              ) : (
                <span className="flex gap-4 font-mono text-sm lg:contents lg:text-[15px]">
                  <span className="lg:text-right">
                    {count(runs)}
                    <span className="font-sans text-muted-foreground lg:hidden"> runs</span>
                  </span>
                  <span className="lg:text-right">
                    {share(errors, runs)}
                    <span className="font-sans text-muted-foreground lg:hidden"> failed</span>
                  </span>
                </span>
              )}
              {/* Without telemetry there is nothing to compare, which its "Ran" already says. */}
              {release.verdict === "unmeasured" ? (
                <span className="hidden lg:block" />
              ) : (
                <span className={cn("text-sm lg:text-[15px]", verdictClass[verdict.tone])}>{verdict.words}</span>
              )}
              <ChevronRightIcon className="hidden size-4 text-muted-foreground lg:block" />
            </li>
          )
        })}
      </ul>
    </div>
  )
}
