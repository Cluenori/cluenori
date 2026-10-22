import type { ComponentKey } from "@cluenori/foundation"
import type { SourceProblem } from "@cluenori/releases"
import { DateTime } from "effect"

import { ago } from "@/lib/format"
import { sourceWords } from "@/project-facts"
import { Button } from "@/views/ui/button"

/**
 * The sources of releases that refused or failed lately, so commits or builds missing from a
 * release aren't read as none: for each, the source and the component, what it said, in words for
 * the person who fixes it, and how long ago; then, where the page can change them, a button to
 * change the component's links. Marked yellow, as a warning: the releases are there, some of what is
 * known about them isn't.
 */
export function SourceProblems({
  problems,
  asOf,
  colorOf,
  onChangeLinks,
}: {
  readonly problems: ReadonlyArray<SourceProblem>
  /** The time the problems are of, which "how long ago" is measured from. */
  readonly asOf: DateTime.Utc
  readonly colorOf: (component: string) => string
  readonly onChangeLinks?: (component: ComponentKey) => void
}) {
  const now = DateTime.toEpochMillis(asOf)
  return (
    <ul className="divide-y">
      {problems.map((problem) => (
        <li
          key={`${problem.component} ${problem.source}`}
          className="grid grid-cols-[0.625rem_minmax(0,1fr)] items-center gap-x-4 gap-y-2 px-5 py-3.5 sm:grid-cols-[0.625rem_minmax(0,1fr)_auto]"
        >
          <span className="size-2.5 bg-yellow" />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="flex flex-wrap items-center gap-x-2 text-[15px]">
              {sourceWords[problem.source]}
              <span className="flex items-center gap-2 text-muted-foreground">
                <span className="size-2 shrink-0" style={{ backgroundColor: colorOf(problem.component) }} />
                {problem.component}
              </span>
            </span>
            <span className="text-sm wrap-anywhere text-muted-foreground">
              {problem.problem}
              <span className="whitespace-nowrap"> · {ago(DateTime.toEpochMillis(problem.at), now)}</span>
            </span>
          </span>
          {onChangeLinks !== undefined && (
            <Button
              variant="outline"
              size="sm"
              className="col-start-2 justify-self-start sm:col-start-auto"
              onClick={() => onChangeLinks(problem.component)}
            >
              Change links<span className="sr-only"> of {problem.component}</span>
            </Button>
          )}
        </li>
      ))}
    </ul>
  )
}
