import type { ComponentKey, ProjectKey } from "@cluenori/foundation"
import { useAtomValue } from "@effect/atom-react"
import { DateTime } from "effect"
import { AsyncResult } from "effect/reactivity"
import { ActivityIcon, GaugeIcon } from "lucide-react"

import { failureColor } from "@/lib/colors"
import { count, moment, share } from "@/lib/format"
import { operationsAtom, periodAtom, runsAtom, useComponentKeys, usualOperationsAtom } from "@/project-data"
import {
  colorOf,
  columnTimesOf,
  operationRowsOf,
  periodWords,
  runColumnsOf,
  slowerMeaning,
  ticksOf,
  zoneOf,
} from "@/project-facts"
import { Link, navigate } from "@/router"
import { BarRows } from "@/views/bar-rows"
import { ComponentSwitch } from "@/views/component-switch"
import { Loaded } from "@/views/loaded"
import { byTimeInTotal, OperationTable, sortOperations } from "@/views/operation-table"
import { Panel, PanelStats } from "@/views/panel"
import { PeriodSwitch } from "@/views/period-switch"
import { ProjectHeader } from "@/views/project-header"
import { buttonVariants } from "@/views/ui/button"

// How many operations the summary shows; the operations page lists every one.
const summaryRows = 8

/**
 * Runs of a project's components, or of one: how many over the period and how many failed, then
 * the operations that got slower or take the most time, each one click from its own page, each panel
 * the page's full width.
 */
export function PerformancePage({
  project,
  component,
}: {
  readonly project: ProjectKey
  readonly component?: ComponentKey
}) {
  const scope = { project, ...(component === undefined ? {} : { component }) }
  const period = useAtomValue(periodAtom)
  const components = useComponentKeys(project)
  const runs = useAtomValue(runsAtom(scope))
  const operations = useAtomValue(operationsAtom(scope))
  const compared = useAtomValue(usualOperationsAtom(scope))
  const color = component === undefined ? "var(--blue)" : colorOf(component, components)
  const shown = component ?? "every component"

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 p-4 md:p-6">
      <ProjectHeader
        title="Performance"
        latest={AsyncResult.map(operations, (table) =>
          table.dataUntil === undefined ? undefined : DateTime.toEpochMillis(table.dataUntil),
        )}
      >
        <ComponentSwitch
          components={components}
          value={component}
          allowAll
          onChange={(picked) =>
            navigate(
              { page: "performance", project, ...(picked === undefined ? {} : { component: picked }) },
              { replace: true },
            )
          }
        />
        <PeriodSwitch />
      </ProjectHeader>

      <div className="flex flex-col gap-4">
        <Panel
          icon={ActivityIcon}
          title={`Runs of ${shown}`}
          subtitle={`${periodWords[period]}, and how many failed`}
          badge={AsyncResult.isSuccess(runs) ? zoneOf(runs.value) : undefined}
        >
          <Loaded result={runs}>
            {(series) => {
              const asked = runColumnsOf(series, (point) => point.runs)
              const failed = runColumnsOf(series, (point) => point.errors)
              const { startOf, whenOf } = columnTimesOf(asked)
              const total = series.points.reduce((sum, point) => sum + point.runs, 0)
              const failures = series.points.reduce((sum, point) => sum + point.errors, 0)
              const peak = asked.values.reduce<number | undefined>(
                (best, value, column) =>
                  value !== undefined && (best === undefined || value > (asked.values[best] ?? 0)) ? column : best,
                undefined,
              )
              return (
                <>
                  <div className="p-5">
                    <BarRows
                      rowHeight={64}
                      label={`Runs of ${shown} over the period, ${count(total)} in all, with failed runs in their own row.`}
                      rows={[
                        { label: "Runs", note: count(total), color, values: asked.values },
                        { label: "Failed", note: count(failures), color: failureColor, values: failed.values },
                      ]}
                      ticks={ticksOf(asked)}
                      timeOf={(span) => moment(startOf(span.first))}
                    />
                  </div>
                  <PanelStats
                    stats={[
                      { label: "Runs", value: count(total) },
                      {
                        label: "Error rate",
                        value: share(failures, total),
                        ...(failures > 0 ? { color: failureColor } : {}),
                      },
                      ...(peak === undefined ? [] : [{ label: "Busiest", value: whenOf(peak) }]),
                    ]}
                  />
                </>
              )
            }}
          </Loaded>
        </Panel>

        <Panel
          icon={GaugeIcon}
          title="Operations"
          subtitle="Any that got slower, then the most time in total"
          action={
            <Link
              to={{ page: "operations", project, ...(component === undefined ? {} : { component }) }}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              All operations
            </Link>
          }
        >
          <Loaded result={AsyncResult.all({ operations, compared })}>
            {({ operations: table, compared: usual }) => {
              // Those that got slower first, so they're never below the fold, then the most time in total.
              const byTime = sortOperations(operationRowsOf(table, usual), byTimeInTotal)
              const rows = [
                ...byTime.filter((row) => row.slower !== undefined),
                ...byTime.filter((row) => row.slower === undefined),
              ]
              return (
                <div className="p-5">
                  {rows.length === 0 ? (
                    <p className="py-4 text-sm text-muted-foreground">No runs in this period.</p>
                  ) : (
                    <OperationTable
                      rows={rows.slice(0, summaryRows)}
                      colorOf={(of) => colorOf(of, components)}
                      linkOf={(row) => ({
                        page: "operation",
                        project,
                        component: row.component,
                        operation: row.operation,
                      })}
                    />
                  )}
                  <p className="mt-4 text-sm text-muted-foreground">
                    {rows.length > summaryRows && `${count(summaryRows)} of ${count(rows.length)}. `}
                    {slowerMeaning} Open an operation for its runs and latency over time.
                  </p>
                </div>
              )
            }}
          </Loaded>
        </Panel>
      </div>
    </div>
  )
}
