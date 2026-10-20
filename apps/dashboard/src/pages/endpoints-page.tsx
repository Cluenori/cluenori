import { ArrowLeftIcon, GaugeIcon, SearchIcon } from "lucide-react"
import { useState } from "react"

import { useFilters } from "@/filters"
import { count } from "@/lib/format"
import { backend, colorOf, endpointsOf, periodWords, slowerMeaning } from "@/project-facts"
import { Link } from "@/router"
import type { Sort } from "@/views/endpoint-table"
import { byTimeInTotal, EndpointTable, sortEndpoints } from "@/views/endpoint-table"
import { Panel } from "@/views/panel"
import { PeriodSwitch } from "@/views/period-switch"
import { buttonVariants } from "@/views/ui/button"

/** Where the backend counts requests once a component has 500 endpoint names. */
const otherEndpoints = "(other endpoints)"

/**
 * Every endpoint of a backend: searchable, sortable by any column, each one click from its own page.
 * The most time in total comes first.
 */
export function EndpointsPage({
  project,
  component = backend,
}: {
  readonly project: string
  readonly component?: string
}) {
  const { filters } = useFilters()
  const [search, setSearch] = useState("")
  const [sort, setSort] = useState<Sort>(byTimeInTotal)
  const rows = endpointsOf(filters.period).filter((row) => row.component === component)
  const needle = search.trim().toLowerCase()
  const shown = sortEndpoints(
    rows.filter((row) => needle.length === 0 || row.endpoint.toLowerCase().includes(needle)),
    sort,
  )

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3 pb-2">
        <Link
          to={{ page: "performance", project, component }}
          aria-label="Back to the performance"
          className={buttonVariants({ variant: "outline", size: "icon" })}
        >
          <ArrowLeftIcon />
        </Link>
        <div className="flex min-w-0 flex-col">
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">Endpoints</h1>
          <p className="text-sm text-muted-foreground">
            {component}, {periodWords[filters.period].toLowerCase()}
          </p>
        </div>
        <div className="ml-auto">
          <PeriodSwitch />
        </div>
      </header>

      <Panel
        icon={GaugeIcon}
        title={`${count(rows.length)} endpoints`}
        subtitle="Open one for its requests over time and its slowest requests"
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-5 py-3">
          <label className="flex h-9 min-w-48 flex-1 items-center gap-2 border bg-card px-3 focus-within:border-ring sm:max-w-96">
            <SearchIcon className="size-4 text-muted-foreground" />
            <span className="sr-only">Search the endpoints</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search endpoints, such as /api/notes"
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
        <div className="p-5">
          {shown.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">
              {rows.length === 0
                ? `${component} sent no requests over the ${periodWords[filters.period].toLowerCase()}.`
                : `No endpoint matches “${search.trim()}”.`}
            </p>
          ) : (
            <EndpointTable
              rows={shown}
              colorOf={colorOf}
              linkOf={(row) => ({ page: "endpoint", project, component, endpoint: row.endpoint })}
              sort={sort}
              onSort={setSort}
            />
          )}
          <p className="mt-4 text-sm text-muted-foreground">
            {slowerMeaning} Percentiles are within 2% of the true value.
          </p>
          {rows.some((row) => row.endpoint === otherEndpoints) && (
            <p className="mt-2 text-sm text-muted-foreground">
              {otherEndpoints} counts the requests past the first 500 endpoint names. That many names usually means the
              app reports raw paths, such as <span className="font-mono">/api/notes/123</span>, instead of routes, such
              as <span className="font-mono">/api/notes/{"{id}"}</span>.
            </p>
          )}
        </div>
      </Panel>
    </div>
  )
}
