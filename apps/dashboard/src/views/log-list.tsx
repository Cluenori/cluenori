import { cn } from "cn"
import { useState } from "react"

import { axisTime, dayOf } from "@/lib/format"
import { Link } from "@/router"
import type { LogLine } from "@/sample/sample-project"
import { buttonVariants } from "@/views/ui/button"

const levelColor: Readonly<Record<LogLine["level"], string>> = {
  warn: "bg-yellow",
  error: "bg-failure",
  fatal: "bg-failure",
}

const levelWord: Readonly<Record<LogLine["level"], string>> = { warn: "warning", error: "error", fatal: "fatal" }

/**
 * Log lines, newest first, one line each: when, how serious, what it said. A line opens in place
 * with its logger and component, and a button to the request it belongs to.
 */
export function LogList({
  project,
  lines,
  colorOf,
}: {
  readonly project: string
  readonly lines: ReadonlyArray<LogLine>
  readonly colorOf: (component: string) => string
}) {
  const [opened, setOpened] = useState<number | undefined>(undefined)
  return (
    <ul className="divide-y">
      {lines.map((line) => {
        const isOpen = opened === line.id
        return (
          <li key={line.id}>
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => setOpened(isOpen ? undefined : line.id)}
              className="grid w-full grid-cols-[3.25rem_0.5rem_minmax(0,1fr)] items-center gap-x-3 px-5 py-2.5 text-left text-sm outline-none hover:bg-accent/60 focus-visible:bg-accent"
            >
              <span className="font-mono text-[13px] text-muted-foreground" title={dayOf(line.time)}>
                {axisTime(line.time)}
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
                {line.trace !== undefined && (
                  <Link
                    to={{ page: "trace", project, trace: line.trace }}
                    className={buttonVariants({ variant: "outline", size: "sm", className: "ml-auto" })}
                  >
                    Open the request
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
