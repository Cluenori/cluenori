import { cn } from "cn"
import { ArrowLeftIcon, ListTreeIcon, MousePointerClickIcon, ScrollTextIcon } from "lucide-react"
import { useState } from "react"

import { duration, moment, preciseTime } from "@/lib/format"
import { roleOf, traceOf } from "@/project-facts"
import { Link } from "@/router"
import { Panel } from "@/views/panel"
import { buttonVariants } from "@/views/ui/button"
import { stepKindOf, stepKinds, Waterfall } from "@/views/waterfall"

const levelColor = { info: "bg-muted-foreground", warn: "bg-yellow", error: "bg-failure" } as const

const isApp = (component: string) => roleOf(component) === "app"

const attributeText = (value: string | number | boolean) => {
  if (typeof value === "boolean") {
    return value ? "true" : "false"
  }
  return typeof value === "number" ? `${value}` : value
}

/**
 * One request across components: every step it took, from the app that started it, if one did,
 * through the backends that answered; how long each ran; and every line it logged.
 */
export function TracePage({ project, trace }: { readonly project: string; readonly trace: string }) {
  // The sample has one trace; every link opens it.
  const view = traceOf(trace)
  const root = view.spans[0]
  const [selected, setSelected] = useState(root?.span)
  if (root === undefined) {
    return null
  }
  const span = view.spans.find((entry) => entry.span === selected) ?? root
  const sum = (kind: "database" | "call") =>
    view.spans
      .filter((entry) => stepKindOf(entry, isApp) === kind)
      .reduce((total, entry) => total + entry.durationMs, 0)
  const counted = (kind: "database" | "call") => view.spans.filter((entry) => stepKindOf(entry, isApp) === kind).length
  // The first backend that answered, when the request started in an app.
  const served = isApp(root.component) ? view.spans.find((entry) => stepKindOf(entry, isApp) === "request") : undefined

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3 pb-2">
        <Link
          to={{ page: "performance", project }}
          aria-label="Back to the performance"
          className={buttonVariants({ variant: "outline", size: "icon" })}
        >
          <ArrowLeftIcon />
        </Link>
        <div className="flex min-w-0 flex-col">
          <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-[-0.02em]">
            {root.name}
            {root.failed && (
              <span className="border border-failure/60 px-2 py-0.5 font-mono text-sm font-normal text-failure">
                failed
              </span>
            )}
          </h1>
          <p className="text-sm text-muted-foreground">
            {root.component}, <span className="font-mono">{moment(root.start)}</span>
          </p>
        </div>
      </header>

      <div className="grid items-start gap-4 xl:grid-cols-12">
        <Panel
          icon={ListTreeIcon}
          title="Steps"
          subtitle="Each step under the one that started it"
          className="xl:col-span-8"
          stats={[
            { label: "Took", value: duration(root.durationMs), ...(root.failed ? { color: "var(--failure)" } : {}) },
            ...(served === undefined
              ? [{ label: "Steps", value: `${view.spans.length}` }]
              : [
                  {
                    label: `At ${served.component}`,
                    value: duration(served.durationMs),
                    color: stepKinds.request.color,
                  },
                ]),
            {
              label: "Database",
              value: `${duration(sum("database"))}, ${counted("database")}`,
              color: stepKinds.database.color,
            },
            {
              label: "External calls",
              value: `${duration(sum("call"))}, ${counted("call")}`,
              color: stepKinds.call.color,
            },
          ]}
        >
          <div className="pt-4">
            <Waterfall trace={view} selected={span.span} onSelect={setSelected} isApp={isApp} />
          </div>
        </Panel>

        <Panel
          icon={MousePointerClickIcon}
          title={span.name}
          subtitle={`${stepKinds[stepKindOf(span, isApp)].label}, ${duration(span.durationMs)}`}
          className="xl:col-span-4"
        >
          <div className="flex flex-col gap-4 px-5 py-5">
            <p className="text-sm text-muted-foreground">
              In {span.component}, starting{" "}
              {span.start === root.start ? "with the request" : `${duration(span.start - root.start)} in`}.
            </p>
            {span.statusMessage !== undefined && (
              <p className="border-l-2 border-failure bg-failure/[0.07] px-3 py-2 text-sm text-failure">
                {span.statusMessage}
              </p>
            )}
            {Object.keys(span.attributes).length === 0 ? (
              <p className="text-sm text-muted-foreground">This step sent no details.</p>
            ) : (
              <dl className="flex flex-col divide-y border text-[13px]">
                {Object.entries(span.attributes).map(([key, value]) => (
                  <div key={key} className="flex flex-col gap-0.5 px-3 py-2">
                    <dt className="font-mono text-muted-foreground">{key}</dt>
                    <dd className="font-mono break-all">{attributeText(value)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        </Panel>

        <Panel
          icon={ScrollTextIcon}
          title="Log lines"
          subtitle="Everything it logged, at every level"
          className="xl:col-span-8"
        >
          <ol className="divide-y">
            {view.logs.map((log) => (
              <li key={`${log.time} ${log.message}`}>
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
                    +{duration(log.time - root.start)}
                  </span>
                  <span className="hidden font-mono text-[13px] text-muted-foreground md:block">
                    {preciseTime(log.time)}
                  </span>
                  <span className={cn("size-2 rounded-full", levelColor[log.level])} />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{log.message}</span>
                    <span className="truncate font-mono text-xs text-muted-foreground">{log.category}</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </Panel>
      </div>
    </div>
  )
}
