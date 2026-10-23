import type { ProjectKey } from "@cluenori/foundation"
import { cn } from "cn"

import type { NeedsYou } from "@/project-facts"
import { Link } from "@/router"

// Each tone's color: a dot in it, and the kind's words in its ink, which reads at 4.5:1 on a panel.
const toneDot: Readonly<Record<NeedsYou["tone"], string>> = {
  failure: "bg-failure",
  warning: "bg-yellow",
  release: "bg-purple",
}
const toneInk: Readonly<Record<NeedsYou["tone"], string>> = {
  failure: "text-failure",
  warning: "text-yellow-ink",
  release: "text-purple",
}

/**
 * What needs the founder now, the most urgent first, a row each: its kind, and its project when
 * `projectName` is given, in its tone's color; when; what it is; and a line of evidence. A row is a
 * link to the page that shows it. With none, it says so, so an empty list reads as "all is well",
 * not as "nothing loaded".
 */
export function NeedsYouList({
  items,
  projectName,
}: {
  readonly items: ReadonlyArray<NeedsYou>
  /** A project's name, for a list across projects; a project's own list leaves it out. */
  readonly projectName?: (project: ProjectKey) => string
}) {
  if (items.length === 0) {
    return (
      <p className="flex items-center gap-3 px-5 py-5 text-[15px]">
        <span className="size-2.5 shrink-0 bg-mint" />
        Nothing needs you right now.
      </p>
    )
  }
  return (
    <ul className="divide-y">
      {items.map((item) => (
        <li key={item.key}>
          <Link
            to={item.to}
            className="grid grid-cols-[0.625rem_minmax(0,1fr)] gap-x-4 px-5 py-3.5 outline-none hover:bg-accent/60 focus-visible:bg-accent/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
          >
            <span className={cn("mt-1.5 size-2.5", toneDot[item.tone])} />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="flex items-baseline justify-between gap-3 text-sm">
                <span className={cn("truncate font-medium", toneInk[item.tone])}>
                  {item.kind}
                  {projectName !== undefined && ` · ${projectName(item.project)}`}
                </span>
                {item.when !== undefined && <span className="shrink-0 text-muted-foreground">{item.when}</span>}
              </span>
              <span className="truncate text-[15px]">{item.title}</span>
              <span className="text-sm text-muted-foreground">{item.detail}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
