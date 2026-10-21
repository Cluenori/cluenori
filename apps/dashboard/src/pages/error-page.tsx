import type { ComponentKey, ProjectKey, TraceId } from "@cluenori/foundation"
import type { ErrorGroupId, LogLine, TraceSpan } from "@cluenori/signals"
import { errorStatusOf } from "@cluenori/signals"
import { useAtomValue } from "@effect/atom-react"
import { cn } from "cn"
import { DateTime } from "effect"
import { AsyncResult } from "effect/reactivity"
import {
  ArrowLeftIcon,
  BugIcon,
  CalendarClockIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FileTextIcon,
  MessageSquareTextIcon,
  WaypointsIcon,
} from "lucide-react"
import type { ReactNode } from "react"
import { useState } from "react"

import { failureColor } from "@/lib/colors"
import { ago, count, duration, moment, preciseTime } from "@/lib/format"
import { errorAtom, logCountsAtom, periodAtom, traceAtom } from "@/project-data"
import {
  columnTimesOf,
  endOf,
  exceptionsOf,
  logColumnsOf,
  periodWords,
  operationSpanOf,
  ticksOf,
  zoneOf,
} from "@/project-facts"
import { Link } from "@/router"
import { AttributeList } from "@/views/attribute-list"
import { BarRows } from "@/views/bar-rows"
import { titleParts } from "@/views/error-group"
import { ExceptionView } from "@/views/exception-view"
import { Loaded } from "@/views/loaded"
import { OperationName } from "@/views/operation-name"
import { Panel, PanelStats } from "@/views/panel"
import { PeriodSwitch } from "@/views/period-switch"
import { TemplateText } from "@/views/template-text"
import { Button, buttonVariants } from "@/views/ui/button"

// The last part of a type's name, as people say it: `BadHttpRequestException`.
const shortName = (type: string) => type.split(".").at(-1) ?? type

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

/** The operation an occurrence was logged in, in a few facts, one click from its whole trace. */
function OperationSummary({
  project,
  line,
  trace,
  operation,
}: {
  readonly project: ProjectKey
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
        to={{ page: "trace", project, trace, around: line.time }}
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

/** An occurrence: its exception beside its operation, then everything it was sent with. */
function OccurrenceDetail({
  project,
  line,
  operation,
}: {
  readonly project: ProjectKey
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
              <OperationSummary project={project} line={line} trace={operation.trace} operation={operation.found} />
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
function TracedOccurrence({
  project,
  line,
  trace,
}: {
  readonly project: ProjectKey
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
            line={line}
            operation={{ trace, found: operationSpanOf(answer, line.span) }}
          />
        </div>
      )}
    </Loaded>
  )
}

/**
 * One error full screen: how often it happened over the period; then one of its latest occurrences,
 * the newest first, stepped through with one click: the exception as it was thrown, with every
 * exception inside it and every frame, beside the operation it happened in, and everything it was sent
 * with.
 */
export function ErrorPage({
  project,
  component,
  error,
}: {
  readonly project: ProjectKey
  readonly component?: ComponentKey
  readonly error: ErrorGroupId
}) {
  const period = useAtomValue(periodAtom)
  const detail = useAtomValue(errorAtom({ project, error }))
  const counts = useAtomValue(logCountsAtom({ project, by: "level", level: "error", error }))
  const [position, setPosition] = useState(0)
  const group = AsyncResult.isSuccess(detail) ? detail.value.group : undefined
  const parts = group === undefined ? undefined : titleParts(group)
  const isLogged = group?.kind === "log"
  const named = parts === undefined ? "Error" : shortName(parts.type)
  const heading = isLogged && group !== undefined ? <TemplateText text={group.title} /> : named
  const back = { page: "errors" as const, project, ...(component === undefined ? {} : { component }) }

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-wrap items-start gap-x-4 gap-y-3 pb-2">
        <Link
          to={back}
          aria-label="Back to the errors"
          className={buttonVariants({ variant: "outline", size: "icon" })}
        >
          <ArrowLeftIcon />
        </Link>
        <div className="flex min-w-0 flex-[1_1_20rem] flex-col gap-1">
          {/* An exception is named by its type, what it said under it; a logged error by its
              message's template, at most two lines, its placeholders dimmed. */}
          <h1
            title={group?.title}
            className={cn(
              "font-semibold tracking-[-0.02em] break-words",
              isLogged ? "line-clamp-2 text-xl leading-snug" : "text-2xl",
            )}
          >
            {heading}
          </h1>
          {group !== undefined && !isLogged && (
            <p className="line-clamp-3 text-[15px] break-words">{parts?.message ?? group.title}</p>
          )}
          <p className="text-sm break-words text-muted-foreground">
            {group === undefined ? "" : `${isLogged ? `${group.culprit}, ` : ""}${group.lastComponent}, `}
            {periodWords[period].toLowerCase()}
          </p>
        </div>
        <PeriodSwitch />
      </header>

      <Loaded result={AsyncResult.all({ detail, counts })}>
        {({ detail: { group: shown, latest }, counts: answer }) => {
          const now = endOf(answer) ?? DateTime.toEpochMillis(shown.lastSeen)
          const marks = errorStatusOf(shown, now)
          const at = Math.min(position, Math.max(0, latest.length - 1))
          const occurrence = latest[at]
          const columns = logColumnsOf(answer, ["error", "fatal"])
          const { startOf } = columnTimesOf(columns)
          return (
            <div className="flex flex-col gap-4">
              <Panel
                icon={CalendarClockIcon}
                title="Occurrences"
                subtitle={`${periodWords[period]}${marks.ongoing ? ", happening now" : ""}${marks.isNew ? ", new" : ""}`}
                badge={zoneOf(answer)}
              >
                <div className="px-5 py-4">
                  <BarRows
                    rowHeight={48}
                    label={`How often ${shown.title} happened over the period.`}
                    rows={[
                      {
                        label: "Occurrences",
                        note: count(shown.occurrences),
                        color: failureColor,
                        values: columns.values,
                      },
                    ]}
                    ticks={ticksOf(columns)}
                    timeOf={(span) => moment(startOf(span.first))}
                  />
                </div>
                <PanelStats
                  stats={[
                    { label: "Occurrences", value: count(shown.occurrences), color: failureColor },
                    { label: "First seen", value: ago(DateTime.toEpochMillis(shown.firstSeen), now) },
                    { label: "Last seen", value: ago(DateTime.toEpochMillis(shown.lastSeen), now) },
                    ...(shown.lastRelease === undefined ? [] : [{ label: "Last release", value: shown.lastRelease }]),
                  ]}
                />
              </Panel>

              {occurrence === undefined ? (
                <p className="text-sm text-muted-foreground">None of its occurrences are in this period.</p>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border bg-card px-5 py-3">
                    <span className="flex min-w-0 flex-col">
                      <span className="text-[15px]">
                        Occurrence of{" "}
                        <span className="font-mono">{moment(DateTime.toEpochMillis(occurrence.time))}</span>
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {count(at + 1)} of the {count(latest.length)} latest, the newest first
                      </span>
                    </span>
                    <span className="ml-auto flex gap-2">
                      <Button variant="outline" size="sm" disabled={at === 0} onClick={() => setPosition(at - 1)}>
                        <ChevronLeftIcon />
                        Newer
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={at === latest.length - 1}
                        onClick={() => setPosition(at + 1)}
                      >
                        Older
                        <ChevronRightIcon />
                      </Button>
                    </span>
                  </div>
                  {occurrence.trace === undefined ? (
                    <OccurrenceDetail project={project} line={occurrence} operation={undefined} />
                  ) : (
                    <TracedOccurrence
                      key={occurrence.id}
                      project={project}
                      line={occurrence}
                      trace={occurrence.trace}
                    />
                  )}
                </>
              )}
            </div>
          )
        }}
      </Loaded>
    </div>
  )
}
