import type { FeedLevel, FeedSummary } from "@cluenori/feeds"
import type { ProjectKey } from "@cluenori/foundation"
import { DateTime } from "effect"
import { BellIcon, BellOffIcon, BellRingIcon } from "lucide-react"

import { ago, count } from "@/lib/format"
import { Link } from "@/router"

/** How each level reaches phones, in a word and a sentence. */
export const levelWords: Readonly<Record<FeedLevel, { readonly label: string; readonly description: string }>> = {
  none: { label: "No alerts", description: "Entries show on the feed's page only" },
  quiet: { label: "Quiet", description: "An alert without a sound" },
  timeSensitive: { label: "Time sensitive", description: "An alert with a sound, through Focus" },
}

const levelIcons: Readonly<Record<FeedLevel, typeof BellIcon>> = {
  none: BellOffIcon,
  quiet: BellIcon,
  timeSensitive: BellRingIcon,
}

/** A feed's alert level, as an icon and its word. */
export function FeedLevelLabel({ level }: { readonly level: FeedLevel }) {
  const Icon = levelIcons[level]
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
      <Icon className="size-3.5" aria-hidden />
      {levelWords[level].label}
    </span>
  )
}

/** A project's initial in a square, as the sidebar marks projects, and its name. */
export function ProjectMark({ name }: { readonly name: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <span
        aria-hidden
        className="grid size-4 shrink-0 place-items-center border font-mono text-[10px] text-muted-foreground uppercase"
      >
        {name.slice(0, 1)}
      </span>
      <span className="truncate">{name}</span>
    </span>
  )
}

/**
 * The workspace's feeds, one row each: its name, which opens it, its projects and alert level, how
 * many entries arrived in the last 24 hours and 7 days, and when the newest did, against `now`.
 */
export function FeedRows({
  feeds,
  now,
  nameOf,
}: {
  readonly feeds: ReadonlyArray<FeedSummary>
  readonly now: number
  readonly nameOf: (project: ProjectKey) => string
}) {
  return (
    <ul className="divide-y">
      {feeds.map((summary) => {
        const projects = [...new Set(summary.feed.sources.map((source) => source.project))]
        return (
          <li key={summary.feed.id}>
            <Link
              to={{ page: "feed", feed: summary.feed.id }}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-1 px-5 py-3.5 outline-none hover:bg-accent/60 focus-visible:bg-accent sm:grid-cols-[minmax(0,1fr)_6rem_6rem_9rem]"
            >
              <span className="flex min-w-0 flex-col gap-1">
                <span className="truncate text-[15px] font-medium">{summary.feed.name}</span>
                <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="truncate text-sm text-muted-foreground">{projects.map(nameOf).join(", ")}</span>
                  <FeedLevelLabel level={summary.feed.level} />
                </span>
              </span>
              <span className="flex flex-col items-end">
                <span className="font-mono text-lg">{count(summary.lastDay)}</span>
                <span className="text-xs text-muted-foreground">24 hours</span>
              </span>
              <span className="hidden flex-col items-end sm:flex">
                <span className="font-mono text-lg">{count(summary.lastWeek)}</span>
                <span className="text-xs text-muted-foreground">7 days</span>
              </span>
              <span className="col-span-2 text-sm text-muted-foreground sm:col-span-1 sm:text-right">
                {summary.latest === undefined ? "Nothing yet" : ago(DateTime.toEpochMillis(summary.latest), now)}
              </span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
