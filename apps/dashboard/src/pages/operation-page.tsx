import type { ComponentKey, EnvelopeName, ProjectKey, ReleaseVersion } from "@cluenori/foundation"
import type { KeptTraceRow } from "@cluenori/signals"
import { operationKeyOf, slowerOf, usualOf } from "@cluenori/signals"
import { useAtomValue } from "@effect/atom-react"
import { AsyncResult } from "effect/reactivity"
import { ActivityIcon, ArrowLeftIcon, CircleXIcon, GaugeIcon, SearchXIcon, TimerIcon } from "lucide-react"
import type { ReactNode } from "react"

import { failureColor } from "@/lib/colors"
import { count, duration, moment, share } from "@/lib/format"
import type { Scope } from "@/project-data"
import {
  operationsAtom,
  keptTracesAtom,
  periodAtom,
  loadAtom,
  useComponentKeys,
  usualOperationsAtom,
} from "@/project-data"
import type { Environments } from "@/project-facts"
import { colorOf, columnTimesOf, keptOverOf, periodWords, loadColumnsOf, sumOf, ticksOf, zoneOf } from "@/project-facts"
import type { Filters, Route } from "@/router"
import { Link } from "@/router"
import { BarRows, largestOf } from "@/views/bar-rows"
import { FilterSwitches } from "@/views/filter-switches"
import { Loaded } from "@/views/loaded"
import { OperationName } from "@/views/operation-name"
import { Panel, PanelStats } from "@/views/panel"
import { SinceUsual } from "@/views/since-usual"
import { TraceList } from "@/views/trace-list"
import { buttonVariants } from "@/views/ui/button"

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
        aria-label="Back to all operations"
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
 * The operation's slowest traces and its failed ones over the period, each one click to open:
 * of each hour, the five slowest and the five slowest failed are kept, 14 days. A duration over the
 * period's p95 is yellow.
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
            <Panel icon={TimerIcon} title="Slowest traces" subtitle={`Slowest first, ${over}`}>
              <KeptList
                scope={scope}
                rows={answer.slowest}
                slowAfterMs={p95Ms}
                none={`No trace of the ${over} is kept. Of each hour, the five slowest are kept 14 days.`}
              />
            </Panel>
            <Panel icon={CircleXIcon} title="Failed traces" subtitle={`Newest first, ${over}`}>
              <KeptList scope={scope} rows={answer.failed} none={`Nothing failed in the ${over}.`} />
            </Panel>
          </div>
        )
      }}
    </Loaded>
  )
}

/**
 * One operation full screen: its load and failures over the period, then its p95 over the same
 * steps, under them, with how the last day compares with its usual p95, and its percentiles; then
 * its slowest and failed traces, each one click to open.
 */
export function OperationPage({
  project,
  component,
  release,
  environments,
  operation,
}: {
  readonly project: ProjectKey
  readonly component?: ComponentKey
  readonly release?: ReleaseVersion
  readonly environments: Environments
  readonly operation: EnvelopeName
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
  const back: Route = { page: "operations", ...componentScope }
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
            routeOf={(next) => ({ page: "operation", project, ...next, operation })}
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
      </OperationHeader>

      <Loaded result={AsyncResult.all({ load, everyOperation, verdict })}>
        {({ load: series, everyOperation: all, verdict: { row, timed, slower, elsewhere } }) => {
          if (row === undefined) {
            return (
              <Panel icon={SearchXIcon} title="Nothing of this operation" subtitle={`${shownComponent}, ${periodText}`}>
                <div className="flex flex-col gap-4 px-5 py-6">
                  <p className="max-w-2xl text-[15px]">
                    {shownComponent} reported no <span className="font-mono">{operation}</span> over the {periodText}.
                    It may have been renamed, or the link is from another project.
                  </p>
                  <Link to={back} className={buttonVariants({ variant: "outline", className: "self-start" })}>
                    All operations
                  </Link>
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
          const timeInTotal = sumOf(
            all.rows.filter((entry) => entry.component === row.component).map((entry) => entry.count * entry.averageMs),
          )
          return (
            <div className="flex flex-col gap-4">
              <Panel
                icon={ActivityIcon}
                title="Load"
                subtitle={`${periodWords[period]}, and how many failed`}
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

              <KeptTracePanels scope={scope} p95Ms={row.p95Ms} />
            </div>
          )
        }}
      </Loaded>
    </div>
  )
}
