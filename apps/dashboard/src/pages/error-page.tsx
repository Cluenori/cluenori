import type { ComponentKey, ProjectKey, ReleaseVersion, TraceId } from "@cluenori/foundation"
import type { ErrorGroupId, LogLine, TraceSpan } from "@cluenori/signals"
import { errorStatusOf } from "@cluenori/signals"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { cn } from "cn"
import { DateTime } from "effect"
import { AsyncResult } from "effect/reactivity"
import {
  ArrowLeftIcon,
  BugIcon,
  CalendarClockIcon,
  ChevronRightIcon,
  FileTextIcon,
  ListIcon,
  MessageSquareTextIcon,
  WaypointsIcon,
} from "lucide-react"
import type { ReactNode } from "react"

import { failureColor } from "@/lib/colors"
import { ago, count, duration, moment, preciseTime } from "@/lib/format"
import { errorAtom, logCountsAtom, logLineAtom, periodAtom, periodMillis, traceAtom } from "@/project-data"
import type { Environments } from "@/project-facts"
import {
  columnTimesOf,
  endOf,
  exceptionsOf,
  logColumnsOf,
  periodCovering,
  periodWords,
  operationSpanOf,
  ticksOf,
  zoneOf,
} from "@/project-facts"
import type { Filters } from "@/router"
import { Link } from "@/router"
import { AttributeList } from "@/views/attribute-list"
import { BarRows } from "@/views/bar-rows"
import { CopyButton } from "@/views/copy-button"
import { titleParts } from "@/views/error-group"
import { ExceptionView } from "@/views/exception-view"
import { FilterSwitches } from "@/views/filter-switches"
import { Loaded } from "@/views/loaded"
import { OperationName } from "@/views/operation-name"
import { Panel, PanelStats } from "@/views/panel"
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

// The environment and release the page shows, which a trace opened from it keeps.
type TraceFilters = Pick<Filters, "environment" | "release">

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

/** An occurrence: its exception beside its operation, then everything it was sent with. */
function OccurrenceDetail({
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
function TracedOccurrence({
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

/**
 * One error over the period, a list of its occurrences (`concept/Experience.md`, "Lists, groups and
 * items"): what it is and when it was first and last seen, which no period changes; how often it
 * happened over the period; its latest occurrences there, each opening its own page; and the newest
 * one's exception. A period that holds none of it says so, and when it last happened.
 */
export function ErrorPage({
  project,
  component,
  release,
  environments,
  error,
}: {
  readonly project: ProjectKey
  readonly component?: ComponentKey
  readonly release?: ReleaseVersion
  readonly environments: Environments
  readonly error: ErrorGroupId
}) {
  const environment = environments.shown
  const filters: Filters = {
    ...(component === undefined ? {} : { component }),
    ...(environment === undefined ? {} : { environment }),
    ...(release === undefined ? {} : { release }),
  }
  const period = useAtomValue(periodAtom)
  const setPeriod = useAtomSet(periodAtom)
  const detail = useAtomValue(errorAtom({ project, ...filters, error }))
  const counts = useAtomValue(logCountsAtom({ project, ...filters, by: "level", level: "error", error }))
  const group = AsyncResult.isSuccess(detail) ? detail.value.group : undefined
  const parts = group === undefined ? undefined : titleParts(group)
  const isLogged = group?.kind === "log"
  const named = parts === undefined ? "Error" : shortName(parts.type)
  const heading = isLogged && group !== undefined ? <TemplateText text={group.title} /> : named
  const back = { page: "errors" as const, project, ...filters }
  const inPeriod = periodWords[period].toLowerCase()

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
            {group === undefined ? "" : `${isLogged ? `${group.culprit}, ` : ""}${group.lastComponent}`}
          </p>
        </div>
        <div className="flex max-w-full min-w-0 flex-wrap items-center gap-3">
          <FilterSwitches
            project={project}
            filters={filters}
            environments={environments}
            routeOf={(next) => ({ page: "error", project, ...next, error })}
          />
        </div>
      </header>

      <Loaded result={AsyncResult.all({ detail, counts })}>
        {({ detail: { group: shown, latest }, counts: answer }) => {
          const now = endOf(answer) ?? DateTime.toEpochMillis(shown.lastSeen)
          const lastSeen = DateTime.toEpochMillis(shown.lastSeen)
          const marks = errorStatusOf(shown, now)
          const [newest] = latest
          const columns = logColumnsOf(answer, ["error", "fatal"])
          const { startOf } = columnTimesOf(columns)
          // The shortest period that holds its last occurrence, while occurrences are kept.
          const holding = periodCovering(shown.lastSeen, DateTime.makeUnsafe(now))
          const kept = now - lastSeen <= periodMillis["90d"]
          return (
            <div className="flex flex-col gap-4">
              <Panel
                icon={CalendarClockIcon}
                title="Occurrences"
                subtitle={`${count(shown.occurrences)} in the ${inPeriod}${marks.ongoing ? ", happening now" : ""}${marks.isNew ? ", new" : ""}`}
                badge={zoneOf(answer)}
              >
                {shown.occurrences === 0 ? (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-5">
                    <p className="text-[15px]">
                      None in the {inPeriod}. Last seen {ago(lastSeen, now)}, at{" "}
                      <span className="font-mono">{moment(lastSeen)}</span>.
                    </p>
                    {kept ? (
                      <Button variant="outline" size="sm" onClick={() => setPeriod(holding)}>
                        Show the {periodWords[holding].toLowerCase()}
                      </Button>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Its occurrences are older than the 90 days they are kept.
                      </p>
                    )}
                  </div>
                ) : (
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
                )}
                <PanelStats
                  stats={[
                    {
                      label: "In the period",
                      value: count(shown.occurrences),
                      ...(shown.occurrences > 0 ? { color: failureColor } : {}),
                    },
                    {
                      label: "First seen",
                      value: `${ago(DateTime.toEpochMillis(shown.firstSeen), now)}${shown.firstRelease === undefined ? "" : `, ${shown.firstRelease}`}`,
                    },
                    {
                      label: "Last seen",
                      value: `${ago(lastSeen, now)}${shown.lastRelease === undefined ? "" : `, ${shown.lastRelease}`}`,
                    },
                  ]}
                />
              </Panel>

              {latest.length > 0 && (
                <Panel
                  icon={ListIcon}
                  title="Latest occurrences"
                  subtitle={`The newest first, ${latest.length < shown.occurrences ? `${count(latest.length)} of the ${count(shown.occurrences)}` : "all of them"}`}
                >
                  <ul className="divide-y">
                    {latest.map((line) => (
                      <li key={line.id}>
                        <Link
                          to={{ page: "occurrence", project, error, line: line.id }}
                          className="grid grid-cols-[minmax(0,1fr)] items-center gap-x-5 gap-y-1 px-5 py-3 outline-none hover:bg-accent/60 focus-visible:bg-accent md:grid-cols-[11rem_minmax(0,1fr)_1rem]"
                        >
                          <span className="font-mono text-sm">{moment(DateTime.toEpochMillis(line.time))}</span>
                          <span className="min-w-0 truncate text-sm text-muted-foreground">
                            {line.component}
                            {line.release === undefined ? "" : ` ${line.release}`}
                            {line.environment === undefined ? "" : `, ${line.environment}`}: {line.message}
                          </span>
                          <ChevronRightIcon className="hidden size-4 text-muted-foreground md:block" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Panel>
              )}

              {newest?.exception !== undefined && (
                <Panel
                  icon={BugIcon}
                  title="The newest"
                  subtitle={`As it was thrown, at ${moment(DateTime.toEpochMillis(newest.time))}`}
                >
                  <div className="flex flex-col gap-4 px-5 py-5">
                    <ExceptionView key={newest.id} chain={exceptionsOf(newest.exception)} />
                    <Link
                      to={{ page: "occurrence", project, error, line: newest.id }}
                      className={buttonVariants({ variant: "outline", className: "self-start" })}
                    >
                      Open this occurrence
                    </Link>
                  </div>
                </Panel>
              )}
            </div>
          )
        }}
      </Loaded>
    </div>
  )
}

// What an agent needs to look into one occurrence: where it is, and how to read it and its trace.
const agentBrief = (project: ProjectKey, line: LogLine) =>
  [
    `Investigate this error in Cluenori project ${project}.`,
    `Occurrence ${line.id} of error ${line.error ?? "(none)"}, at ${DateTime.formatIso(line.time)}, in ${line.component}${line.release === undefined ? "" : ` ${line.release}`}${line.environment === undefined ? "" : ` (${line.environment})`}.`,
    line.exception === undefined ? line.message : `${line.exception.type}: ${line.exception.message}`,
    `Read it with the API: GET /api/projects/${project}/logs/lines/${line.id}` +
      (line.error === undefined ? "" : `; its error with ./cluenori error ${project} ${line.error}`) +
      (line.trace === undefined ? "." : `; its trace with ./cluenori trace ${project} ${line.trace}.`),
  ].join("\n")

/**
 * One occurrence of an error, by its ID: the whole of it, with no period or filter, since it is one
 * thing (`concept/Experience.md`): when and where it happened, its exception beside the operation it
 * happened in, and everything it was sent with; one click up to its error.
 */
export function OccurrencePage({
  project,
  error,
  line: id,
}: {
  readonly project: ProjectKey
  readonly error: ErrorGroupId
  readonly line: number
}) {
  const result = useAtomValue(logLineAtom({ project, line: id }))
  const line = AsyncResult.isSuccess(result) ? result.value : undefined
  // An address can name a line of another error: it is no occurrence of this one.
  const ofOther = line !== undefined && line.error !== error
  const named = line?.exception === undefined || ofOther ? "Occurrence" : shortName(line.exception.type)
  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-wrap items-start gap-x-4 gap-y-3 pb-2">
        <Link
          to={{ page: "error", project, error }}
          aria-label="Back to the error"
          className={buttonVariants({ variant: "outline", size: "icon" })}
        >
          <ArrowLeftIcon />
        </Link>
        <div className="flex min-w-0 flex-[1_1_20rem] flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-[-0.02em] break-words">{named}</h1>
          {line !== undefined && !ofOther && (
            <>
              <p className="line-clamp-3 text-[15px] break-words">{line.exception?.message ?? line.message}</p>
              <p className="text-sm break-words text-muted-foreground">
                <span className="font-mono">{preciseTime(DateTime.toEpochMillis(line.time))}</span>, {line.component}
                {line.release === undefined ? "" : ` ${line.release}`}
                {line.environment === undefined ? "" : `, ${line.environment}`}
              </p>
            </>
          )}
        </div>
        <div className="flex max-w-full min-w-0 flex-wrap items-center gap-3">
          <Link to={{ page: "error", project, error }} className={buttonVariants({ variant: "outline", size: "sm" })}>
            Every occurrence
          </Link>
          {line !== undefined && !ofOther && <CopyButton text={agentBrief(project, line)} label="Copy for an agent" />}
        </div>
      </header>
      <Loaded result={result}>
        {(shown) => {
          if (shown.error !== error) {
            return (
              <p role="alert" className="text-sm text-muted-foreground">
                This isn't an occurrence of this error.{" "}
                {shown.error !== undefined && (
                  <Link to={{ page: "occurrence", project, error: shown.error, line: shown.id }} className="underline">
                    Open it under its own error
                  </Link>
                )}
              </p>
            )
          }
          const traceFilters: TraceFilters = {
            ...(shown.environment === undefined ? {} : { environment: shown.environment }),
            ...(shown.release === undefined ? {} : { release: shown.release }),
          }
          return shown.trace === undefined ? (
            <div className="flex flex-col gap-4">
              <OccurrenceDetail project={project} traceFilters={traceFilters} line={shown} operation={undefined} />
            </div>
          ) : (
            <TracedOccurrence project={project} traceFilters={traceFilters} line={shown} trace={shown.trace} />
          )
        }}
      </Loaded>
    </div>
  )
}
