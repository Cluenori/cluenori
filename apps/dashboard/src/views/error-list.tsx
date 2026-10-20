import { cn } from "cn"
import { ChevronDownIcon } from "lucide-react"

import { ago, count, duration, moment, share } from "@/lib/format"
import { statusOf } from "@/project-facts"
import { Link } from "@/router"
import type { ErrorGroup, LogLine, StackFrame, TrailEvent } from "@/sample/sample-project"
import { EndpointName } from "@/views/endpoint-name"
import { titleParts } from "@/views/error-group"
import { buttonVariants } from "@/views/ui/button"

// An error group scrolls into view as it opens, whether by a click here or by a link from another
// page, such as the overview's. A ref callback runs once, when the open group's element attaches.
const scrollIntoView = (element: HTMLElement | null) => {
  element?.scrollIntoView({ behavior: "smooth", block: "nearest" })
}

/** A day of an error as a strip of small bars, one an hour, taller when it happened more. */
function HourBars({ hourly }: { readonly hourly: ReadonlyArray<number> }) {
  const most = Math.max(1, ...hourly)
  const slot = 100 / Math.max(1, hourly.length)
  return (
    <svg width="100%" height="20" aria-hidden className="block border-b border-foreground/15">
      {hourly.map((value, hour) =>
        value === 0 ? null : (
          <rect
            key={hour}
            x={`${hour * slot + slot * 0.15}%`}
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
      <li className="border-t px-3 py-2 font-sans text-xs text-muted-foreground">
        and {count(frames.length - ours.length)} frames in libraries
      </li>
    </ol>
  )
}

/** How an error spreads over releases: each release's share of its occurrences, the newest first. */
function ByRelease({ group }: { readonly group: ErrorGroup }) {
  const most = Math.max(1, ...group.releases.map((entry) => entry.occurrences))
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm text-muted-foreground">By release</span>
      <ul className="flex flex-col gap-1.5">
        {group.releases.map((entry) => (
          <li key={entry.release} className="grid grid-cols-[8rem_minmax(0,1fr)_3.5rem] items-center gap-3 text-sm">
            <span className="truncate font-mono text-[13px]">{entry.release}</span>
            <span className="h-2 bg-muted">
              <span className="block h-full bg-failure" style={{ width: `${(entry.occurrences / most) * 100}%` }} />
            </span>
            <span className="text-right font-mono text-[13px] text-muted-foreground">
              {share(entry.occurrences, group.occurrences)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// What a trail's event says, in a few words.
function TrailText({ event, project }: { readonly event: TrailEvent; readonly project: string }) {
  switch (event.kind) {
    case "screen":
      return <span className="text-muted-foreground">Opened {event.text}</span>
    case "action":
      return <span>{event.text}</span>
    case "error":
      return <span className="text-failure">{event.text}</span>
    case "request":
      return (
        <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <EndpointName endpoint={event.endpoint} className="max-w-full" />
          <span
            className={cn(
              "shrink-0 font-mono text-[13px]",
              event.status >= 500 ? "text-failure" : "text-muted-foreground",
            )}
          >
            {event.status}, {duration(event.durationMs)}
          </span>
          <Link
            to={{ page: "trace", project, trace: event.trace }}
            className={buttonVariants({ variant: "outline", size: "sm", className: "ml-auto shrink-0" })}
          >
            Open the request
          </Link>
        </span>
      )
  }
}

/**
 * What the app did before the error, in its latest session: screens, what the person did, and the
 * requests it made, each one click from its trace, timed back from the error.
 */
function Trail({ trail, project }: { readonly trail: ReadonlyArray<TrailEvent>; readonly project: string }) {
  const at = trail.at(-1)?.time ?? 0
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm text-muted-foreground">Before it, in the latest session</span>
      <ol className="divide-y border">
        {trail.map((event, index) => (
          <li
            key={`${event.time} ${index}`}
            className="grid min-h-11 grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-3 px-3 py-1.5 text-sm"
          >
            <span className="text-right font-mono text-[13px] text-muted-foreground">
              {event.time === at ? "" : `−${duration(at - event.time)}`}
            </span>
            <TrailText event={event} project={project} />
          </li>
        ))}
      </ol>
    </div>
  )
}

/** The latest requests a backend's error broke, each one click from its trace. */
function BrokenRequests({ lines, project }: { readonly lines: ReadonlyArray<LogLine>; readonly project: string }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm text-muted-foreground">Latest requests it broke</span>
      <ul className="divide-y border">
        {lines.map((line) => (
          <li key={line.id} className="flex items-center gap-4 px-3 py-2 text-sm">
            <span className="w-36 shrink-0 font-mono text-[13px] whitespace-nowrap text-muted-foreground">
              {moment(line.time)}
            </span>
            <span className="min-w-0 flex-1 truncate">{line.message}</span>
            {line.trace !== undefined && (
              <Link
                to={{ page: "trace", project, trace: line.trace }}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                Open the request
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * The project's errors, most frequent first, each in its component's color and opening in place:
 * where in the code it happened, how it spreads over releases, and its evidence. For an app, what
 * the app did before it; for a backend, the latest requests it broke, each one click from its
 * trace. A crash, an error that ended the app, says so.
 */
export function ErrorList({
  project,
  groups,
  framesOf,
  occurrencesOf,
  colorOf,
  opened,
  onOpen,
  now,
}: {
  readonly project: string
  readonly groups: ReadonlyArray<ErrorGroup>
  readonly framesOf: (group: ErrorGroup) => ReadonlyArray<StackFrame> | undefined
  readonly occurrencesOf: (group: ErrorGroup) => ReadonlyArray<LogLine>
  readonly colorOf: (component: string) => string
  readonly opened: string | undefined
  readonly onOpen: (error: string | undefined) => void
  readonly now: number
}) {
  return (
    <ul className="divide-y">
      {groups.map((group) => {
        const { type, message } = titleParts(group)
        const status = statusOf(group)
        const isOpen = opened === group.id
        const frames = framesOf(group)
        const occurrences = occurrencesOf(group)
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
                  {group.crash && <span className="shrink-0 font-mono text-xs text-failure">crash</span>}
                  {status.ongoing && <span className="shrink-0 font-mono text-xs text-failure">now</span>}
                  {status.isNew && <span className="shrink-0 font-mono text-xs text-yellow">new</span>}
                </span>
                <span className="truncate pl-[1.125rem] text-sm text-muted-foreground">
                  {group.lastComponent}: {message ?? group.culprit}
                </span>
              </span>
              <span className="hidden md:block" title="Each bar is an hour of the last day">
                <HourBars hourly={group.hourly} />
              </span>
              <span className="text-right font-mono">{count(group.occurrences)}</span>
              <ChevronDownIcon
                className={cn(
                  "hidden size-4 text-muted-foreground transition-transform duration-200 ease-(--ease-out) md:block",
                  isOpen && "rotate-180",
                )}
              />
            </button>
            {isOpen && (
              <div className="flex flex-col gap-5 border-t bg-background/60 px-5 py-5">
                <p className="text-sm text-muted-foreground">
                  {count(group.occurrences)} times
                  {group.people !== undefined && ` for ${count(group.people)} people`} since {moment(group.firstSeen)};
                  last {ago(group.lastSeen, now)}, in {group.lastComponent}
                  {group.lastRelease !== undefined && ` ${group.lastRelease}`}.
                </p>
                <div className="grid gap-5 lg:grid-cols-2">
                  <div className="flex min-w-0 flex-col gap-5">
                    {frames === undefined ? (
                      <p className="font-mono text-[13px] text-muted-foreground">{group.culprit}</p>
                    ) : (
                      <Stack frames={frames} />
                    )}
                    {group.releases.length > 0 && <ByRelease group={group} />}
                  </div>
                  <div className="min-w-0">
                    {group.trail !== undefined && <Trail trail={group.trail} project={project} />}
                    {group.trail === undefined && occurrences.length > 0 && (
                      <BrokenRequests lines={occurrences} project={project} />
                    )}
                  </div>
                </div>
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
