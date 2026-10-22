import type { EnvironmentKey, ProjectKey } from "@cluenori/foundation"
import type { ProjectSettings } from "@cluenori/projects"
import { errorStatusOf, operationKeyOf, slowerOperations } from "@cluenori/signals"
import { useAtom, useAtomValue } from "@effect/atom-react"
import { DateTime } from "effect"
import { Atom, AsyncResult } from "effect/reactivity"
import { ActivityIcon, BellIcon, BoxesIcon, BugIcon, RadioTowerIcon, ScrollTextIcon, TagIcon } from "lucide-react"
import { lazy, Suspense, useState } from "react"

import { failureColor, warningColor } from "@/lib/colors"
import { count, duration, share } from "@/lib/format"
import {
  operationsAtom,
  errorsAtom,
  incidentsAtom,
  logCountsAtom,
  periodAtom,
  projectAtom,
  loadAtom,
  releasesAtom,
  updateSettingsAtom,
  usualOperationsAtom,
} from "@/project-data"
import {
  attentionOf,
  colorOf,
  columnTimesOf,
  endOf,
  logColumnsOf,
  periodWords,
  loadColumnsOf,
  isShownIn,
  releaseRouteOf,
  sumOf,
  ticksOf,
} from "@/project-facts"
import type { Environments } from "@/project-facts"
import type { Area } from "@/router"
import { Link } from "@/router"
import { AttentionList } from "@/views/attention-list"
import { BarRows } from "@/views/bar-rows"
import { EnvironmentSwitch } from "@/views/environment-switch"
import { titleParts } from "@/views/error-group"
import { Loaded } from "@/views/loaded"
import { Panel, PanelStats } from "@/views/panel"
import { PeriodSwitch } from "@/views/period-switch"
import { ProjectHeader } from "@/views/project-header"
import { Button, buttonVariants } from "@/views/ui/button"

const areaWords: Readonly<Record<Area, string>> = {
  performance: "Performance",
  errors: "Errors",
  logs: "Logs",
  releases: "Releases",
}

// The list of releases, and of the sources that failed, load after start, with the releases'
// pages, so the first load holds its budget.
const releaseList = import("@/views/release-list")
const ReleaseList = lazy(() => releaseList.then((module) => ({ default: module.ReleaseList })))
const sourceProblems = import("@/views/source-problems")
const SourceProblems = lazy(() => sourceProblems.then((module) => ({ default: module.SourceProblems })))
// Changing production loads when opened, now and then.
const ProductionDialog = lazy(() =>
  import("@/views/production-dialog").then((module) => ({ default: module.ProductionDialog })),
)

// How many releases the summary shows, the latest first; the releases page lists every one.
const summaryReleases = 4

function OpenButton({
  project,
  environment,
  area,
}: {
  readonly project: ProjectKey
  readonly environment: EnvironmentKey | undefined
  readonly area: Area
}) {
  return (
    <Link
      to={{ page: area, project, ...(environment === undefined ? {} : { environment }) }}
      className={buttonVariants({ variant: "outline", size: "sm" })}
    >
      Open
    </Link>
  )
}

/**
 * The environments the project calls production, which its alerts, Today, and its pages start in,
 * each marked when its telemetry hasn't named it lately; one click from changing them.
 */
function ProductionPanel({
  project,
  name,
  settings,
  seen,
}: {
  readonly project: ProjectKey
  readonly name: string
  readonly settings: ProjectSettings
  readonly seen: ReadonlyArray<EnvironmentKey>
}) {
  const [saving, save] = useAtom(updateSettingsAtom)
  const [changing, setChanging] = useState(false)
  return (
    <Panel
      icon={RadioTowerIcon}
      title="Production"
      subtitle="Where alerts ring, Today counts, and these pages start"
      action={
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            // A save from an earlier dialog isn't this one's.
            save(Atom.Reset)
            setChanging(true)
          }}
        >
          Change<span className="sr-only"> production</span>
        </Button>
      }
    >
      <ul className="flex flex-wrap gap-x-8 gap-y-2 px-5 py-4">
        {settings.productionEnvironments.map((environment) => (
          <li key={environment} className="flex items-baseline gap-2 text-[15px]">
            {environment}
            {!seen.includes(environment) && (
              <span className="text-sm text-muted-foreground">not seen in the last 30 days</span>
            )}
          </li>
        ))}
      </ul>
      {changing && (
        <Suspense fallback={null}>
          <ProductionDialog
            projectName={name}
            settings={settings}
            seen={seen}
            // Open until it is closed, or its save succeeds.
            open={!AsyncResult.isSuccess(saving)}
            onOpenChange={(open) => {
              if (!open) {
                setChanging(false)
              }
            }}
            saving={saving}
            onSave={(next) => save({ project, settings: next })}
          />
        </Suspense>
      )}
    </Panel>
  )
}

// A summary chart's rows: as tall as the errors list beside it, about four errors, so a panel of the
// summary row holds no empty space.
const summaryRowHeight = 96

// A summary chart is narrow, so it names only every other of the usual four times.
const everyOther = <T,>(ticks: ReadonlyArray<T>) => ticks.filter((_, index) => index % 2 === 0)

/**
 * A project's starting point: what needs attention now, a summary of each area with a way into its
 * page, its latest releases, and its components. Later areas, such as analytics, add their
 * summaries here.
 */
export function OverviewPage({
  project,
  environments,
}: {
  readonly project: ProjectKey
  readonly environments: Environments
}) {
  const environment = environments.shown
  const inShown = environment === undefined ? {} : { environment }
  const scope = { project, ...inShown }
  const period = useAtomValue(periodAtom)
  const detail = useAtomValue(projectAtom(project))
  const load = useAtomValue(loadAtom(scope))
  const operations = useAtomValue(operationsAtom(scope))
  const compared = useAtomValue(usualOperationsAtom(scope))
  const errors = useAtomValue(errorsAtom(scope))
  const incidents = useAtomValue(incidentsAtom(project))
  const logCounts = useAtomValue(logCountsAtom({ ...scope, by: "level" }))
  // Every environment's releases, the page keeping those of the environment shown (`isShownIn`).
  const releases = useAtomValue(releasesAtom({ project }))
  const periodText = periodWords[period].toLowerCase()

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 p-4 md:p-6">
      <ProjectHeader
        title={AsyncResult.isSuccess(detail) ? detail.value.project.name : project}
        latest={AsyncResult.map(operations, (table) =>
          table.dataUntil === undefined ? undefined : DateTime.toEpochMillis(table.dataUntil),
        )}
      >
        <EnvironmentSwitch
          project={project}
          environments={environments}
          routeOf={(picked) => ({ page: "overview", project, environment: picked })}
        />
        <PeriodSwitch />
      </ProjectHeader>

      <Panel icon={BellIcon} title="Needs attention" subtitle="What is wrong now, the worst first">
        <Loaded result={AsyncResult.all({ incidents, errors, compared })}>
          {(facts) => <AttentionList items={attentionOf({ project, environments, ...facts })} />}
        </Loaded>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel
          icon={ActivityIcon}
          title="Load"
          subtitle={periodWords[period]}
          action={<OpenButton project={project} environment={environment} area="performance" />}
        >
          <Loaded result={AsyncResult.all({ load, operations })}>
            {({ load: series, operations: table }) => {
              const asked = loadColumnsOf(series, (point) => point.count)
              const failed = loadColumnsOf(series, (point) => point.errors)
              const { whenOf } = columnTimesOf(asked)
              const slowest = table.rows.toSorted((left, right) => right.p95Ms - left.p95Ms)[0]
              return (
                <>
                  <div className="my-auto px-5 py-5">
                    <BarRows
                      rowHeight={summaryRowHeight}
                      label="The load on every component over the period, and what failed."
                      rows={[
                        { label: "Total", color: "var(--blue)", values: asked.values },
                        { label: "Failed", color: failureColor, values: failed.values },
                      ]}
                      ticks={everyOther(ticksOf(asked))}
                      timeOf={(span) => whenOf(span.first)}
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
          action={<OpenButton project={project} environment={environment} area="errors" />}
        >
          <Loaded result={AsyncResult.all({ errors, detail })}>
            {({ errors: table, detail: { components } }) => {
              const now = endOf(table)
              const fresh =
                now === undefined ? 0 : table.groups.filter((group) => errorStatusOf(group, now).isNew).length
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
                            to={{ page: "error", project, ...inShown, error: group.id }}
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
          action={<OpenButton project={project} environment={environment} area="logs" />}
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
                      rowHeight={summaryRowHeight}
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

      <Panel
        icon={TagIcon}
        title="Releases"
        subtitle="The latest first, each against the release before it"
        action={<OpenButton project={project} environment={environment} area="releases" />}
      >
        <Loaded result={AsyncResult.all({ releases, detail })}>
          {({ releases: answer, detail: { components } }) => {
            const keys = components.map((component) => component.key)
            return (
              <Suspense fallback={<p className="px-5 py-6 text-sm text-muted-foreground">Loading…</p>}>
                {/* A source that failed lately, so a release without its commit or build isn't read as having none. */}
                {answer.problems.length > 0 && (
                  <div className="border-b">
                    <SourceProblems problems={answer.problems} asOf={answer.asOf} colorOf={(of) => colorOf(of, keys)} />
                  </div>
                )}
                <ReleaseList
                  releases={answer.releases
                    .filter((release) => isShownIn(environments, release.environment))
                    .slice(0, summaryReleases)}
                  asOf={answer.asOf}
                  colorOf={(of) => colorOf(of, keys)}
                  linkOf={(release) => releaseRouteOf(project, release)}
                />
              </Suspense>
            )
          }}
        </Loaded>
      </Panel>

      <Panel icon={BoxesIcon} title="Components" subtitle={`How each part is doing, ${periodText}`}>
        <Loaded result={AsyncResult.all({ detail, operations, compared })}>
          {({ detail: { components }, operations: table, compared: usual }) => {
            const keys = components.map((component) => component.key)
            const slower = slowerOperations(usual)
            const slowerIn = (component: string) =>
              usual.lastDay.rows.filter((row) => row.component === component && slower.has(operationKeyOf(row))).length
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
                  const asked = sumOf(rows.map((row) => row.count))
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
                        <span className="text-sm text-muted-foreground">Nothing reported in this period.</span>
                      ) : (
                        <dl className="grid grid-cols-3 gap-x-6">
                          {[
                            { label: "Total", value: count(asked) },
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
                        {(["performance", "errors", "logs", "releases"] as const).map((area) => (
                          <Link
                            to={{ page: area, project, component: component.key, ...inShown }}
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

      {AsyncResult.isSuccess(detail) && detail.value.settings !== undefined && (
        <ProductionPanel
          project={project}
          name={detail.value.project.name}
          settings={detail.value.settings}
          seen={detail.value.environments ?? []}
        />
      )}
    </div>
  )
}
