import type { ComponentKey, ProjectKey, ReleaseVersion } from "@cluenori/foundation"
import { otherOperations } from "@cluenori/signals"
import { useAtomValue } from "@effect/atom-react"
import { AsyncResult } from "effect/reactivity"
import { ArrowLeftIcon, GaugeIcon, SearchIcon } from "lucide-react"
import { useState } from "react"

import { count } from "@/lib/format"
import { operationsAtom, periodAtom, useComponentKeys, usualOperationsAtom } from "@/project-data"
import type { Environments } from "@/project-facts"
import { colorOf, operationRowsOf, periodWords, slowerMeaning } from "@/project-facts"
import type { Filters } from "@/router"
import { Link } from "@/router"
import { FilterSwitches } from "@/views/filter-switches"
import { Loaded } from "@/views/loaded"
import type { Sort } from "@/views/operation-table"
import { byTimeInTotal, OperationTable, sortOperations } from "@/views/operation-table"
import { Panel } from "@/views/panel"
import { buttonVariants } from "@/views/ui/button"

/**
 * Every operation of a project, or of one component, in the environment shown, or of one release:
 * searchable, sortable by any column, each one click from its own page. The most time in total
 * comes first.
 */
export function OperationsPage({
  project,
  component,
  release,
  environments,
}: {
  readonly project: ProjectKey
  readonly component?: ComponentKey
  readonly release?: ReleaseVersion
  readonly environments: Environments
}) {
  const environment = environments.shown
  const filters: Filters = {
    ...(component === undefined ? {} : { component }),
    ...(environment === undefined ? {} : { environment }),
    ...(release === undefined ? {} : { release }),
  }
  const scope = { project, ...filters }
  const period = useAtomValue(periodAtom)
  const components = useComponentKeys(project)
  const operations = useAtomValue(operationsAtom(scope))
  const compared = useAtomValue(usualOperationsAtom(scope))
  const [search, setSearch] = useState("")
  const [sort, setSort] = useState<Sort>(byTimeInTotal)
  const needle = search.trim().toLowerCase()
  const periodText = periodWords[period].toLowerCase()
  const shownComponent = component ?? "Every component"

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3 pb-2">
        <Link
          to={{ page: "performance", project, ...filters }}
          aria-label="Back to the performance"
          className={buttonVariants({ variant: "outline", size: "icon" })}
        >
          <ArrowLeftIcon />
        </Link>
        <div className="flex min-w-0 flex-col">
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">Operations</h1>
          <p className="text-sm text-muted-foreground">
            {shownComponent}, {periodText}
          </p>
        </div>
        <div className="ml-auto flex max-w-full min-w-0 flex-wrap items-center gap-3">
          <FilterSwitches
            project={project}
            filters={filters}
            environments={environments}
            routeOf={(next) => ({ page: "operations", project, ...next })}
          />
        </div>
      </header>

      <Panel
        icon={GaugeIcon}
        title={AsyncResult.isSuccess(operations) ? `${count(operations.value.rows.length)} operations` : "Operations"}
        subtitle="Open one for its load and latency over time"
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
          <span className="text-sm text-muted-foreground">
            {sort.key === "time" ? (
              "Most time in total first"
            ) : (
              <button
                type="button"
                onClick={() => setSort(byTimeInTotal)}
                className="underline decoration-foreground/30 underline-offset-4 hover:text-foreground"
              >
                Sort by time in total
              </button>
            )}
          </span>
        </div>
        <Loaded result={AsyncResult.all({ operations, compared })}>
          {({ operations: table, compared: usual }) => {
            const rows = operationRowsOf(table, usual)
            const shown = sortOperations(
              rows.filter((row) => needle.length === 0 || row.operation.toLowerCase().includes(needle)),
              sort,
            )
            return (
              <div className="p-5">
                {shown.length === 0 ? (
                  <p className="py-4 text-sm text-muted-foreground">
                    {rows.length === 0
                      ? `${shownComponent} reported nothing over the ${periodText}.`
                      : `No operation matches “${search.trim()}”.`}
                  </p>
                ) : (
                  <OperationTable
                    rows={shown}
                    colorOf={(of) => colorOf(of, components)}
                    linkOf={(row) => ({
                      page: "operation",
                      project,
                      ...filters,
                      component: row.component,
                      operation: row.operation,
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
                    {otherOperations} counts what ran past a component&apos;s first 500 operation names. That many names
                    usually means the app reports raw paths, such as <span className="font-mono">/api/notes/123</span>,
                    instead of routes, such as <span className="font-mono">/api/notes/{"{id}"}</span>.
                  </p>
                )}
              </div>
            )
          }}
        </Loaded>
      </Panel>
    </div>
  )
}
