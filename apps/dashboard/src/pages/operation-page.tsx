import type { ComponentKey, EnvelopeName, EnvironmentKey, ProjectKey, ReleaseVersion } from "@cluenori/foundation"
import type { Incident } from "@cluenori/incidents"
import type { KeptTraceRow } from "@cluenori/signals"
import { operationKeyOf, slowerOf, usualOf } from "@cluenori/signals"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { DateTime } from "effect"
import { AsyncResult } from "effect/reactivity"
import { ActivityIcon, ArrowLeftIcon, CircleXIcon, GaugeIcon, SearchXIcon, SirenIcon, TimerIcon } from "lucide-react"
import type { ReactNode } from "react"
import { useState } from "react"

import { failureColor } from "@/lib/colors"
import { ago, count, duration, moment, share } from "@/lib/format"
import type { Scope } from "@/project-data"
import {
  incidentsAtom,
  operationsAtom,
  keptTracesAtom,
  periodAtom,
  periodMillis,
  loadAtom,
  useComponentKeys,
  usualOperationsAtom,
} from "@/project-data"
import type { Environments } from "@/project-facts"
import {
  colorOf,
  columnTimesOf,
  endOf,
  incidentActionOf,
  keptOverOf,
  loadColumnsOf,
  periodCovering,
  periodWords,
  quietMinutesOf,
  quietWords,
  sumOf,
  ticksOf,
  zoneOf,
} from "@/project-facts"
import type { Filters, Route } from "@/router"
import { Link, navigate } from "@/router"
import type { ColumnSpan } from "@/views/bar-rows"
import { BarRows, largestOf } from "@/views/bar-rows"
import { FilterSwitches } from "@/views/filter-switches"
import { IncidentRow } from "@/views/incident-row"
import { Loaded } from "@/views/loaded"
import { holdingOf, MomentPanel, momentOf } from "@/views/moment-panel"
import { MonitorThis } from "@/views/monitor-this"
import { OperationName } from "@/views/operation-name"
import { Panel, PanelStats } from "@/views/panel"
import { SinceUsual } from "@/views/since-usual"
import { TraceList } from "@/views/trace-list"
import { Button, buttonVariants } from "@/views/ui/button"

// The height of a chart's row. The latency chart is under the load, on the same time axis, so a
// step's count and its p95 line up.
const rowHeight = 64

/** The top of the page: back to every operation, the operation's name, its component, and its switches. */
function OperationHeader({
  back,
  switches,
  children,
}: {
  readonly back: Route
  readonly switches: ReactNode
  readonly children: ReactNode
}) {
  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-3 pb-2">
      <Link
        to={back}
        aria-label="Back to every operation"
        className={buttonVariants({ variant: "outline", size: "icon" })}
      >
        <ArrowLeftIcon />
      </Link>
      {/* At least 16rem, so on a phone the period wraps under the name rather than squeezing it. */}
      <div className="flex min-w-0 flex-[1_1_16rem] flex-col">{children}</div>
      <div className="flex max-w-full min-w-0 flex-wrap items-center gap-3">{switches}</div>
    </header>
  )
}

/** A list of kept traces, or what it would show when it has none. */
function KeptList({
  scope,
  rows,
  slowAfterMs,
  none,
}: {
  readonly scope: Scope
  readonly rows: ReadonlyArray<KeptTraceRow>
  readonly slowAfterMs?: number
  readonly none: string
}) {
  return rows.length === 0 ? (
    <p className="px-5 py-6 text-sm text-muted-foreground">{none}</p>
  ) : (
    <TraceList
      project={scope.project}
      rows={rows}
      traceFilters={{
        ...(scope.environment === undefined ? {} : { environment: scope.environment }),
        ...(scope.release === undefined ? {} : { release: scope.release }),
      }}
      {...(slowAfterMs === undefined ? {} : { slowAfterMs })}
    />
  )
}

/**
 * The operation's slowest requests and its failed ones over the period, each one click from its
 * trace: of each hour, the five slowest and the five slowest failed are kept, 14 days. A duration
 * over the period's p95 is yellow.
 */
function KeptTracePanels({ scope, p95Ms }: { readonly scope: Scope; readonly p95Ms: number }) {
  const period = useAtomValue(periodAtom)
  const kept = useAtomValue(keptTracesAtom(scope))
  return (
    <Loaded result={kept}>
      {(answer) => {
        const over = keptOverOf(answer, period)
        return (
          <div className="flex flex-col gap-4">
            <Panel icon={TimerIcon} title="Slowest requests" subtitle={`Slowest first, ${over}. Each opens its trace`}>
              <KeptList
                scope={scope}
                rows={answer.slowest}
                slowAfterMs={p95Ms}
                none={`No request of the ${over} is kept. Of each hour, the five slowest are kept 14 days.`}
              />
            </Panel>
            <Panel icon={CircleXIcon} title="Failed requests" subtitle={`Newest first, ${over}`}>
              <KeptList scope={scope} rows={answer.failed} none={`Nothing failed in the ${over}.`} />
            </Panel>
          </div>
        )
      }}
    </Loaded>
  )
}

// The operation an incident is about, if any: a failing or stopped one's, or a monitor's of one.
const operationOf = (incident: Incident) => {
  const { evidence } = incident
  switch (evidence._tag) {
    case "down":
      return undefined
    case "monitor":
      return evidence.condition.subject._tag === "operation" ? evidence.condition.subject.operation : undefined
    case "failing":
    case "stopped":
      return evidence.operation
  }
}

/**
 * "Monitor this" for an operation of one component, and, when Cluenori guessed it is quiet, the
 * hint, worded as the guess it is, with a monitor of it as a job one click away. Nothing until the
 * component is known.
 */
function OperationWatch({
  project,
  operation,
  component,
  environment,
}: {
  readonly project: ProjectKey
  readonly operation: EnvelopeName
  readonly component: ComponentKey | undefined
  readonly environment: EnvironmentKey | undefined
}) {
  const incidents = useAtomValue(incidentsAtom(project))
  const [now] = useState(() => DateTime.toEpochMillis(DateTime.nowUnsafe()))
  if (component === undefined) {
    return null
  }
  const quiet = AsyncResult.isSuccess(incidents)
    ? incidents.value.quiet.find(
        (hint) =>
          hint.operation === operation &&
          hint.component === component &&
          (environment === undefined || hint.environment === environment),
      )
    : undefined
  const subject = { _tag: "operation" as const, operation }
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1">
      <MonitorThis project={project} component={component} environment={environment} subject={subject} />
      {quiet !== undefined && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
          <span className="text-yellow-ink">{quietWords(quiet, now)}.</span>
          <MonitorThis
            project={project}
            component={component}
            environment={quiet.environment}
            subject={subject}
            initial={{ kind: "nothingFor", minutes: quietMinutesOf(quiet.usualGapMs) }}
            label="It's a job: monitor it"
          />
        </p>
      )}
    </div>
  )
}

/**
 * The incidents about an operation, of its component and environment when the page shows one: those
 * open, and those resolved in the last 7 days, each opening its own page; nothing when it has none.
 */
function OperationIncidents({
  project,
  operation,
  component,
  environment,
}: {
  readonly project: ProjectKey
  readonly operation: EnvelopeName
  readonly component?: ComponentKey
  readonly environment?: EnvironmentKey
}) {
  const incidents = useAtomValue(incidentsAtom(project))
  if (!AsyncResult.isSuccess(incidents)) {
    return null
  }
  const about = [...incidents.value.open, ...incidents.value.resolved].filter(
    (incident) =>
      operationOf(incident) === operation &&
      (component === undefined || incident.component === component) &&
      (environment === undefined || incident.environment === environment),
  )
  if (about.length === 0) {
    return null
  }
  const looked = incidents.value.checkedAt
  return (
    <Panel icon={SirenIcon} title="Incidents" subtitle="About this operation: open, and resolved in the last 7 days">
      <ul className="divide-y">
        {about.map((incident) => (
          <li key={incident.id}>
            <IncidentRow
              incident={incident}
              now={DateTime.toEpochMillis(looked ?? incident.openedAt)}
              to={incidentActionOf(project, incident).to}
            />
          </li>
        ))}
      </ul>
    </Panel>
  )
}

/**
 * One operation and its requests (`concept/Experience.md`, "Lists, groups and items"): what the
 * period holds of it in a sentence, or that it holds none and when it last ran, with one click to
 * a period that shows it; its load and failures, then its p95 over the same steps, where a click
 * opens that moment, marked within the rest, with the requests kept from it; then its slowest and
 * failed requests, each one click from its trace.
 */
export function OperationPage({
  project,
  component,
  release,
  environments,
  operation,
  at,
}: {
  readonly project: ProjectKey
  readonly component?: ComponentKey
  readonly release?: ReleaseVersion
  readonly environments: Environments
  readonly operation: EnvelopeName
  /** The moment a chart opened, marked on the page. */
  readonly at?: DateTime.Utc
}) {
  const environment = environments.shown
  const filters: Filters = {
    ...(component === undefined ? {} : { component }),
    ...(environment === undefined ? {} : { environment }),
    ...(release === undefined ? {} : { release }),
  }
  const scope = { project, operation, ...filters }
  const componentScope = { project, ...filters }
  const period = useAtomValue(periodAtom)
  const components = useComponentKeys(project)
  const load = useAtomValue(loadAtom(scope))
  const operations = useAtomValue(operationsAtom(scope))
  const everyOperation = useAtomValue(operationsAtom(componentScope))
  const compared = useAtomValue(usualOperationsAtom(scope))
  const setPeriod = useAtomSet(periodAtom)
  const ofMoment = at === undefined ? {} : { at }
  const back: Route = { page: "performance", ...componentScope, ...ofMoment }
  const open = (opened: DateTime.Utc | undefined) =>
    navigate(
      { page: "operation", ...componentScope, operation, ...(opened === undefined ? {} : { at: opened }) },
      { replace: true },
    )
  const periodText = periodWords[period].toLowerCase()
  const shownComponent = component ?? "Every component"

  // Rows have the most counted first. Not handled: shown in every environment, on an older
  // deployment, an operation in several shows the percentiles of the one counted most, while the
  // charts count every environment.
  const verdict = AsyncResult.map(
    AsyncResult.all({ operations, compared }),
    ({ operations: table, compared: usual }) => {
      const row = table.rows[0]
      const timed = row === undefined ? undefined : usualOf(usual, operationKeyOf(row))
      const slower = timed === undefined ? undefined : slowerOf(timed)
      const elsewhere = table.rows.length > 1 && row?.environment !== undefined ? `, in ${row.environment}` : ""
      return { row, timed, slower, elsewhere }
    },
  )
  const known = AsyncResult.isSuccess(verdict) ? verdict.value : undefined

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 p-4 md:p-6">
      <OperationHeader
        back={back}
        switches={
          <FilterSwitches
            project={project}
            filters={filters}
            environments={environments}
            routeOf={(next) => ({ page: "operation", project, ...next, operation, ...ofMoment })}
          />
        }
      >
        <h1 className="flex min-w-0 items-baseline gap-3 text-2xl font-semibold tracking-[-0.02em]">
          <OperationName name={operation} wrap />
          {known?.slower !== undefined && (
            <span className="shrink-0 font-mono text-sm font-normal text-yellow">slower</span>
          )}
        </h1>
        <p className="text-sm text-muted-foreground">
          {known?.row?.component ?? shownComponent}, {periodText}
        </p>
        <OperationWatch
          project={project}
          operation={operation}
          component={component ?? known?.row?.component}
          environment={environment}
        />
      </OperationHeader>

      <Loaded result={AsyncResult.all({ load, everyOperation, verdict, operations })}>
        {({ load: series, everyOperation: all, verdict: { row, timed, slower, elsewhere }, operations: table }) => {
          // Every period the switch offers is kept, so an answer always covers it; the last time it ran
          // stands in otherwise.
          const now =
            endOf(table) ?? endOf(series) ?? (table.lastSeen === undefined ? 0 : DateTime.toEpochMillis(table.lastSeen))
          if (row === undefined) {
            const lastSeen = table.lastSeen === undefined ? undefined : DateTime.toEpochMillis(table.lastSeen)
            const holding =
              lastSeen === undefined || now - lastSeen > periodMillis["90d"]
                ? undefined
                : periodCovering(DateTime.makeUnsafe(lastSeen), DateTime.makeUnsafe(now))
            return (
              <Panel icon={SearchXIcon} title="Requests" subtitle={`${shownComponent}, ${periodText}`}>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-5">
                  {lastSeen === undefined ? (
                    <>
                      <p className="max-w-2xl text-[15px]">
                        {shownComponent} never reported <span className="font-mono">{operation}</span>. It may have been
                        renamed, or the link is from another project.
                      </p>
                      <Link to={back} className={buttonVariants({ variant: "outline", size: "sm" })}>
                        Every operation
                      </Link>
                    </>
                  ) : (
                    <>
                      <p className="text-[15px]">
                        None in the {periodText}. Last ran {ago(lastSeen, now)}, at{" "}
                        <span className="font-mono">{moment(lastSeen)}</span>.
                      </p>
                      {holding === undefined ? (
                        <p className="text-sm text-muted-foreground">
                          That is further back than the longest period, 90 days.
                        </p>
                      ) : (
                        <Button variant="outline" size="sm" onClick={() => setPeriod(holding)}>
                          Show the {periodWords[holding].toLowerCase()}
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </Panel>
            )
          }
          const asked = loadColumnsOf(series, (point) => point.count)
          const failed = loadColumnsOf(series, (point) => point.errors)
          const p95 = loadColumnsOf(series, (point) => point.p95Ms)
          const { startOf } = columnTimesOf(asked)
          const ticks = ticksOf(asked)
          const timeOf = (span: { readonly first: number }) => moment(startOf(span.first))
          const found = at === undefined ? undefined : momentOf(asked, series.covered, at)
          const marking = {
            ...(found === undefined ? {} : { marked: found.column }),
            onPick: (span: ColumnSpan) => open(DateTime.makeUnsafe(startOf(span.first))),
          }
          const timeInTotal = sumOf(
            all.rows.filter((entry) => entry.component === row.component).map((entry) => entry.count * entry.averageMs),
          )
          return (
            <div className="flex flex-col gap-4">
              <p className="max-w-4xl text-[17px] leading-relaxed">
                {count(row.count)} {row.count === 1 ? "request" : "requests"} in the {periodText}
                {elsewhere};{" "}
                <span className={row.errors > 0 ? "text-failure" : ""}>
                  {row.errors === 0 ? "none failed" : `${share(row.errors, row.count)} failed`}
                </span>
                ; p95 <span className="font-mono">{duration(row.p95Ms)}</span>.{" "}
                {slower !== undefined && <span className="text-yellow">Slower than usual.</span>}
              </p>
              <Panel
                icon={ActivityIcon}
                title="Load"
                subtitle={`${periodWords[period]}, and how many failed. Click a moment to open it`}
                badge={zoneOf(series)}
              >
                <div className="p-5">
                  <BarRows
                    rowHeight={rowHeight}
                    label={`The load on ${operation} over the period, ${count(row.count)} in all, with those that failed in their own row.`}
                    rows={[
                      {
                        label: "Total",
                        note: count(row.count),
                        color: colorOf(row.component, components),
                        values: asked.values,
                      },
                      { label: "Failed", note: count(row.errors), color: failureColor, values: failed.values },
                    ]}
                    ticks={ticks}
                    timeOf={timeOf}
                    {...marking}
                  />
                </div>
                <PanelStats
                  stats={[
                    { label: "Total", value: count(row.count) },
                    {
                      label: "Error rate",
                      value: share(row.errors, row.count),
                      ...(row.errors > 0 ? { color: failureColor } : {}),
                    },
                    {
                      label: `Share of ${row.component} time`,
                      value: share(row.count * row.averageMs, timeInTotal),
                    },
                  ]}
                />
              </Panel>

              <Panel icon={GaugeIcon} title="Latency" subtitle={`p95 of each step${elsewhere}`}>
                <div className="p-5">
                  <BarRows
                    rowHeight={rowHeight}
                    label={`The p95 latency of ${operation} over the period; over the whole period it is ${duration(row.p95Ms)}.`}
                    rows={[
                      {
                        label: "p95",
                        note: duration(row.p95Ms),
                        color: colorOf(row.component, components),
                        values: p95.values,
                      },
                    ]}
                    ticks={ticks}
                    timeOf={timeOf}
                    format={duration}
                    combine={largestOf}
                    {...marking}
                  />
                  {timed !== undefined && (
                    <p className="mt-5 text-sm text-muted-foreground">
                      <SinceUsual timed={{ ...timed, ...(slower === undefined ? {} : { slower }) }} />
                    </p>
                  )}
                </div>
                <PanelStats
                  stats={[
                    { label: "p50", value: duration(row.p50Ms) },
                    { label: "p80", value: duration(row.p80Ms) },
                    { label: "p95", value: duration(row.p95Ms) },
                    { label: "p99", value: duration(row.p99Ms) },
                  ]}
                />
              </Panel>

              {at !== undefined && (
                <MomentPanel
                  scope={scope}
                  series={series}
                  at={at}
                  found={found}
                  holding={holdingOf(at, now)}
                  showOperation={false}
                  onShowPeriod={setPeriod}
                  onClose={() => open(undefined)}
                />
              )}

              <OperationIncidents
                project={project}
                operation={operation}
                {...(component === undefined ? {} : { component })}
                {...(environment === undefined ? {} : { environment })}
              />

              <KeptTracePanels scope={scope} p95Ms={row.p95Ms} />
            </div>
          )
        }}
      </Loaded>
    </div>
  )
}
