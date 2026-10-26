import type { ComponentKey, ProjectKey, ReleaseVersion } from "@cluenori/foundation"
import { otherOperations } from "@cluenori/signals"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { DateTime } from "effect"
import { AsyncResult } from "effect/reactivity"
import { ActivityIcon, GaugeIcon, SearchIcon } from "lucide-react"
import { useState } from "react"

import { failureColor } from "@/lib/colors"
import { ago, count, duration, moment, share } from "@/lib/format"
import {
  loadAtom,
  operationsAtom,
  periodAtom,
  periodMillis,
  useComponentKeys,
  usualOperationsAtom,
} from "@/project-data"
import type { Environments } from "@/project-facts"
import {
  colorOf,
  columnTimesOf,
  endOf,
  loadColumnsOf,
  operationRowsOf,
  periodCovering,
  periodWords,
  slowerMeaning,
  ticksOf,
  zoneOf,
} from "@/project-facts"
import type { Filters } from "@/router"
import { navigate } from "@/router"
import { BarRows } from "@/views/bar-rows"
import { FilterSwitches } from "@/views/filter-switches"
import { Loaded } from "@/views/loaded"
import { holdingOf, MomentPanel, momentOf } from "@/views/moment-panel"
import type { Sort } from "@/views/operation-table"
import { byTimeInTotal, OperationTable, sortOperations } from "@/views/operation-table"
import { Panel, PanelStats } from "@/views/panel"
import { ProjectHeader } from "@/views/project-header"
import { Button } from "@/views/ui/button"

/**
 * Every operation of a project, or of one component, in the environment shown, or of one release
 * (`concept/Experience.md`, "Lists, groups and items"): first what the period means in a sentence;
 * then the load, where a click opens that moment, marked within the rest, with the requests kept
 * from it; then every operation, searchable and sortable, those that got slower first, each one
 * click from its own page.
 */
export function PerformancePage({
  project,
  component,
  release,
  environments,
  at,
}: {
  readonly project: ProjectKey
  readonly component?: ComponentKey
  readonly release?: ReleaseVersion
  readonly environments: Environments
  /** The moment a chart opened, marked on the page. */
  readonly at?: DateTime.Utc
}) {
  const environment = environments.shown
  const filters: Filters = {
    ...(component === undefined ? {} : { component }),
    ...(environment === undefined ? {} : { environment }),
    ...(release === undefined ? {} : { release }),
  }
  const scope = { project, ...filters }
  const period = useAtomValue(periodAtom)
  const setPeriod = useAtomSet(periodAtom)
  const components = useComponentKeys(project)
  const load = useAtomValue(loadAtom(scope))
  const operations = useAtomValue(operationsAtom(scope))
  const compared = useAtomValue(usualOperationsAtom(scope))
  const [search, setSearch] = useState("")
  const [sort, setSort] = useState<Sort>(byTimeInTotal)
  const color = component === undefined ? "var(--blue)" : colorOf(component, components)
  const shown = component ?? "every component"
  const inPeriod = periodWords[period].toLowerCase()
  const needle = search.trim().toLowerCase()
  const open = (opened: DateTime.Utc | undefined) =>
    navigate(
      { page: "performance", project, ...filters, ...(opened === undefined ? {} : { at: opened }) },
      { replace: true },
    )

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 p-4 md:p-6">
      <ProjectHeader
        title="Performance"
        latest={AsyncResult.map(operations, (table) =>
          table.dataUntil === undefined ? undefined : DateTime.toEpochMillis(table.dataUntil),
        )}
      >
        <FilterSwitches
          project={project}
          components={components}
          filters={filters}
          environments={environments}
          routeOf={(next) => ({ page: "performance", project, ...next, ...(at === undefined ? {} : { at }) })}
        />
      </ProjectHeader>

      <Loaded result={AsyncResult.all({ load, operations, compared })}>
        {({ load: series, operations: table, compared: usual }) => {
          const rows = operationRowsOf(table, usual)
          const slower = rows.filter((row) => row.slower !== undefined)
          // Every period the switch offers is kept, so an answer always covers it; the last time it ran
          // stands in otherwise.
          const now =
            endOf(table) ?? endOf(series) ?? (table.lastSeen === undefined ? 0 : DateTime.toEpochMillis(table.lastSeen))
          const asked = loadColumnsOf(series, (point) => point.count)
          const failed = loadColumnsOf(series, (point) => point.errors)
          const { startOf } = columnTimesOf(asked)
          const found = at === undefined ? undefined : momentOf(asked, series.covered, at)
          const lastSeen = table.lastSeen === undefined ? undefined : DateTime.toEpochMillis(table.lastSeen)
          // The shortest period that holds the last time anything ran, within the longest.
          const lastHolding =
            lastSeen === undefined || now - lastSeen > periodMillis["90d"]
              ? undefined
              : periodCovering(DateTime.makeUnsafe(lastSeen), DateTime.makeUnsafe(now))
          const byTime = sortOperations(
            rows.filter((row) => needle.length === 0 || row.operation.toLowerCase().includes(needle)),
            sort,
          )
          // Those that got slower first while the order is the default, so they're never below the fold.
          const listed =
            sort === byTimeInTotal
              ? [
                  ...byTime.filter((row) => row.slower !== undefined),
                  ...byTime.filter((row) => row.slower === undefined),
                ]
              : byTime
          return (
            <div className="flex flex-col gap-4">
              <p className="max-w-4xl text-[17px] leading-relaxed">
                {table.count === 0 ? (
                  <>
                    Nothing of {shown} ran in the {inPeriod}.{" "}
                    {lastSeen !== undefined && (
                      <>
                        It last ran {ago(lastSeen, now)}, at <span className="font-mono">{moment(lastSeen)}</span>.
                      </>
                    )}
                  </>
                ) : (
                  <>
                    {count(table.count)} {table.count === 1 ? "request" : "requests"} in the {inPeriod}, across{" "}
                    {count(rows.length)} {rows.length === 1 ? "operation" : "operations"};{" "}
                    <span className={table.errors > 0 ? "text-failure" : ""}>
                      {table.errors === 0 ? "none failed" : `${share(table.errors, table.count)} failed`}
                    </span>
                    .{" "}
                    {slower.length === 0 ? (
                      "None is slower than usual."
                    ) : (
                      <span className="text-yellow">
                        {slower.length === 1
                          ? `${slower[0]?.operation} got slower: p95 ${duration(slower[0]?.slower?.p95Ms ?? 0)}, usually ${duration(slower[0]?.slower?.usualP95Ms ?? 0)}.`
                          : `${count(slower.length)} operations got slower than usual.`}
                      </span>
                    )}
                  </>
                )}
              </p>
              {table.count === 0 && lastHolding !== undefined && (
                <Button variant="outline" size="sm" className="self-start" onClick={() => setPeriod(lastHolding)}>
                  Show the {periodWords[lastHolding].toLowerCase()}
                </Button>
              )}

              <Panel
                icon={ActivityIcon}
                title={`Load on ${shown}`}
                subtitle={`${periodWords[period]}, and how many failed. Click a moment to open it`}
                badge={zoneOf(series)}
              >
                <div className="p-5">
                  <BarRows
                    rowHeight={64}
                    label={`The load on ${shown} over the period, ${count(table.count)} in all, with those that failed in their own row.`}
                    rows={[
                      { label: "Total", note: count(table.count), color, values: asked.values },
                      { label: "Failed", note: count(table.errors), color: failureColor, values: failed.values },
                    ]}
                    ticks={ticksOf(asked)}
                    timeOf={(span) => moment(startOf(span.first))}
                    {...(found === undefined ? {} : { marked: found.column })}
                    onPick={(span) => open(DateTime.makeUnsafe(startOf(span.first)))}
                  />
                </div>
                <PanelStats
                  stats={[
                    { label: "Total", value: count(table.count) },
                    {
                      label: "Error rate",
                      value: share(table.errors, table.count),
                      ...(table.errors > 0 ? { color: failureColor } : {}),
                    },
                    { label: "Operations", value: count(rows.length) },
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
                  showOperation
                  onShowPeriod={setPeriod}
                  onClose={() => open(undefined)}
                />
              )}

              <Panel
                icon={GaugeIcon}
                title={`${count(rows.length)} ${rows.length === 1 ? "operation" : "operations"}`}
                subtitle="Any that got slower first, then the most time in total. Open one for its requests"
              >
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-5 py-3">
                  <label className="flex h-9 min-w-48 flex-1 items-center gap-2 border bg-card px-3 focus-within:border-ring sm:max-w-96">
                    <SearchIcon className="size-4 text-muted-foreground" />
                    <span className="sr-only">Search the operations</span>
                    <input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Search operations, such as /api/notes"
                      className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                    />
                  </label>
                  {sort !== byTimeInTotal && (
                    <button
                      type="button"
                      onClick={() => setSort(byTimeInTotal)}
                      className="text-sm text-muted-foreground underline decoration-foreground/30 underline-offset-4 hover:text-foreground"
                    >
                      Sort by time in total
                    </button>
                  )}
                </div>
                <div className="p-5">
                  {listed.length === 0 ? (
                    <p className="py-4 text-sm text-muted-foreground">
                      {rows.length === 0
                        ? `Nothing of ${shown} ran in the ${inPeriod}.`
                        : `No operation matches “${search.trim()}”.`}
                    </p>
                  ) : (
                    <OperationTable
                      rows={listed}
                      colorOf={(of) => colorOf(of, components)}
                      linkOf={(row) => ({
                        page: "operation",
                        project,
                        ...filters,
                        component: row.component,
                        operation: row.operation,
                        ...(at === undefined ? {} : { at }),
                      })}
                      sort={sort}
                      onSort={setSort}
                    />
                  )}
                  <p className="mt-4 text-sm text-muted-foreground">
                    {slowerMeaning} Percentiles are within 2% of the true value.
                  </p>
                  {rows.some((row) => row.operation === otherOperations) && (
                    <p className="mt-2 text-sm text-muted-foreground">
                      {otherOperations} counts what ran past a component&apos;s first 500 operation names. That many
                      names usually means the app reports raw paths, such as{" "}
                      <span className="font-mono">/api/notes/123</span>, instead of routes, such as{" "}
                      <span className="font-mono">/api/notes/{"{id}"}</span>.
                    </p>
                  )}
                </div>
              </Panel>
            </div>
          )
        }}
      </Loaded>
    </div>
  )
}
