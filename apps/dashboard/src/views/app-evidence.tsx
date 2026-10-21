import type { ProjectKey } from "@cluenori/foundation"
import { cn } from "cn"
import { DateTime } from "effect"

import { duration, share } from "@/lib/format"
import { Link } from "@/router"
import type { TrailEvent } from "@/sample/sample-project"
import { OperationName } from "@/views/operation-name"
import { buttonVariants } from "@/views/ui/button"

// What an app's error will show once the API carries it: how it spreads over releases, and what the
// app did before it. The design kit shows them on sample data until then.

/** How an error spreads over releases: each release's share of its occurrences, the newest first. */
export function ByRelease({
  releases,
  occurrences,
}: {
  readonly releases: ReadonlyArray<{ readonly release: string; readonly occurrences: number }>
  readonly occurrences: number
}) {
  const most = Math.max(1, ...releases.map((entry) => entry.occurrences))
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm text-muted-foreground">By release</span>
      <ul className="flex flex-col gap-1.5">
        {releases.map((entry) => (
          <li key={entry.release} className="grid grid-cols-[8rem_minmax(0,1fr)_3.5rem] items-center gap-3 text-sm">
            <span className="truncate font-mono text-[13px]">{entry.release}</span>
            <span className="h-2 bg-muted">
              <span className="block h-full bg-failure" style={{ width: `${(entry.occurrences / most) * 100}%` }} />
            </span>
            <span className="text-right font-mono text-[13px] text-muted-foreground">
              {share(entry.occurrences, occurrences)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// What a trail's event says, in a few words.
function TrailText({ event, project }: { readonly event: TrailEvent; readonly project: ProjectKey }) {
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
          <OperationName name={event.endpoint} className="max-w-full" />
          <span
            className={cn(
              "shrink-0 font-mono text-[13px]",
              event.status >= 500 ? "text-failure" : "text-muted-foreground",
            )}
          >
            {event.status}, {duration(event.durationMs)}
          </span>
          <Link
            to={{ page: "trace", project, trace: event.trace, around: DateTime.makeUnsafe(event.time) }}
            className={buttonVariants({ variant: "outline", size: "sm", className: "ml-auto shrink-0" })}
          >
            Open the trace
          </Link>
        </span>
      )
  }
}

/**
 * What the app did before the error, in its latest session: screens, what the person did, and the
 * requests it made, each one click from its trace, timed back from the error.
 */
export function Trail({ trail, project }: { readonly trail: ReadonlyArray<TrailEvent>; readonly project: ProjectKey }) {
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
