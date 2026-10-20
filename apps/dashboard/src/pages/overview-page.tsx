import { ActivityIcon, BellIcon, BoxesIcon, BugIcon, ScrollTextIcon } from "lucide-react"

import { useFilters } from "@/filters"
import { failureColor, warningColor } from "@/lib/colors"
import { axisTime, count, duration, nearlyAll, share } from "@/lib/format"
import {
  appHealthOf,
  appStartOf,
  attentionOf,
  backend,
  colorOf,
  columnTimesOf,
  components,
  endpointsOf,
  errorGroups,
  isReceiving,
  logLines,
  now,
  periodWords,
  platformOf,
  platformWords,
  projects,
  requestColumns,
  roleOf,
  setUpStepOf,
  statusOf,
  sumOf,
  webVitals,
} from "@/project-facts"
import type { Area } from "@/router"
import { Link } from "@/router"
import { AttentionList } from "@/views/attention-list"
import { BarRows } from "@/views/bar-rows"
import { titleParts } from "@/views/error-group"
import type { Stat } from "@/views/panel"
import { Panel } from "@/views/panel"
import { PeriodSwitch } from "@/views/period-switch"
import { ProjectHeader } from "@/views/project-header"
import { buttonVariants } from "@/views/ui/button"

const hour = 3_600_000
const hours = Array.from({ length: 24 }, (_, index) => Math.floor(now / hour) * hour - (23 - index) * hour)

/**
 * The few numbers that say how a component is doing over the last day, by its role. A backend:
 * requests, error rate, and endpoints that got slower. An app: sessions, crash-free sessions, and
 * how fast it starts. Absent for a component that has sent nothing.
 */
const healthOf = (component: string): ReadonlyArray<Stat> | undefined => {
  if (!isReceiving(component)) {
    return undefined
  }
  if (roleOf(component) === "backend") {
    const columns = requestColumns("24h")
    const requests = sumOf(columns.rows.flatMap((row) => row.values))
    const failed = sumOf(columns.failed)
    const slower = endpointsOf("24h").filter((row) => row.slower !== undefined).length
    return [
      { label: "Requests", value: count(requests) },
      { label: "Error rate", value: share(failed, requests), ...(failed > 0 ? { color: failureColor } : {}) },
      { label: "Got slower", value: count(slower), ...(slower > 0 ? { color: warningColor } : {}) },
    ]
  }
  const health = appHealthOf(component)
  const start = appStartOf(component)
  const vitals = webVitals[component]
  return [
    { label: "Sessions", value: health === undefined ? "–" : count(health.sessions) },
    {
      label: "Crash-free",
      value: health === undefined ? "–" : nearlyAll(health.sessions - health.crashed, health.sessions),
    },
    ...(start === undefined ? [] : [{ label: "Start p95", value: duration(start.p95Ms) }]),
    ...(vitals === undefined ? [] : [{ label: "LCP p75", value: duration(vitals.lcpMs) }]),
  ]
}

const levelHourly = (lines: typeof logLines) =>
  hours.map((start) => lines.filter((line) => line.time >= start && line.time < start + hour).length)

const areaWords: Readonly<Record<Area, string>> = { performance: "Performance", errors: "Errors", logs: "Logs" }

function OpenButton({ project, area }: { readonly project: string; readonly area: Area }) {
  return (
    <Link to={{ page: area, project }} className={buttonVariants({ variant: "outline", size: "sm" })}>
      Open
    </Link>
  )
}

/**
 * A project's starting point: what needs attention now, a summary of each area with a way into its
 * page, and its components. Later areas, such as analytics and releases, add their summaries here.
 */
export function OverviewPage({ project }: { readonly project: string }) {
  const { filters } = useFilters()
  const name = projects.find((entry) => entry.key === project)?.name ?? project
  const attention = attentionOf(project, filters.period)

  const columns = requestColumns(filters.period)
  const asked =
    columns.rows[0]?.values.map((_, column) => sumOf(columns.rows.map((row) => row.values[column] ?? 0))) ?? []
  const requests = sumOf(asked)
  const failed = sumOf(columns.failed)
  const { whenOf } = columnTimesOf(columns)
  const slowest = endpointsOf(filters.period).toSorted((left, right) => right.p95Ms - left.p95Ms)[0]

  const occurrences = sumOf(errorGroups.map((group) => group.occurrences))
  const fresh = errorGroups.filter((group) => statusOf(group).isNew).length
  const warnings = logLines.filter((line) => line.level === "warn")
  const errorsLogged = logLines.filter((line) => line.level !== "warn")

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 p-4 md:p-6">
      <ProjectHeader title={name}>
        <PeriodSwitch />
      </ProjectHeader>

      <Panel icon={BellIcon} title="Needs attention" subtitle="What is wrong now, the worst first">
        <AttentionList items={attention} />
      </Panel>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel
          icon={ActivityIcon}
          title="Requests"
          subtitle={`${backend}, ${periodWords[filters.period].toLowerCase()}`}
          action={<OpenButton project={project} area="performance" />}
          stats={[
            { label: "Requests", value: count(requests) },
            { label: "Error rate", value: share(failed, requests), ...(failed > 0 ? { color: failureColor } : {}) },
            ...(slowest === undefined ? [] : [{ label: "Slowest p95", value: duration(slowest.p95Ms) }]),
          ]}
        >
          <div className="my-auto px-5 py-5">
            <BarRows
              rowHeight={64}
              label={`Requests to ${backend} over the period, and failed requests.`}
              rows={[
                { label: "Requests", color: colorOf(backend), values: asked },
                { label: "Failed", color: failureColor, values: columns.failed },
              ]}
              ticks={[0, 36].map((column) => ({ column, label: whenOf(column) }))}
              timeOf={(span) => whenOf(span.first)}
            />
          </div>
        </Panel>

        <Panel
          icon={BugIcon}
          title="Errors"
          subtitle="Last 24 hours, most frequent first"
          action={<OpenButton project={project} area="errors" />}
          stats={[
            { label: "Groups", value: count(errorGroups.length) },
            { label: "Occurrences", value: count(occurrences), color: failureColor },
            { label: "New", value: count(fresh), ...(fresh > 0 ? { color: warningColor } : {}) },
          ]}
        >
          <ul className="flex-1 divide-y">
            {errorGroups.slice(0, 4).map((group) => (
              <li key={group.id}>
                <Link
                  to={{ page: "errors", project, error: group.id }}
                  className="flex items-center gap-4 px-5 py-3 hover:bg-accent/60"
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="flex items-center gap-2.5">
                      <span className="truncate">{titleParts(group).type}</span>
                      {group.crash && <span className="shrink-0 font-mono text-xs text-failure">crash</span>}
                    </span>
                    <span className="flex items-center gap-2 text-sm text-muted-foreground">
                      <span className="size-2 shrink-0" style={{ backgroundColor: colorOf(group.lastComponent) }} />
                      {group.lastComponent}
                    </span>
                  </span>
                  <span className="font-mono">{count(group.occurrences)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel
          icon={ScrollTextIcon}
          title="Logs"
          subtitle="Warnings and errors, last 24 hours"
          action={<OpenButton project={project} area="logs" />}
          stats={[
            { label: "Warnings", value: count(warnings.length), color: warningColor },
            { label: "Errors", value: count(errorsLogged.length), color: failureColor },
          ]}
        >
          <div className="my-auto px-5 py-5">
            <BarRows
              rowHeight={64}
              label="Warnings and errors logged in each hour of the last day."
              rows={[
                { label: "Warnings", color: warningColor, values: levelHourly(warnings) },
                { label: "Errors", color: failureColor, values: levelHourly(errorsLogged) },
              ]}
              ticks={[0, 12].map((column) => ({ column, label: axisTime(hours[column] ?? now) }))}
              timeOf={(span) => axisTime(hours[span.first] ?? now)}
            />
          </div>
        </Panel>
      </div>

      <Panel icon={BoxesIcon} title="Components" subtitle="How each part is doing over the last 24 hours">
        <ul className="divide-y">
          {components.map((component) => {
            const health = healthOf(component)
            return (
              <li
                key={component}
                className="grid items-center gap-x-6 gap-y-3 px-5 py-4 lg:grid-cols-[15rem_minmax(0,1fr)_auto]"
              >
                <span className="flex items-center gap-3">
                  <span className="size-2.5 shrink-0" style={{ backgroundColor: colorOf(component) }} />
                  <span className="flex flex-col">
                    <span className="text-[15px]">{component}</span>
                    <span className="text-sm text-muted-foreground">{platformWords[platformOf(component)]}</span>
                  </span>
                </span>
                {health === undefined ? (
                  <span className="text-sm text-muted-foreground">
                    <span className="text-foreground">Nothing received yet.</span> {setUpStepOf(component)}
                  </span>
                ) : (
                  <dl className="grid grid-cols-3 gap-x-6">
                    {health.map((stat) => (
                      <div key={stat.label} className="flex min-w-0 flex-col gap-0.5">
                        <dt className="truncate text-sm text-muted-foreground">{stat.label}</dt>
                        <dd
                          className="font-mono text-[15px]"
                          style={stat.color === undefined ? {} : { color: stat.color }}
                        >
                          {stat.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
                <span className="flex flex-wrap gap-2">
                  {(["performance", "errors", "logs"] as const).map((area) => (
                    <Link
                      to={{ page: area, project, component }}
                      key={area}
                      className={buttonVariants({ variant: "outline", size: "sm" })}
                    >
                      {areaWords[area]}
                    </Link>
                  ))}
                </span>
              </li>
            )
          })}
        </ul>
      </Panel>
    </div>
  )
}
