import type { ReleaseCommit } from "@cluenori/releases"
import { cn } from "cn"
import { ArrowUpRightIcon } from "lucide-react"

import { commitNameOf } from "@/project-facts"

/**
 * A release's commit by its tag, else its short SHA, in mono; a link to its page on GitHub, marked
 * as leaving the dashboard, when that page is known. It sits above a row's own link, so it can be
 * placed in a row that opens something else.
 */
export function CommitName({
  commit,
  className,
}: {
  readonly commit: Pick<ReleaseCommit, "sha" | "tag" | "url">
  readonly className?: string
}) {
  const name = commitNameOf(commit)
  if (commit.url === undefined) {
    return (
      <span title={name} className={cn("max-w-full truncate font-mono", className)}>
        {name}
      </span>
    )
  }
  return (
    <a
      href={commit.url}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "relative z-10 inline-flex max-w-full items-center gap-1 font-mono underline-offset-4 outline-none hover:underline focus-visible:underline",
        className,
      )}
    >
      <span title={name} className="truncate">
        {name}
      </span>
      <span className="sr-only"> on GitHub</span>
      <ArrowUpRightIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
    </a>
  )
}
