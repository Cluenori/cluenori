import type { ProjectKey, TraceId } from "@cluenori/foundation"
import type { LogLine, TraceSpan } from "@cluenori/signals"
import { useAtomValue } from "@effect/atom-react"
import { cn } from "cn"
import { DateTime } from "effect"
import { BugIcon, FileTextIcon, MessageSquareTextIcon, WaypointsIcon } from "lucide-react"
import type { ReactNode } from "react"

import { duration, preciseTime } from "@/lib/format"
import { traceAtom } from "@/project-data"
import { exceptionsOf, operationSpanOf } from "@/project-facts"
import type { Filters } from "@/router"
import { Link } from "@/router"
import { AttributeList } from "@/views/attribute-list"
import { ExceptionView } from "@/views/exception-view"
import { Loaded } from "@/views/loaded"
import { OperationName } from "@/views/operation-name"
import { Panel } from "@/views/panel"
import { buttonVariants } from "@/views/ui/button"

const textOf = (value: unknown) => (typeof value === "string" || typeof value === "number" ? `${value}` : undefined)

/** A few facts, a label beside each value, in a compact column. */
function Facts({ rows }: { readonly rows: ReadonlyArray<{ readonly label: string; readonly value: ReactNode }> }) {
  return (
    <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
      {rows.map((row) => (
        <div key={row.label} className="contents">
          <dt className="text-muted-foreground">{row.label}</dt>
          <dd className="min-w-0 break-words">{row.value}</dd>
        </div>
      ))}
    </dl>
  )
}

// The environment and release the page shows, which a trace opened from it keeps.
export type TraceFilters = Pick<Filters, "environment" | "release">

/** The operation an occurrence was logged in, in a few facts, one click from its whole trace. */
function OperationSummary({
  project,
  traceFilters,
  line,
  trace,
  operation,
}: {
  readonly project: ProjectKey
  readonly traceFilters: TraceFilters
  readonly line: LogLine
  readonly trace: TraceId
  readonly operation: TraceSpan | undefined
}) {
  if (operation === undefined) {
    return <p className="text-sm text-muted-foreground">The archive has none of its steps from around then.</p>
  }
  const status = operation.attributes["http.response.status_code"]
  const path = textOf(operation.attributes["url.path"])
  const client = textOf(operation.attributes["user_agent.original"])
  return (
    <div className="flex h-full flex-col gap-4">
      <OperationName name={operation.name} wrap className="text-[15px]" />
      <Facts
        rows={[
          ...(typeof status === "number"
            ? [
                {
                  label: "Status",
                  value: <span className={cn("font-mono", status >= 500 && "text-failure")}>{status}</span>,
                },
              ]
            : []),
          { label: "Took", value: <span className="font-mono">{duration(operation.durationMs)}</span> },
          ...(path === undefined
            ? []
            : [{ label: "Path", value: <span className="font-mono text-[13px] wrap-anywhere">{path}</span> }]),
          ...(client === undefined ? [] : [{ label: "Client", value: client }]),
          {
            label: "Component",
            value: (
              <>
                {operation.component}
                {line.release !== undefined && <span className="font-mono text-muted-foreground"> {line.release}</span>}
              </>
            ),
          },
          ...(line.environment === undefined ? [] : [{ label: "Environment", value: line.environment }]),
          {
            label: "Started",
            value: <span className="font-mono">{preciseTime(DateTime.toEpochMillis(operation.start))}</span>,
          },
        ]}
      />
      <Link
        to={{ page: "trace", project, trace, around: line.time, ...traceFilters }}
        className={buttonVariants({ variant: "outline", className: "mt-auto self-start" })}
      >
        Open the trace
      </Link>
    </div>
  )
}

/** Everything an occurrence was sent with: its log record's fields and attributes, and its operation's. */
function SentWith({ line, operation }: { readonly line: LogLine; readonly operation: TraceSpan | undefined }) {
  return (
    <div className="grid gap-x-6 gap-y-5 p-5 lg:grid-cols-2">
      <section aria-label="The log record" className="flex min-w-0 flex-col gap-3">
        <span className="text-sm text-muted-foreground">The log record</span>
        <Facts
          rows={[
            { label: "Logger", value: <span className="font-mono text-[13px] wrap-anywhere">{line.category}</span> },
            { label: "Message", value: <span className="whitespace-pre-wrap">{line.message}</span> },
            ...(line.template === undefined
              ? []
              : [
                  {
                    label: "Template",
                    value: <span className="font-mono text-[13px] wrap-anywhere">{line.template}</span>,
                  },
                ]),
          ]}
        />
        <AttributeList attributes={line.attributes} empty="It carried nothing else." />
      </section>
      <section aria-label="The operation" className="flex min-w-0 flex-col gap-3">
        <span className="text-sm text-muted-foreground">The operation</span>
        {operation === undefined ? (
          <p className="text-sm text-muted-foreground">There is no operation to show.</p>
        ) : (
          <AttributeList attributes={operation.attributes} empty="It sent no details." />
        )}
      </section>
    </div>
  )
}

/**
 * One warning or error whole: its exception, or its message, beside the operation it was logged in,
 * then everything it was sent with. An occurrence of an error shows the same as a log line.
 */
export function OccurrenceDetail({
  project,
  traceFilters,
  line,
  operation,
}: {
  readonly project: ProjectKey
  readonly traceFilters: TraceFilters
  readonly line: LogLine
  /** The operation it happened in, once its trace is read; absent when it was logged outside one. */
  readonly operation: { readonly trace: TraceId; readonly found: TraceSpan | undefined } | undefined
}) {
  return (
    <>
      <div className="grid gap-4 xl:grid-cols-12">
        {line.exception === undefined ? (
          <Panel icon={MessageSquareTextIcon} title="Message" subtitle="As it was logged" className="xl:col-span-8">
            <p className="px-5 py-5 text-[15px] break-words whitespace-pre-wrap">{line.message}</p>
          </Panel>
        ) : (
          <Panel
            icon={BugIcon}
            title="Exception"
            subtitle="As it was thrown: every exception inside it, and every frame"
            className="xl:col-span-8"
          >
            <div className="px-5 py-5">
              <ExceptionView key={line.id} chain={exceptionsOf(line.exception)} />
            </div>
          </Panel>
        )}
        <Panel icon={WaypointsIcon} title="Operation" subtitle="The operation it happened in" className="xl:col-span-4">
          <div className="flex-1 px-5 py-5">
            {operation === undefined ? (
              <p className="text-sm text-muted-foreground">
                It was logged outside any operation, such as while its service started.
              </p>
            ) : (
              <OperationSummary
                project={project}
                traceFilters={traceFilters}
                line={line}
                trace={operation.trace}
                operation={operation.found}
              />
            )}
          </div>
        </Panel>
      </div>
      <Panel icon={FileTextIcon} title="Sent with" subtitle="Everything the log record and its operation carried">
        <SentWith line={line} operation={operation?.found} />
      </Panel>
    </>
  )
}

/** An occurrence logged in an operation: its trace is read first, from the archive around then. */
export function TracedOccurrence({
  project,
  traceFilters,
  line,
  trace,
}: {
  readonly project: ProjectKey
  readonly traceFilters: TraceFilters
  readonly line: LogLine
  readonly trace: TraceId
}) {
  const view = useAtomValue(traceAtom({ project, trace, around: line.time }))
  return (
    <Loaded result={view}>
      {(answer) => (
        <div className="flex flex-col gap-4">
          <OccurrenceDetail
            project={project}
            traceFilters={traceFilters}
            line={line}
            operation={{ trace, found: operationSpanOf(answer, line.span) }}
          />
        </div>
      )}
    </Loaded>
  )
}
