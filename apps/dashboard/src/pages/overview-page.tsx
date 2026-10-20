import type { ProjectKey } from "@cluenori/foundation"
import { useAtomValue } from "@effect/atom-react"
import { DateTime } from "effect"
import { AsyncResult } from "effect/reactivity"
import { ActivityIcon, BellIcon, BoxesIcon, BugIcon, ScrollTextIcon } from "lucide-react"

import { failureColor, warningColor } from "@/lib/colors"
import { count, duration, share } from "@/lib/format"
import {
  endpointsAtom,
  errorsAtom,
  logCountsAtom,
  periodAtom,
  projectAtom,
  requestsAtom,
  usualEndpointsAtom,
} from "@/project-data"
import {
  attentionOf,
  colorOf,
  columnTimesOf,
  endOf,
  endpointKeyOf,
  logColumnsOf,
  periodWords,
  requestColumnsOf,
  slowerEndpoints,
  statusOf,
  sumOf,
  ticksOf,
} from "@/project-facts"
import type { Area } from "@/router"
import { Link } from "@/router"
import { AttentionList } from "@/views/attention-list"
import { BarRows } from "@/views/bar-rows"
import { titleParts } from "@/views/error-group"
import { Loaded } from "@/views/loaded"
import { Panel, PanelStats } from "@/views/panel"
import { PeriodSwitch } from "@/views/period-switch"
import { ProjectHeader } from "@/views/project-header"
import { buttonVariants } from "@/views/ui/button"

const areaWords: Readonly<Record<Area, string>> = { performance: "Performance", errors: "Errors", logs: "Logs" }

function OpenButton({ project, area }: { readonly project: ProjectKey; readonly area: Area }) {
  return (
    <Link to={{ page: area, project }} className={buttonVariants({ variant: "outline", size: "sm" })}>
      Open
    </Link>
  )
}

// A summary chart is narrow, so it names only every other of the usual four times.
const everyOther = <T,>(ticks: ReadonlyArray<T>) => ticks.filter((_, index) => index % 2 === 0)

/**
 * A project's starting point: what needs attention now, a summary of each area with a way into its
 * page, and its components. Later areas, such as analytics and releases, add their summaries here.
 */
export function OverviewPage({ project }: { readonly project: ProjectKey }) {
  const scope = { project }
  const period = useAtomValue(periodAtom)
  const detail = useAtomValue(projectAtom(project))
  const requests = useAtomValue(requestsAtom(scope))
  const endpoints = useAtomValue(endpointsAtom(scope))
  const compared = useAtomValue(usualEndpointsAtom(scope))
  const errors = useAtomValue(errorsAtom(scope))
  const logCounts = useAtomValue(logCountsAtom({ project, by: "level" }))
  const periodText = periodWords[period].toLowerCase()

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 p-4 md:p-6">
      <ProjectHeader
        title={AsyncResult.isSuccess(detail) ? detail.value.project.name : project}
        latest={AsyncResult.map(endpoints, (table) =>
          table.dataUntil === undefined ? undefined : DateTime.toEpochMillis(table.dataUntil),
        )}
      >
        <PeriodSwitch />
      </ProjectHeader>

      <Panel icon={BellIcon} title="Needs attention" subtitle="What is wrong now, the worst first">
        <Loaded result={AsyncResult.all({ errors, requests, compared })}>
          {(facts) => <AttentionList items={attentionOf({ project, ...facts })} />}
        </Loaded>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel
          icon={ActivityIcon}
          title="Requests"
          subtitle={periodWords[period]}
          action={<OpenButton project={project} area="performance" />}
        >
          <Loaded result={AsyncResult.all({ requests, endpoints })}>
            {({ requests: series, endpoints: table }) => {
              const asked = requestColumnsOf(series, (point) => point.requests)
              const failed = requestColumnsOf(series, (point) => point.errors)
              const { whenOf } = columnTimesOf(asked)
              const slowest = table.rows.toSorted((left, right) => right.p95Ms - left.p95Ms)[0]
              return (
                <>
                  <div className="my-auto px-5 py-5">
                    <BarRows
                      rowHeight={64}
                      label="Requests to every component over the period, and failed requests."
                      rows={[
                        { label: "Requests", color: "var(--blue)", values: asked.values },
                        { label: "Failed", color: failureColor, values: failed.values },
                      ]}
                      ticks={everyOther(ticksOf(asked))}
                      timeOf={(span) => whenOf(span.first)}
                    />
                  </div>
                  <PanelStats
                    stats={[
                      { label: "Requests", value: count(table.requests) },
                      {
                        label: "Error rate",
                        value: share(table.errors, table.requests),
                        ...(table.errors > 0 ? { color: failureColor } : {}),
                      },
                      ...(slowest === undefined ? [] : [{ label: "Slowest p95", value: duration(slowest.p95Ms) }]),
                    ]}
                  />
                </>
              )
            }}
          </Loaded>
        </Panel>

        <Panel
          icon={BugIcon}
          title="Errors"
          subtitle="Most frequent first"
          action={<OpenButton project={project} area="errors" />}
        >
          <Loaded result={AsyncResult.all({ errors, detail })}>
            {({ errors: table, detail: { components } }) => {
              const now = endOf(table)
              const fresh = now === undefined ? 0 : table.groups.filter((group) => statusOf(group, now).isNew).length
              const keys = components.map((component) => component.key)
              return (
                <>
                  {table.groups.length === 0 ? (
                    <p className="flex-1 px-5 py-5 text-sm text-muted-foreground">No errors in this period.</p>
                  ) : (
                    <ul className="flex-1 divide-y">
                      {table.groups.slice(0, 4).map((group) => (
                        <li key={group.id}>
                          <Link
                            to={{ page: "errors", project, error: group.id }}
                            className="flex items-center gap-4 px-5 py-3 hover:bg-accent/60"
                          >
                            <span className="flex min-w-0 flex-1 flex-col">
                              <span className="truncate">{titleParts(group).type}</span>
                              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                                <span
                                  className="size-2 shrink-0"
                                  style={{ backgroundColor: colorOf(group.lastComponent, keys) }}
                                />
                                {group.lastComponent}
                              </span>
                            </span>
                            <span className="font-mono">{count(group.occurrences)}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                  <PanelStats
                    stats={[
                      { label: "Groups", value: count(table.groups.length) },
                      {
                        label: "Occurrences",
                        value: count(table.occurrences),
                        ...(table.occurrences > 0 ? { color: failureColor } : {}),
                      },
                      { label: "New", value: count(fresh), ...(fresh > 0 ? { color: warningColor } : {}) },
                    ]}
                  />
                </>
              )
            }}
          </Loaded>
        </Panel>

        <Panel
          icon={ScrollTextIcon}
          title="Logs"
          subtitle="Warnings and errors"
          action={<OpenButton project={project} area="logs" />}
        >
          <Loaded result={logCounts}>
            {(counts) => {
              const warnings = logColumnsOf(counts, ["warn"])
              const errorsLogged = logColumnsOf(counts, ["error", "fatal"])
              const { whenOf } = columnTimesOf(warnings)
              const totalOf = (keys: ReadonlyArray<string>) =>
                sumOf(counts.series.filter((series) => keys.includes(series.key)).map((series) => series.total))
              const warned = totalOf(["warn"])
              const failed = totalOf(["error", "fatal"])
              return (
                <>
                  <div className="my-auto px-5 py-5">
                    <BarRows
                      rowHeight={64}
                      label="Warnings and errors logged over the period."
                      rows={[
                        { label: "Warnings", color: warningColor, values: warnings.values },
                        { label: "Errors", color: failureColor, values: errorsLogged.values },
                      ]}
                      ticks={everyOther(ticksOf(warnings))}
                      timeOf={(span) => whenOf(span.first)}
                    />
                  </div>
                  <PanelStats
                    stats={[
                      { label: "Warnings", value: count(warned), ...(warned > 0 ? { color: warningColor } : {}) },
                      { label: "Errors", value: count(failed), ...(failed > 0 ? { color: failureColor } : {}) },
                    ]}
                  />
                </>
              )
            }}
          </Loaded>
        </Panel>
      </div>

      <Panel icon={BoxesIcon} title="Components" subtitle={`How each part is doing, ${periodText}`}>
        <Loaded result={AsyncResult.all({ detail, endpoints, compared })}>
          {({ detail: { components }, endpoints: table, compared: usual }) => {
            const keys = components.map((component) => component.key)
            const slower = slowerEndpoints(usual)
            const slowerIn = (component: string) =>
              usual.lastDay.rows.filter((row) => row.component === component && slower.has(endpointKeyOf(row))).length
            if (components.length === 0) {
              return (
                <p className="max-w-2xl px-5 py-6 text-[15px]">
                  No components yet. Add the first:{" "}
                  <span className="font-mono text-sm">
                    ./cluenori component add {project} {"<key>"} --name {"<name>"}
                  </span>
                  , then send its telemetry with the ingest key it prints.
                </p>
              )
            }
            return (
              <ul className="divide-y">
                {components.map((component) => {
                  const rows = table.rows.filter((row) => row.component === component.key)
                  const asked = sumOf(rows.map((row) => row.requests))
                  const failed = sumOf(rows.map((row) => row.errors))
                  const gotSlower = slowerIn(component.key)
                  return (
                    <li
                      key={component.key}
                      className="grid items-center gap-x-6 gap-y-3 px-5 py-4 lg:grid-cols-[15rem_minmax(0,1fr)_auto]"
                    >
                      <span className="flex items-center gap-3">
                        <span className="size-2.5 shrink-0" style={{ backgroundColor: colorOf(component.key, keys) }} />
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate text-[15px]">{component.name}</span>
                          <span className="truncate font-mono text-sm text-muted-foreground">{component.key}</span>
                        </span>
                      </span>
                      {rows.length === 0 ? (
                        <span className="text-sm text-muted-foreground">No requests in this period.</span>
                      ) : (
                        <dl className="grid grid-cols-3 gap-x-6">
                          {[
                            { label: "Requests", value: count(asked) },
                            {
                              label: "Error rate",
                              value: share(failed, asked),
                              ...(failed > 0 ? { color: failureColor } : {}),
                            },
                            {
                              label: "Got slower",
                              value: count(gotSlower),
                              ...(gotSlower > 0 ? { color: warningColor } : {}),
                            },
                          ].map((stat) => (
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
                            to={{ page: area, project, component: component.key }}
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
            )
          }}
        </Loaded>
      </Panel>
    </div>
  )
}
