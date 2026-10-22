import type { ProjectKey } from "@cluenori/foundation"
import type { LogLevel, LogLine } from "@cluenori/signals"
import { cn } from "cn"
import { DateTime } from "effect"
import { useState } from "react"

import { axisTime, dayOf } from "@/lib/format"
import type { Filters } from "@/router"
import { Link } from "@/router"
import { buttonVariants } from "@/views/ui/button"

const levelColor: Readonly<Record<LogLevel, string>> = {
  trace: "bg-muted-foreground",
  debug: "bg-muted-foreground",
  info: "bg-muted-foreground",
  warn: "bg-yellow",
  error: "bg-failure",
  fatal: "bg-failure",
}

const levelWord: Readonly<Record<LogLevel, string>> = {
  trace: "trace",
  debug: "debug",
  info: "info",
  warn: "warning",
  error: "error",
  fatal: "fatal",
}

/**
 * Log lines, newest first, one line each: when, how serious, what it said. A line opens in place
 * with its logger and component, a link to the release it was written in, and a button to the trace
 * it belongs to.
 */
export function LogList({
  project,
  lines,
  colorOf,
  traceFilters,
}: {
  readonly project: ProjectKey
  readonly lines: ReadonlyArray<LogLine>
  readonly colorOf: (component: string) => string
  /** The environment and release the page shows, which a trace opened from it keeps. */
  readonly traceFilters: Pick<Filters, "environment" | "release">
}) {
  const [opened, setOpened] = useState<number | undefined>(undefined)
  return (
    <ul className="divide-y">
      {lines.map((line) => {
        const isOpen = opened === line.id
        const time = DateTime.toEpochMillis(line.time)
        return (
          <li key={line.id}>
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => setOpened(isOpen ? undefined : line.id)}
              className="grid w-full grid-cols-[3.25rem_0.5rem_minmax(0,1fr)] items-center gap-x-3 px-5 py-2.5 text-left text-sm outline-none hover:bg-accent/60 focus-visible:bg-accent"
            >
              <span className="font-mono text-[13px] text-muted-foreground" title={dayOf(time)}>
                {axisTime(time)}
              </span>
              <span className={cn("size-2 rounded-full", levelColor[line.level])} aria-label={levelWord[line.level]} />
              <span className={cn("truncate", line.level === "fatal" && "text-failure")}>{line.message}</span>
            </button>
            {isOpen && (
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t bg-background/60 px-5 py-3 pl-[5.5rem] text-sm">
                <span className="flex items-center gap-2">
                  <span className="size-2" style={{ backgroundColor: colorOf(line.component) }} />
                  {line.component}
                </span>
                <span className="min-w-0 truncate font-mono text-[13px] text-muted-foreground">{line.category}</span>
                {line.release !== undefined && (
                  <Link
                    to={{
                      page: "release",
                      project,
                      component: line.component,
                      release: line.release,
                      ...(line.environment === undefined ? {} : { environment: line.environment }),
                    }}
                    className="min-w-0 truncate underline-offset-4 hover:underline"
                  >
                    Release <span className="font-mono">{line.release}</span>
                  </Link>
                )}
                {line.trace !== undefined && (
                  <Link
                    to={{ page: "trace", project, trace: line.trace, around: line.time, ...traceFilters }}
                    className={buttonVariants({ variant: "outline", size: "sm", className: "ml-auto" })}
                  >
                    Open the trace
                  </Link>
                )}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
