import type { ProjectKey } from "@cluenori/foundation"
import type { ErrorGroup, ErrorGroupId, LogLine } from "@cluenori/signals"
import { cn } from "cn"
import { DateTime } from "effect"
import { ChevronDownIcon } from "lucide-react"
import type { ReactNode } from "react"

import { ago, count, moment } from "@/lib/format"
import type { StackFrame } from "@/project-facts"
import { statusOf } from "@/project-facts"
import { Link } from "@/router"
import { titleParts } from "@/views/error-group"
import { buttonVariants } from "@/views/ui/button"

// An error group scrolls into view as it opens, whether by a click here or by a link from another
// page, such as the overview's. A ref callback runs once, when the open group's element attaches.
const scrollIntoView = (element: HTMLElement | null) => {
  element?.scrollIntoView({ behavior: "smooth", block: "nearest" })
}

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
 * The stack in the app's own code, the culprit marked: the topmost of its own frames, where the
 * error left the app's code. Library frames are counted, not listed.
 */
function Stack({ frames }: { readonly frames: ReadonlyArray<StackFrame> }) {
  const ours = frames.filter((frame) => frame.ours)
  return (
    <ol className="border font-mono text-[12.5px] leading-relaxed">
      {ours.map((frame, index) => (
        <li
          key={`${frame.method} ${index}`}
          className={cn(
            "border-l-2 px-3 py-2",
            index === 0 ? "border-l-failure bg-failure/[0.07]" : "border-l-transparent",
          )}
        >
          <span className="block break-all">{frame.method}</span>
          {frame.place !== undefined && <span className="block break-all text-muted-foreground">{frame.place}</span>}
        </li>
      ))}
      <li className={cn("px-3 py-2 font-sans text-xs text-muted-foreground", ours.length > 0 && "border-t")}>
        {ours.length === 0
          ? `${count(frames.length)} frames, none in the app's own code`
          : `and ${count(frames.length - ours.length)} ${frames.length - ours.length === 1 ? "frame" : "frames"} in libraries`}
      </li>
    </ol>
  )
}

/**
 * Where an error happened and what it broke: how often, the stack of its latest occurrence, and its
 * latest occurrences, each one click from its request's trace.
 */
export function ErrorEvidence({
  project,
  group,
  now,
  latest,
  frames,
}: {
  readonly project: ProjectKey
  readonly group: ErrorGroup
  /** The time the answer covers up to, which "ago" counts back from. */
  readonly now: number
  readonly latest: ReadonlyArray<LogLine>
  /** The stack of its latest occurrence, when that came with one. */
  readonly frames: ReadonlyArray<StackFrame> | undefined
}) {
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted-foreground">
        {count(group.occurrences)} times in the period, first seen {moment(DateTime.toEpochMillis(group.firstSeen))};
        last {ago(DateTime.toEpochMillis(group.lastSeen), now)}, in {group.lastComponent}
        {group.lastRelease !== undefined && ` ${group.lastRelease}`}.
      </p>
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="min-w-0">
          {frames === undefined ? (
            <p className="font-mono text-[13px] text-muted-foreground">{group.culprit}</p>
          ) : (
            <Stack frames={frames} />
          )}
        </div>
        {latest.length > 0 && (
          <div className="flex min-w-0 flex-col gap-2">
            <span className="text-sm text-muted-foreground">Latest occurrences</span>
            <ul className="divide-y border">
              {latest.map((line) => (
                <li key={line.id} className="flex items-center gap-4 px-3 py-2 text-sm">
                  <span className="w-36 shrink-0 font-mono text-[13px] whitespace-nowrap text-muted-foreground">
                    {moment(DateTime.toEpochMillis(line.time))}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{line.message}</span>
                  {line.trace !== undefined && (
                    <Link
                      to={{ page: "trace", project, trace: line.trace, around: line.time }}
                      className={buttonVariants({ variant: "outline", size: "sm" })}
                    >
                      Open the request
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * The project's errors, most frequent first, each in its component's color and opening in place with
 * its evidence, which the page loads (`renderOpened`).
 */
export function ErrorList({
  groups,
  now,
  colorOf,
  stepsOf,
  opened,
  onOpen,
  renderOpened,
}: {
  readonly groups: ReadonlyArray<ErrorGroup>
  /** The time the answer covers up to: what "new" and "now" are measured from. */
  readonly now: number
  readonly colorOf: (component: string) => string
  /** A group's occurrences in each step of the period, when counted. */
  readonly stepsOf: (group: ErrorGroup) => ReadonlyArray<number | undefined> | undefined
  readonly opened: ErrorGroupId | undefined
  readonly onOpen: (error: ErrorGroupId | undefined) => void
  readonly renderOpened: (group: ErrorGroup) => ReactNode
}) {
  return (
    <ul className="divide-y">
      {groups.map((group) => {
        const { type, message } = titleParts(group)
        const status = statusOf(group, now)
        const isOpen = opened === group.id
        const steps = stepsOf(group)
        return (
          <li key={group.id} ref={isOpen ? scrollIntoView : undefined} className="scroll-mt-4">
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => onOpen(isOpen ? undefined : group.id)}
              className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-5 gap-y-2 px-5 py-3.5 text-left outline-none hover:bg-accent/60 focus-visible:bg-accent md:grid-cols-[minmax(0,1fr)_9rem_4rem_1rem]"
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
              <ChevronDownIcon
                className={cn(
                  "hidden size-4 text-muted-foreground transition-transform duration-200 ease-(--ease-out) md:block",
                  isOpen && "rotate-180",
                )}
              />
            </button>
            {isOpen && <div className="border-t bg-background/60 px-5 py-5">{renderOpened(group)}</div>}
          </li>
        )
      })}
    </ul>
  )
}
