import type { ComponentKey, ProjectKey } from "@cluenori/foundation"
import { otherEndpoints } from "@cluenori/signals"
import { useAtomValue } from "@effect/atom-react"
import { AsyncResult } from "effect/reactivity"
import { ArrowLeftIcon, GaugeIcon, SearchIcon } from "lucide-react"
import { useState } from "react"

import { count } from "@/lib/format"
import { endpointsAtom, periodAtom, useComponentKeys, usualEndpointsAtom } from "@/project-data"
import { colorOf, endpointRowsOf, periodWords, slowerMeaning } from "@/project-facts"
import { Link } from "@/router"
import type { Sort } from "@/views/endpoint-table"
import { byTimeInTotal, EndpointTable, sortEndpoints } from "@/views/endpoint-table"
import { Loaded } from "@/views/loaded"
import { Panel } from "@/views/panel"
import { PeriodSwitch } from "@/views/period-switch"
import { buttonVariants } from "@/views/ui/button"

/**
 * Every endpoint of a project, or of one component: searchable, sortable by any column, each one
 * click from its own page. The most time in total comes first.
 */
export function EndpointsPage({
  project,
  component,
}: {
  readonly project: ProjectKey
  readonly component?: ComponentKey
}) {
  const scope = { project, ...(component === undefined ? {} : { component }) }
  const period = useAtomValue(periodAtom)
  const components = useComponentKeys(project)
  const endpoints = useAtomValue(endpointsAtom(scope))
  const compared = useAtomValue(usualEndpointsAtom(scope))
  const [search, setSearch] = useState("")
  const [sort, setSort] = useState<Sort>(byTimeInTotal)
  const needle = search.trim().toLowerCase()
  const periodText = periodWords[period].toLowerCase()
  const shownComponent = component ?? "Every component"

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3 pb-2">
        <Link
          to={{ page: "performance", project, ...(component === undefined ? {} : { component }) }}
          aria-label="Back to the performance"
          className={buttonVariants({ variant: "outline", size: "icon" })}
        >
          <ArrowLeftIcon />
        </Link>
        <div className="flex min-w-0 flex-col">
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">Endpoints</h1>
          <p className="text-sm text-muted-foreground">
            {shownComponent}, {periodText}
          </p>
        </div>
        <div className="ml-auto">
          <PeriodSwitch />
        </div>
      </header>

      <Panel
        icon={GaugeIcon}
        title={AsyncResult.isSuccess(endpoints) ? `${count(endpoints.value.rows.length)} endpoints` : "Endpoints"}
        subtitle="Open one for its requests and latency over time"
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
        <Loaded result={AsyncResult.all({ endpoints, compared })}>
          {({ endpoints: table, compared: usual }) => {
            const rows = endpointRowsOf(table, usual)
            const shown = sortEndpoints(
              rows.filter((row) => needle.length === 0 || row.endpoint.toLowerCase().includes(needle)),
              sort,
            )
            return (
              <div className="p-5">
                {shown.length === 0 ? (
                  <p className="py-4 text-sm text-muted-foreground">
                    {rows.length === 0
                      ? `${shownComponent} received no requests over the ${periodText}.`
                      : `No endpoint matches “${search.trim()}”.`}
                  </p>
                ) : (
                  <EndpointTable
                    rows={shown}
                    colorOf={(of) => colorOf(of, components)}
                    linkOf={(row) => ({ page: "endpoint", project, component: row.component, endpoint: row.endpoint })}
                    sort={sort}
                    onSort={setSort}
                  />
                )}
                <p className="mt-4 text-sm text-muted-foreground">
                  {slowerMeaning} Percentiles are within 2% of the true value.
                </p>
                {rows.some((row) => row.endpoint === otherEndpoints) && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {otherEndpoints} counts the requests past a component&apos;s first 500 endpoint names. That many
                    names usually means the app reports raw paths, such as{" "}
                    <span className="font-mono">/api/notes/123</span>, instead of routes, such as{" "}
                    <span className="font-mono">/api/notes/{"{id}"}</span>.
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
