import { ActivityIcon, GaugeIcon, LayoutPanelTopIcon, NetworkIcon, RocketIcon, TimerIcon } from "lucide-react"

import { useFilters } from "@/filters"
import { failureColor } from "@/lib/colors"
import { count, duration, moment, share } from "@/lib/format"
import {
  appStartColumns,
  appStartOf,
  backend,
  colorOf,
  columnTimesOf,
  endpointsOf,
  isReceiving,
  networkCallsOf,
  originColor,
  originLabel,
  periodWords,
  platformOf,
  platformWords,
  requestColumns,
  requestsToOpen,
  roleOf,
  screensOf,
  setUpStepOf,
  slowerMeaning,
  sumOf,
  webVitals,
  zoneName,
} from "@/project-facts"
import { Link, navigate } from "@/router"
import type { PeriodKey } from "@/sample/sample-project"
import { BarRows, largestOf } from "@/views/bar-rows"
import { ComponentSwitch } from "@/views/component-switch"
import { byTimeInTotal, EndpointTable, sortEndpoints } from "@/views/endpoint-table"
import { NetworkTable } from "@/views/network-table"
import { NothingReceived } from "@/views/nothing-received"
import { Panel } from "@/views/panel"
import { PeriodSwitch } from "@/views/period-switch"
import { ProjectHeader } from "@/views/project-header"
import { RequestList } from "@/views/request-list"
import { ScreenTable } from "@/views/screen-table"
import { SinceUsual } from "@/views/since-usual"
import { buttonVariants } from "@/views/ui/button"

// How many endpoints, screens, and requests a summary shows; the endpoints page lists every
// endpoint, and each endpoint's page its requests.
const summaryRows = 8

// The chart of an app's start is as tall as the screens beside it.
const startChartHeight = 236

/**
 * How fast an app is ready: on a phone, its cold start's p95 over the period, with p50, p95, and
 * p99 and how the last day compares with the usual; in a browser, its Core Web Vitals, with the
 * largest contentful paint's p75 over the period.
 */
function AppStartPanel({ component, period }: { readonly component: string; readonly period: PeriodKey }) {
  const columns = appStartColumns(component, period)
  if (columns === undefined) {
    return null
  }
  const { startOf, whenOf } = columnTimesOf(columns)
  const ticks = [0, 18, 36, 54].map((column) => ({ column, label: whenOf(column) }))
  const timeOf = (span: { readonly first: number }) => moment(startOf(span.first))
  const vitals = webVitals[component]
  if (vitals !== undefined) {
    return (
      <Panel
        icon={RocketIcon}
        title="Web Vitals"
        subtitle={`LCP p75 of each column, ${periodWords[period].toLowerCase()}`}
        badge={zoneName}
        className="xl:col-span-5"
        stats={[
          { label: "LCP p75", value: duration(vitals.lcpMs) },
          { label: "INP p75", value: duration(vitals.inpMs) },
          { label: "CLS p75", value: vitals.cls.toFixed(2) },
        ]}
      >
        <div className="p-5">
          <BarRows
            rowHeight={startChartHeight}
            label={`The p75 of the largest contentful paint of ${component} over the period.`}
            rows={[
              { label: "LCP p75", note: duration(vitals.lcpMs), color: colorOf(component), values: columns.values },
            ]}
            ticks={ticks}
            timeOf={timeOf}
            format={duration}
            combine={largestOf}
          />
          <p className="mt-5 text-sm text-muted-foreground">
            LCP: until the largest content shows. INP: how soon the page answers a tap or a key. CLS: how much the page
            moves while it loads. Over the last day, at p75, as Google measures them.
          </p>
        </div>
      </Panel>
    )
  }
  const start = appStartOf(component)
  if (start === undefined) {
    return null
  }
  return (
    <Panel
      icon={RocketIcon}
      title="App start"
      subtitle={`Cold start p95 of each column, ${periodWords[period].toLowerCase()}`}
      badge={zoneName}
      className="xl:col-span-5"
      stats={[
        { label: "p50", value: duration(start.p50Ms) },
        { label: "p95", value: duration(start.p95Ms) },
        { label: "p99", value: duration(start.p99Ms) },
      ]}
    >
      <div className="p-5">
        <BarRows
          rowHeight={startChartHeight}
          label={`The p95 of ${component}'s cold start over the period.`}
          rows={[{ label: "p95", note: duration(start.p95Ms), color: colorOf(component), values: columns.values }]}
          ticks={ticks}
          timeOf={timeOf}
          format={duration}
          combine={largestOf}
        />
        <p className="mt-5 text-sm text-muted-foreground">
          <SinceUsual timed={start} measure="Cold start p95" /> A cold start runs from the tap on the icon to the first
          screen drawn.
        </p>
      </div>
    </Panel>
  )
}

/**
 * An app's performance: how fast it starts, how long each screen takes to show, and the backend
 * endpoints it calls, as the app saw them, with the backend's share of the time.
 */
function AppPerformance({ project, component }: { readonly project: string; readonly component: string }) {
  const { filters } = useFilters()
  const isBrowser = platformOf(component) === "browser"
  const screens = screensOf(component, filters.period)
  const calls = networkCallsOf(component, filters.period)
  return (
    <>
      <div className="grid gap-4 xl:grid-cols-12">
        <AppStartPanel component={component} period={filters.period} />
        <Panel
          icon={LayoutPanelTopIcon}
          title={isBrowser ? "Pages" : "Screens"}
          subtitle={
            isBrowser
              ? "The most visited first; how long until each one's largest content showed"
              : "The most shown first; how long each took to show"
          }
          className="xl:col-span-7"
        >
          <div className="p-5">
            <ScreenTable
              rows={screens.slice(0, summaryRows)}
              color={colorOf(component)}
              heading={isBrowser ? "Page" : "Screen"}
            />
            <p className="mt-4 text-sm text-muted-foreground">{slowerMeaning}</p>
          </div>
        </Panel>
      </div>
      <Panel
        icon={NetworkIcon}
        title="Network calls"
        subtitle={`${backend} endpoints as ${component} saw them, the most called first`}
        action={
          <Link
            to={{ page: "performance", project, component: backend }}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Open {backend}
          </Link>
        }
      >
        <div className="p-5">
          <NetworkTable
            rows={calls.slice(0, summaryRows)}
            backendColor={colorOf(backend)}
            linkOf={(row) => ({ page: "endpoint", project, component: backend, endpoint: row.endpoint })}
          />
          <p className="mt-4 text-sm text-muted-foreground">
            The bar: <span style={{ color: colorOf(backend) }}>{backend}&apos;s p95</span>, then the network and the
            app. A long gray part is a slow network or slow work in the app, not the backend.
          </p>
        </div>
      </Panel>
    </>
  )
}

/**
 * A component's performance, in what matters for its role. A backend: its requests by origin, its
 * endpoints, and its slowest and failed requests. An app: its start, its screens, and the backend
 * calls it makes. A component that has sent nothing says how to start.
 */
export function PerformancePage({
  project,
  component = backend,
}: {
  readonly project: string
  readonly component?: string
}) {
  const header = (
    <ProjectHeader title="Performance">
      <ComponentSwitch
        value={component}
        allowAll={false}
        onChange={(picked) =>
          navigate(
            { page: "performance", project, ...(picked === undefined ? {} : { component: picked }) },
            { replace: true },
          )
        }
      />
      <PeriodSwitch />
    </ProjectHeader>
  )

  if (!isReceiving(component)) {
    return (
      <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 p-4 md:p-6">
        {header}
        <NothingReceived
          component={component}
          platform={platformWords[platformOf(component)]}
          shows={
            roleOf(component) === "app"
              ? "how fast the app starts, how long its screens take to show, and the backend calls it makes"
              : "its requests, endpoints, and slowest requests"
          }
          step={setUpStepOf(component)}
        />
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 p-4 md:p-6">
      {header}
      {roleOf(component) === "app" ? (
        <AppPerformance project={project} component={component} />
      ) : (
        <BackendPerformance project={project} component={component} />
      )}
    </div>
  )
}

/**
 * A backend's performance: its requests by origin, the endpoints that got slower or take the most
 * time, and its slow and failed requests, each one click from its trace.
 */
function BackendPerformance({ project, component }: { readonly project: string; readonly component: string }) {
  const { filters } = useFilters()
  const columns = requestColumns(filters.period)
  const requests = sumOf(columns.rows.flatMap((row) => row.values))
  const failed = sumOf(columns.failed)

  const totalAt = (column: number) => columns.rows.reduce((sum, row) => sum + (row.values[column] ?? 0), 0)
  const peak = columns.failed.reduce((best, _, column) => (totalAt(column) > totalAt(best) ? column : best), 0)
  const { startOf, whenOf } = columnTimesOf(columns)
  const busiestOrigin = Math.max(1, ...columns.rows.flatMap((row) => row.values))
  const topOrigin = columns.rows.toSorted((left, right) => sumOf(right.values) - sumOf(left.values))[0]
  // Those that got slower first, so they're never below the fold, then the most time in total.
  const byTime = sortEndpoints(endpointsOf(filters.period), byTimeInTotal)
  const endpoints = [
    ...byTime.filter((row) => row.slower !== undefined),
    ...byTime.filter((row) => row.slower === undefined),
  ]

  return (
    <>
      <div className="grid items-start gap-4 xl:grid-cols-12">
        <Panel
          icon={ActivityIcon}
          title={`Requests to ${component}`}
          subtitle={`${periodWords[filters.period]}, by origin`}
          badge={zoneName}
          className="xl:col-span-5"
          stats={[
            { label: "Peak", value: whenOf(peak) },
            { label: "Error rate", value: share(failed, requests), ...(failed > 0 ? { color: failureColor } : {}) },
            ...(topOrigin === undefined
              ? []
              : [{ label: "Top origin", value: originLabel(topOrigin.origin), color: originColor(topOrigin.origin) }]),
          ]}
        >
          <div className="p-5">
            <BarRows
              rowHeight={64}
              label={`Requests to ${component} over the period, ${count(requests)} in all, by origin, with failed requests in their own row.`}
              rows={[
                ...columns.rows.map((row) => ({
                  most: busiestOrigin,
                  label: originLabel(row.origin),
                  note: share(sumOf(row.values), requests),
                  color: originColor(row.origin),
                  values: row.values,
                })),
                { label: "Failed", note: count(failed), color: failureColor, values: columns.failed },
              ]}
              ticks={[0, 18, 36, 54].map((column) => ({ column, label: whenOf(column) }))}
              timeOf={(span) => moment(startOf(span.first))}
            />
            <p className="mt-5 text-sm text-muted-foreground">
              Origin is the app that started a request, from its <span className="font-mono">baggage</span> header.
              Other: requests without one, such as webhooks and jobs.
            </p>
          </div>
        </Panel>

        <Panel
          icon={GaugeIcon}
          title="Endpoints"
          subtitle={`Any that got slower, then the most time in total: ${count(Math.min(summaryRows, endpoints.length))} of ${count(endpoints.length)}`}
          action={
            <Link
              to={{ page: "endpoints", project, component }}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              All endpoints
            </Link>
          }
          className="xl:col-span-7"
        >
          <div className="p-5">
            <EndpointTable
              rows={endpoints.slice(0, summaryRows)}
              colorOf={colorOf}
              linkOf={(row) => ({ page: "endpoint", project, component, endpoint: row.endpoint })}
            />
            <p className="mt-4 text-sm text-muted-foreground">
              {slowerMeaning} Open an endpoint for its requests over time and its slowest requests.
            </p>
          </div>
        </Panel>
      </div>

      <Panel
        icon={TimerIcon}
        title="Slow and failed requests"
        subtitle="Failed, or slow on an endpoint that got slower, in the last 24 hours; open one to see its trace"
      >
        <RequestList project={project} rows={requestsToOpen.slice(0, summaryRows)} />
      </Panel>
    </>
  )
}
