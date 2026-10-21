import type { ComponentKey, EnvelopeName, ProjectKey } from "@cluenori/foundation"
import type { KeptRunRow } from "@cluenori/signals"
import { useAtomValue } from "@effect/atom-react"
import { AsyncResult } from "effect/reactivity"
import { ActivityIcon, ArrowLeftIcon, CircleXIcon, GaugeIcon, SearchXIcon, TimerIcon } from "lucide-react"
import type { ReactNode } from "react"

import { failureColor } from "@/lib/colors"
import { count, duration, moment, share } from "@/lib/format"
import type { Scope } from "@/project-data"
import {
  operationsAtom,
  keptRunsAtom,
  periodAtom,
  runsAtom,
  useComponentKeys,
  usualOperationsAtom,
} from "@/project-data"
import {
  colorOf,
  columnTimesOf,
  operationKeyOf,
  keptOverOf,
  periodWords,
  runColumnsOf,
  slowerOf,
  sumOf,
  ticksOf,
  usualOf,
  zoneOf,
} from "@/project-facts"
import type { Route } from "@/router"
import { Link } from "@/router"
import { BarRows, largestOf } from "@/views/bar-rows"
import { Loaded } from "@/views/loaded"
import { OperationName } from "@/views/operation-name"
import { Panel, PanelStats } from "@/views/panel"
import { PeriodSwitch } from "@/views/period-switch"
import { RunList } from "@/views/run-list"
import { SinceUsual } from "@/views/since-usual"
import { buttonVariants } from "@/views/ui/button"

// The height of a chart's row. The latency chart is under the runs, on the same time axis, so a
// step's runs and its p95 line up.
const rowHeight = 64

/** The top of the page: back to every operation, the operation's name, its component, and the period. */
function OperationHeader({ back, children }: { readonly back: Route; readonly children: ReactNode }) {
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
      <PeriodSwitch />
    </header>
  )
}

/** A list of runs, or what it would show when it has none. */
function KeptList({
  project,
  rows,
  slowAfterMs,
  none,
}: {
  readonly project: ProjectKey
  readonly rows: ReadonlyArray<KeptRunRow>
  readonly slowAfterMs?: number
  readonly none: string
}) {
  return rows.length === 0 ? (
    <p className="px-5 py-6 text-sm text-muted-foreground">{none}</p>
  ) : (
    <RunList project={project} rows={rows} {...(slowAfterMs === undefined ? {} : { slowAfterMs })} />
  )
}

/**
 * The operation's slowest runs and its failed ones over the period, each a click from its trace:
 * of each hour, the five slowest and the five slowest failed are kept, 14 days. A duration over the
 * period's p95 is yellow.
 */
function KeptRunPanels({ scope, p95Ms }: { readonly scope: Scope; readonly p95Ms: number }) {
  const period = useAtomValue(periodAtom)
  const kept = useAtomValue(keptRunsAtom(scope))
  return (
    <Loaded result={kept}>
      {(answer) => {
        const over = keptOverOf(answer, period)
        return (
          <div className="flex flex-col gap-4">
            <Panel icon={TimerIcon} title="Slowest runs" subtitle={`Slowest first, ${over}`}>
              <KeptList
                project={scope.project}
                rows={answer.slowest}
                slowAfterMs={p95Ms}
                none={`No run of the ${over} is kept. Of each hour, the five slowest are kept 14 days.`}
              />
            </Panel>
            <Panel icon={CircleXIcon} title="Failed runs" subtitle={`Newest first, ${over}`}>
              <KeptList project={scope.project} rows={answer.failed} none={`No run failed in the ${over}.`} />
            </Panel>
          </div>
        )
      }}
    </Loaded>
  )
}

/**
 * One operation full screen: its runs and failures over the period, then its p95 over the same
 * steps, under them, with how the last day compares with its usual p95, and its percentiles; then
 * its slowest and failed runs, each opening its trace.
 */
export function OperationPage({
  project,
  component,
  operation,
}: {
  readonly project: ProjectKey
  readonly component?: ComponentKey
  readonly operation: EnvelopeName
}) {
  const scope = { project, operation, ...(component === undefined ? {} : { component }) }
  const componentScope = { project, ...(component === undefined ? {} : { component }) }
  const period = useAtomValue(periodAtom)
  const components = useComponentKeys(project)
  const runs = useAtomValue(runsAtom(scope))
  const operations = useAtomValue(operationsAtom(scope))
  const everyOperation = useAtomValue(operationsAtom(componentScope))
  const compared = useAtomValue(usualOperationsAtom(scope))
  const back: Route = { page: "operations", ...componentScope }
  const periodText = periodWords[period].toLowerCase()
  const shownComponent = component ?? "Every component"

  // Rows have the most runs first. Not handled: an operation in several environments shows the
  // percentiles of the one with the most runs, while the charts count every environment; a page for
  // each environment would take an environment in the address and in the series.
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
      <OperationHeader back={back}>
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

      <Loaded result={AsyncResult.all({ runs, everyOperation, verdict })}>
        {({ runs: series, everyOperation: all, verdict: { row, timed, slower, elsewhere } }) => {
          if (row === undefined) {
            return (
              <Panel icon={SearchXIcon} title="No runs of this operation" subtitle={`${shownComponent}, ${periodText}`}>
                <div className="flex flex-col gap-4 px-5 py-6">
                  <p className="max-w-2xl text-[15px]">
                    {shownComponent} had no runs of <span className="font-mono">{operation}</span> over the {periodText}
                    . It may have been renamed, or the link is from another project.
                  </p>
                  <Link to={back} className={buttonVariants({ variant: "outline", className: "self-start" })}>
                    All operations
                  </Link>
                </div>
              </Panel>
            )
          }
          const asked = runColumnsOf(series, (point) => point.runs)
          const failed = runColumnsOf(series, (point) => point.errors)
          const p95 = runColumnsOf(series, (point) => point.p95Ms)
          const { startOf } = columnTimesOf(asked)
          const ticks = ticksOf(asked)
          const timeOf = (span: { readonly first: number }) => moment(startOf(span.first))
          const timeInTotal = sumOf(
            all.rows.filter((entry) => entry.component === row.component).map((entry) => entry.runs * entry.averageMs),
          )
          return (
            <div className="flex flex-col gap-4">
              <Panel
                icon={ActivityIcon}
                title="Runs"
                subtitle={`${periodWords[period]}, and how many failed`}
                badge={zoneOf(series)}
              >
                <div className="p-5">
                  <BarRows
                    rowHeight={rowHeight}
                    label={`Runs of ${operation} over the period, ${count(row.runs)} in all, with failed runs in their own row.`}
                    rows={[
                      {
                        label: "Runs",
                        note: count(row.runs),
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
                    { label: "Runs", value: count(row.runs) },
                    {
                      label: "Error rate",
                      value: share(row.errors, row.runs),
                      ...(row.errors > 0 ? { color: failureColor } : {}),
                    },
                    {
                      label: `Share of ${row.component} time`,
                      value: share(row.runs * row.averageMs, timeInTotal),
                    },
                  ]}
                />
              </Panel>

              <Panel icon={GaugeIcon} title="Latency" subtitle={`p95 of each step's runs${elsewhere}`}>
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

              <KeptRunPanels scope={scope} p95Ms={row.p95Ms} />
            </div>
          )
        }}
      </Loaded>
    </div>
  )
}
