import type { ErrorGroup } from "@cluenori/signals"
import { ChevronRightIcon } from "lucide-react"

import { count } from "@/lib/format"
import { statusOf } from "@/project-facts"
import type { Route } from "@/router"
import { Link } from "@/router"
import { titleParts } from "@/views/error-group"

/**
 * An error over the period as a strip of small bars, one a step, taller when it happened more. A step
 * with nothing counted has no bar.
 */
function StepBars({ values }: { readonly values: ReadonlyArray<number | undefined> }) {
  const most = Math.max(1, ...values.map((value) => value ?? 0))
  const slot = 100 / Math.max(1, values.length)
  return (
    <svg width="100%" height="20" aria-hidden className="block border-b border-foreground/15">
      {values.map((value, step) =>
        value === undefined || value === 0 ? null : (
          <rect
            key={step}
            x={`${step * slot + slot * 0.15}%`}
            width={`${slot * 0.7}%`}
            y={20 - Math.max(2, (value / most) * 18)}
            height={Math.max(2, (value / most) * 18)}
            fill="var(--failure)"
          />
        ),
      )}
    </svg>
  )
}

/**
 * The project's errors, most frequent first, each in its component's color, with what it said and
 * when it happened; each row opens its error's page.
 */
export function ErrorList({
  groups,
  now,
  colorOf,
  stepsOf,
  linkOf,
}: {
  readonly groups: ReadonlyArray<ErrorGroup>
  /** The time the answer covers up to: what "new" and "now" are measured from. */
  readonly now: number
  readonly colorOf: (component: string) => string
  /** A group's occurrences in each step of the period, when counted. */
  readonly stepsOf: (group: ErrorGroup) => ReadonlyArray<number | undefined> | undefined
  /** The page each row opens. */
  readonly linkOf: (group: ErrorGroup) => Route
}) {
  return (
    <ul className="divide-y">
      {groups.map((group) => {
        const { type, message } = titleParts(group)
        const status = statusOf(group, now)
        const steps = stepsOf(group)
        return (
          <li key={group.id}>
            <Link
              to={linkOf(group)}
              className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-5 gap-y-2 px-5 py-3.5 outline-none hover:bg-accent/60 focus-visible:bg-accent md:grid-cols-[minmax(0,1fr)_9rem_4rem_1rem]"
            >
              <span className="flex min-w-0 flex-col">
                <span className="flex items-center gap-2.5">
                  <span
                    className="size-2 shrink-0"
                    style={{ backgroundColor: colorOf(group.lastComponent) }}
                    title={group.lastComponent}
                  />
                  <span className="truncate font-medium">{type}</span>
                  {status.ongoing && <span className="shrink-0 font-mono text-xs text-failure">now</span>}
                  {status.isNew && <span className="shrink-0 font-mono text-xs text-yellow">new</span>}
                </span>
                <span className="truncate pl-[1.125rem] text-sm text-muted-foreground">
                  {group.lastComponent}: {message ?? group.culprit}
                </span>
              </span>
              <span className="hidden md:block" title="Each bar is a step of the period">
                {steps !== undefined && <StepBars values={steps} />}
              </span>
              <span className="text-right font-mono">{count(group.occurrences)}</span>
              <ChevronRightIcon className="hidden size-4 text-muted-foreground md:block" />
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
