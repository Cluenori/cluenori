import { cn } from "cn"

import { duration } from "@/lib/format"
import type { TraceLog, TraceSpan, TraceView } from "@/sample/sample-project"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/views/ui/tooltip"

/**
 * What a step of a request did: ran in an app, where the request started; answered a request; asked
 * the database; called another service; or worked.
 */
export type StepKind = "app" | "request" | "database" | "call" | "work"

/** A step's kind; `isApp` says which components are apps, whose steps are the app's own. */
export const stepKindOf = (span: TraceSpan, isApp: (component: string) => boolean): StepKind => {
  if (isApp(span.component)) {
    return "app"
  }
  if (span.kind === "server" || span.kind === "consumer") {
    return "request"
  }
  if (span.kind === "client" && "db.system.name" in span.attributes) {
    return "database"
  }
  return span.kind === "client" || span.kind === "producer" ? "call" : "work"
}

/** Each kind of step's name and color; a failed step is red whatever its kind. */
export const stepKinds: Readonly<Record<StepKind, { readonly label: string; readonly color: string }>> = {
  app: { label: "App", color: "var(--pink)" },
  request: { label: "Server", color: "var(--blue)" },
  database: { label: "Database", color: "var(--purple)" },
  call: { label: "External call", color: "var(--sky)" },
  work: { label: "Internal", color: "var(--mint)" },
}

const logColor: Readonly<Record<TraceLog["level"], string>> = {
  info: "bg-muted-foreground",
  warn: "bg-yellow",
  error: "bg-failure",
}

const ticks = [0, 0.25, 0.5, 0.75, 1]

// The first label starts at its tick, the last ends at it, and the others are centered on theirs.
const tickAlignment = (tick: number) => {
  if (tick === 0) {
    return ""
  }
  return tick === 1 ? "-translate-x-full" : "-translate-x-1/2"
}

/**
 * A request's steps on one time line, as a tree: each row a step under the one that started it,
 * its bar where and how long it ran, in its kind's color, or red if it failed. Log lines are marks
 * on their step's row. Choosing a row shows that step.
 */
export function Waterfall({
  trace,
  selected,
  onSelect,
  isApp,
}: {
  readonly trace: TraceView
  readonly selected: string | undefined
  readonly onSelect: (span: string) => void
  readonly isApp: (component: string) => boolean
}) {
  const start = Math.min(...trace.spans.map((span) => span.start))
  const end = Math.max(...trace.spans.map((span) => span.start + span.durationMs))
  const total = Math.max(1, end - start)
  const placeOf = (time: number) => ((time - start) / total) * 100

  return (
    <div className="flex flex-col text-sm">
      <div className="grid grid-cols-[minmax(9rem,16rem)_1fr_4.5rem] gap-4 border-b px-5 pb-2 font-mono text-[13px] text-muted-foreground">
        <span className="font-sans">Step</span>
        <span className="relative h-4">
          {ticks.map((tick) => (
            <span
              key={tick}
              className={cn("absolute whitespace-nowrap", tickAlignment(tick))}
              style={{ left: `${tick * 100}%` }}
            >
              {duration(tick * total)}
            </span>
          ))}
        </span>
        <span className="text-right font-sans">Took</span>
      </div>
      <ol>
        {trace.spans.map((span) => {
          const logs = trace.logs.filter((log) => log.span === span.span)
          const isSelected = selected === span.span
          const color = span.failed ? "var(--failure)" : stepKinds[stepKindOf(span, isApp)].color
          return (
            <li key={span.span}>
              <button
                type="button"
                onClick={() => onSelect(span.span)}
                aria-pressed={isSelected}
                className={cn(
                  "grid w-full grid-cols-[minmax(9rem,16rem)_1fr_4.5rem] items-center gap-4 px-5 text-left outline-none hover:bg-accent/60 focus-visible:bg-accent",
                  isSelected && "bg-accent hover:bg-accent",
                )}
              >
                <span className="flex h-10 min-w-0 items-stretch">
                  {Array.from({ length: span.depth }, (_, level) => (
                    <span key={level} aria-hidden className="ml-1.5 w-3 shrink-0 border-l border-border" />
                  ))}
                  <span className={cn("flex min-w-0 items-center gap-2 pl-1.5", span.depth === 0 && "font-medium")}>
                    <span className="size-2 shrink-0" style={{ backgroundColor: color }} />
                    <span className={cn("truncate", span.failed && "text-failure")}>{span.name}</span>
                  </span>
                </span>
                <span className="relative h-10 bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px)] bg-size-[25%_100%]">
                  <span
                    className="absolute top-1/2 h-3 -translate-y-1/2"
                    style={{
                      left: `${placeOf(span.start)}%`,
                      width: `max(3px, ${(span.durationMs / total) * 100}%)`,
                      backgroundColor: color,
                    }}
                  />
                  {logs.map((log) => (
                    <Tooltip key={`${log.time} ${log.message}`}>
                      <TooltipTrigger
                        render={<span />}
                        className={cn(
                          "absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 ring-2 ring-card",
                          logColor[log.level],
                        )}
                        style={{ left: `${placeOf(log.time)}%` }}
                      />
                      <TooltipContent className="max-w-sm">{log.message}</TooltipContent>
                    </Tooltip>
                  ))}
                </span>
                <span
                  className={cn(
                    "text-right font-mono text-[13px]",
                    span.failed ? "text-failure" : "text-muted-foreground",
                  )}
                >
                  {duration(span.durationMs)}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
      <div className="flex flex-wrap gap-x-5 gap-y-2 border-t px-5 py-3 text-sm text-muted-foreground">
        {Object.values(stepKinds)
          .filter((kind) => trace.spans.some((span) => stepKinds[stepKindOf(span, isApp)] === kind))
          .map((kind) => (
            <span key={kind.label} className="flex items-center gap-2">
              <span className="size-2" style={{ backgroundColor: kind.color }} />
              {kind.label}
            </span>
          ))}
        <span className="flex items-center gap-2">
          <span className="size-2 bg-failure" />
          Failed
        </span>
      </div>
    </div>
  )
}
