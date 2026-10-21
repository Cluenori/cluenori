import type { ProjectKey, TraceId } from "@cluenori/foundation"
import type { LogLevel, TraceView } from "@cluenori/signals"
import { useAtomValue } from "@effect/atom-react"
import { cn } from "cn"
import { DateTime } from "effect"
import { ArrowLeftIcon, ListTreeIcon, MousePointerClickIcon, ScrollTextIcon, SearchXIcon } from "lucide-react"
import type { ReactNode } from "react"
import { useState } from "react"

import { count, duration, moment, preciseTime } from "@/lib/format"
import { traceAtom } from "@/project-data"
import { Link } from "@/router"
import { AttributeList } from "@/views/attribute-list"
import { Loaded } from "@/views/loaded"
import { Panel, PanelStats } from "@/views/panel"
import { buttonVariants } from "@/views/ui/button"
import { stepKindOf, stepKinds, Waterfall } from "@/views/waterfall"

const levelColor: Readonly<Record<LogLevel, string>> = {
  trace: "bg-muted-foreground",
  debug: "bg-muted-foreground",
  info: "bg-muted-foreground",
  warn: "bg-yellow",
  error: "bg-failure",
  fatal: "bg-failure",
}

// Which components are apps isn't known yet, so every step is a server's, a call's, or work.
const noApps = () => false

const millisOf = DateTime.toEpochMillis

/** The top of the page: back to the project's performance, and what the trace is. */
function TraceHeader({ project, children }: { readonly project: ProjectKey; readonly children: ReactNode }) {
  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-3 pb-2">
      <Link
        to={{ page: "performance", project }}
        aria-label="Back to the performance"
        className={buttonVariants({ variant: "outline", size: "icon" })}
      >
        <ArrowLeftIcon />
      </Link>
      <div className="flex min-w-0 flex-col">{children}</div>
    </header>
  )
}

/** Why the page shows no steps, with what the reader can do. */
function NoSteps({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <Panel icon={SearchXIcon} title={title} subtitle="Traces are kept in the archive for 90 days">
      <p className="max-w-2xl px-5 py-6 text-[15px]">{children}</p>
    </Panel>
  )
}

/** The trace's steps, the one chosen, and its log lines. */
function TraceSteps({ project, view }: { readonly project: ProjectKey; readonly view: TraceView }) {
  const root = view.spans[0]
  const [selected, setSelected] = useState(root?.span)
  if (root === undefined) {
    return (
      <div className="flex flex-col gap-4">
        <TraceHeader project={project}>
          <h1 className="font-mono text-2xl font-semibold tracking-[-0.02em]">{view.trace}</h1>
        </TraceHeader>
        <NoSteps title="No steps of this trace">
          The archive has none of this trace&apos;s steps. It may be older than 90 days, or from another project.
        </NoSteps>
      </div>
    )
  }
  const span = view.spans.find((entry) => entry.span === selected) ?? root
  const ofKind = (kind: "database" | "call") => view.spans.filter((entry) => stepKindOf(entry, noApps) === kind)
  const timeIn = (kind: "database" | "call") => ofKind(kind).reduce((total, entry) => total + entry.durationMs, 0)
  const rootStart = millisOf(root.start)

  return (
    <div className="flex flex-col gap-4">
      <TraceHeader project={project}>
        <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-[-0.02em]">
          {root.name}
          {root.failed && (
            <span className="border border-failure/60 px-2 py-0.5 font-mono text-sm font-normal text-failure">
              failed
            </span>
          )}
        </h1>
        <p className="text-sm text-muted-foreground">
          {root.component}, <span className="font-mono">{moment(rootStart)}</span>
        </p>
      </TraceHeader>

      {view.files.unread > 0 && (
        <p role="status" className="border border-yellow/50 px-5 py-3 text-sm">
          {count(view.files.unread)} of the archive&apos;s files from around then weren&apos;t read, as there were too
          many, so some steps may be missing.
        </p>
      )}

      <div className="grid items-start gap-4 xl:grid-cols-12">
        {/* The steps and their log lines, one under the other; the step chosen beside them, in view as they scroll. */}
        <div className="flex min-w-0 flex-col gap-4 xl:col-span-8">
          <Panel icon={ListTreeIcon} title="Steps" subtitle="Each step under the one that started it">
            <div className="pt-4">
              <Waterfall trace={view} selected={span.span} onSelect={setSelected} isApp={noApps} />
            </div>
            <PanelStats
              stats={[
                {
                  label: "Took",
                  value: duration(root.durationMs),
                  ...(root.failed ? { color: "var(--failure)" } : {}),
                },
                { label: "Steps", value: count(view.spans.length) },
                {
                  label: "Database",
                  value: `${duration(timeIn("database"))}, ${count(ofKind("database").length)}`,
                  color: stepKinds.database.color,
                },
                {
                  label: "External calls",
                  value: `${duration(timeIn("call"))}, ${count(ofKind("call").length)}`,
                  color: stepKinds.call.color,
                },
              ]}
            />
          </Panel>
          <Panel icon={ScrollTextIcon} title="Log lines" subtitle="Everything it logged, at every level">
            {view.logs.length === 0 ? (
              <p className="px-5 py-6 text-sm text-muted-foreground">Nothing was logged in this trace.</p>
            ) : (
              <ol className="divide-y">
                {view.logs.map((log, index) => (
                  <li key={`${millisOf(log.time)} ${index}`}>
                    <button
                      type="button"
                      onClick={() => {
                        if (log.span !== undefined) {
                          setSelected(log.span)
                        }
                      }}
                      className="grid w-full grid-cols-[4.5rem_0.5rem_minmax(0,1fr)] items-center gap-x-3 px-5 py-2.5 text-left text-sm hover:bg-accent/60 md:grid-cols-[4.5rem_8rem_0.5rem_minmax(0,1fr)]"
                    >
                      <span className="font-mono text-[13px] text-muted-foreground">
                        +{duration(Math.max(0, millisOf(log.time) - rootStart))}
                      </span>
                      <span className="hidden font-mono text-[13px] text-muted-foreground md:block">
                        {preciseTime(millisOf(log.time))}
                      </span>
                      <span className={cn("size-2 rounded-full", levelColor[log.level ?? "info"])} />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate">{log.message}</span>
                        <span className="truncate font-mono text-xs text-muted-foreground">{log.category}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>
        <div className="min-w-0 xl:col-span-4 xl:self-stretch">
          <Panel
            icon={MousePointerClickIcon}
            title={span.name}
            subtitle={`${stepKinds[stepKindOf(span, noApps)].label}, ${duration(span.durationMs)}`}
            className="xl:sticky xl:top-4"
          >
            <div className="flex flex-col gap-4 px-5 py-5">
              <p className="text-sm text-muted-foreground">
                In {span.component}, starting{" "}
                {millisOf(span.start) === rootStart
                  ? "with the trace"
                  : `${duration(millisOf(span.start) - rootStart)} in`}
                .
              </p>
              {span.statusMessage !== undefined && (
                <p className="border-l-2 border-failure bg-failure/[0.07] px-3 py-2 text-sm text-failure">
                  {span.statusMessage}
                </p>
              )}
              <AttributeList attributes={span.attributes} empty="This step sent no details." />
            </div>
          </Panel>
        </div>
      </div>
    </div>
  )
}

/**
 * One trace across components: every step it took, through the services that ran it; how long
 * each ran; and every line it logged. It is found in the archive by its ID; the time the address
 * names, as links from errors, logs and runs give it, says which of its files to read first.
 */
export function TracePage({
  project,
  trace,
  around,
}: {
  readonly project: ProjectKey
  readonly trace: TraceId
  readonly around?: DateTime.Utc
}) {
  const view = useAtomValue(traceAtom({ project, trace, ...(around === undefined ? {} : { around }) }))
  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 p-4 md:p-6">
      <Loaded result={view}>{(answer) => <TraceSteps project={project} view={answer} />}</Loaded>
    </div>
  )
}
