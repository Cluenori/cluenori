import { ActivityIcon, ArrowLeftIcon, GaugeIcon, SearchXIcon, TimerIcon } from "lucide-react"
import type { ReactNode } from "react"

import { useFilters } from "@/filters"
import { failureColor } from "@/lib/colors"
import { count, duration, moment, share } from "@/lib/format"
import {
  backend,
  colorOf,
  columnTimesOf,
  endpointColumns,
  endpointsOf,
  originColor,
  originLabel,
  periodWords,
  requestsOf,
  sumOf,
  zoneName,
} from "@/project-facts"
import type { Route } from "@/router"
import { Link } from "@/router"
import type { EndpointRow } from "@/sample/sample-project"
import { BarRows, largestOf } from "@/views/bar-rows"
import { EndpointName } from "@/views/endpoint-name"
import type { Slower } from "@/views/endpoint-table"
import { Panel } from "@/views/panel"
import { PeriodSwitch } from "@/views/period-switch"
import { RequestList } from "@/views/request-list"
import { buttonVariants } from "@/views/ui/button"

// The height of one row of requests; the latency chart is as tall as all of them, so the two line up.
const rowHeight = 64
const rowGap = 12

/** How the endpoint's p95 lately compares with its usual one, the 7 days before, in a sentence. */
function SinceUsual({ row }: { readonly row: EndpointRow & { readonly slower?: Slower } }) {
  if (row.usualP95Ms === undefined) {
    return <>New this week: there is no p95 from the 7 days before to compare with.</>
  }
  if (row.slower !== undefined) {
    return (
      <>
        <span className="text-yellow">Slower than usual:</span> p95 {duration(row.lastDayP95Ms)} over the last day,{" "}
        {duration(row.usualP95Ms)} over the 7 days before.
      </>
    )
  }
  return (
    <>
      p95 {duration(row.lastDayP95Ms)} over the last day, {duration(row.usualP95Ms)} over the 7 days before.
    </>
  )
}

/** The top of the page: back to every endpoint, the endpoint's name, its component, and the period. */
function EndpointHeader({ back, children }: { readonly back: Route; readonly children: ReactNode }) {
  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-3 pb-2">
      <Link
        to={back}
        aria-label="Back to all endpoints"
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

/**
 * One endpoint full screen: its requests by origin and its failures over the period, its p95 over
 * the same columns beside its usual p95, its percentiles, and its slowest and failed requests, each
 * one click from its trace.
 */
export function EndpointPage({
  project,
  component = backend,
  endpoint,
}: {
  readonly project: string
  readonly component?: string
  readonly endpoint: string
}) {
  const { filters } = useFilters()
  const endpoints = endpointsOf(filters.period)
  const row = endpoints.find((entry) => entry.component === component && entry.endpoint === endpoint)
  const columns = endpointColumns(endpoint, filters.period)
  const back: Route = { page: "endpoints", project, component }
  const period = periodWords[filters.period].toLowerCase()

  if (row === undefined || columns === undefined) {
    return (
      <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 p-4 md:p-6">
        <EndpointHeader back={back}>
          <h1 className="truncate font-mono text-2xl font-semibold tracking-[-0.02em]">{endpoint}</h1>
          <p className="text-sm text-muted-foreground">{component}</p>
        </EndpointHeader>
        <Panel icon={SearchXIcon} title="No requests to this endpoint" subtitle={`${component}, ${period}`}>
          <div className="flex flex-col gap-4 px-5 py-6">
            <p className="max-w-2xl text-[15px]">
              {component} received no requests to <span className="font-mono">{endpoint}</span> over the {period}. It
              may have been renamed, or the link is from another project.
            </p>
            <Link to={back} className={buttonVariants({ variant: "outline", className: "self-start" })}>
              All endpoints
            </Link>
          </div>
        </Panel>
      </div>
    )
  }

  const { startOf, whenOf } = columnTimesOf(columns)
  const requests = sumOf(columns.rows.flatMap((entry) => entry.values))
  const failed = sumOf(columns.failed)
  const busiestOrigin = Math.max(1, ...columns.rows.flatMap((entry) => entry.values))
  const timeInTotal = sumOf(endpoints.map((entry) => entry.requests * entry.averageMs))
  const ticks = [0, 18, 36, 54].map((column) => ({ column, label: whenOf(column) }))
  const timeOf = (span: { readonly first: number }) => moment(startOf(span.first))
  const rowCount = columns.rows.length + 1
  const requestsOfEndpoint = requestsOf(endpoint)

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 p-4 md:p-6">
      <EndpointHeader back={back}>
        <h1 className="flex min-w-0 items-baseline gap-3 text-2xl font-semibold tracking-[-0.02em]">
          <EndpointName endpoint={endpoint} />
          {row.slower !== undefined && (
            <span className="shrink-0 font-mono text-sm font-normal text-yellow">slower</span>
          )}
        </h1>
        <p className="text-sm text-muted-foreground">
          {component}, {period}
        </p>
      </EndpointHeader>

      <div className="grid gap-4 xl:grid-cols-12">
        <Panel
          icon={ActivityIcon}
          title="Requests"
          subtitle={`${periodWords[filters.period]}, by origin`}
          badge={zoneName}
          className="xl:col-span-7"
          stats={[
            { label: "Requests", value: count(row.requests) },
            {
              label: "Error rate",
              value: share(row.errors, row.requests),
              ...(row.errors > 0 ? { color: failureColor } : {}),
            },
            { label: `Share of ${component} time`, value: share(row.requests * row.averageMs, timeInTotal) },
          ]}
        >
          <div className="p-5">
            <BarRows
              rowHeight={rowHeight}
              label={`Requests to ${endpoint} over the period, ${count(requests)} in all, by origin, with failed requests in their own row.`}
              rows={[
                ...columns.rows.map((entry) => ({
                  most: busiestOrigin,
                  label: originLabel(entry.origin),
                  note: share(sumOf(entry.values), requests),
                  color: originColor(entry.origin),
                  values: entry.values,
                })),
                { label: "Failed", note: count(failed), color: failureColor, values: columns.failed },
              ]}
              ticks={ticks}
              timeOf={timeOf}
            />
          </div>
        </Panel>

        <Panel
          icon={GaugeIcon}
          title="Latency"
          subtitle="p95 of each column's requests"
          className="xl:col-span-5"
          stats={[
            { label: "p50", value: duration(row.p50Ms) },
            { label: "p80", value: duration(row.p80Ms) },
            { label: "p95", value: duration(row.p95Ms) },
            { label: "p99", value: duration(row.p99Ms) },
          ]}
        >
          <div className="p-5">
            <BarRows
              rowHeight={rowCount * rowHeight + (rowCount - 1) * rowGap}
              label={`The p95 latency of ${endpoint} over the period; over the whole period it is ${duration(row.p95Ms)}.`}
              rows={[{ label: "p95", note: duration(row.p95Ms), color: colorOf(component), values: columns.p95 }]}
              ticks={ticks}
              timeOf={timeOf}
              format={duration}
              combine={largestOf}
            />
            <p className="mt-5 text-sm text-muted-foreground">
              <SinceUsual row={row} />
            </p>
          </div>
        </Panel>
      </div>

      <Panel
        icon={TimerIcon}
        title="Slowest and failed requests"
        subtitle="Its slowest and failed requests of the last 24 hours, newest first; open one to see its trace"
      >
        {requestsOfEndpoint.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">No requests to this endpoint in the last 24 hours.</p>
        ) : (
          <RequestList project={project} rows={requestsOfEndpoint} withEndpoint={false} />
        )}
      </Panel>
    </div>
  )
}
