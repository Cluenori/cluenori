import type { EnvironmentKey, ProjectKey } from "@cluenori/foundation"
import type { ProjectSettings } from "@cluenori/projects"
import { errorStatusOf, operationKeyOf, slowerOperations } from "@cluenori/signals"
import { useAtom, useAtomValue } from "@effect/atom-react"
import { DateTime } from "effect"
import { Atom, AsyncResult } from "effect/reactivity"
import { ActivityIcon, BoxesIcon, BugIcon, RadioTowerIcon, ScrollTextIcon, SirenIcon } from "lucide-react"
import type { ReactNode } from "react"
import { lazy, Suspense, useState } from "react"

import { failureColor, warningColor } from "@/lib/colors"
import { count, duration, share } from "@/lib/format"
import {
  errorsAtom,
  incidentsAtom,
  meAtom,
  logCountsAtom,
  operationsAtom,
  periodAtom,
  projectAtom,
  updateSettingsAtom,
  useComponentKeys,
  usualOperationsAtom,
} from "@/project-data"
import type { Environments } from "@/project-facts"
import {
  colorOf,
  endOf,
  incidentActionOf,
  isShownIn,
  logColumnsOf,
  operationRowsOf,
  periodWords,
  sumOf,
  ticksOf,
} from "@/project-facts"
import type { Filters, Route } from "@/router"
import { Link } from "@/router"
import { EnvironmentSwitch } from "@/views/environment-switch"
import { IncidentRow } from "@/views/incident-row"
import { LoadBars } from "@/views/load-bars"
import { Loaded } from "@/views/loaded"
import { OperationName } from "@/views/operation-name"
import { Panel, PanelStats } from "@/views/panel"
import { PeriodSwitch } from "@/views/period-switch"
import { ProjectHeader } from "@/views/project-header"
import { Button, buttonVariants } from "@/views/ui/button"

// Changing production loads when opened, now and then.
const ProductionDialog = lazy(() =>
  import("@/views/production-dialog").then((module) => ({ default: module.ProductionDialog })),
)

// An owner's ingest keys load after start, and only for an owner.
const IngestKeysPanel = lazy(() =>
  import("@/pages/ingest-keys-panel").then((module) => ({ default: module.IngestKeysPanel })),
)

// How many of each the summary shows; each area's own page has every one.
const topFew = 5

const rowLink =
  "flex min-w-0 items-center gap-4 px-5 py-3 outline-none hover:bg-accent/60 focus-visible:bg-accent/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"

/** The way to a section's full page, in its header. */
function AllLink({ to, children }: { readonly to: Route; readonly children: ReactNode }) {
  return (
    <Link to={to} className={buttonVariants({ variant: "outline", size: "sm" })}>
      {children}
    </Link>
  )
}

/** A short list's last line when there is nothing in it. */
function NoneYet({ children }: { readonly children: ReactNode }) {
  return <p className="flex-1 px-5 py-5 text-sm text-muted-foreground">{children}</p>
}

/** The operations that got slower, then those that take the most time, each one click from its page. */
function Requests({ project, filters }: { readonly project: ProjectKey; readonly filters: Filters }) {
  const scope = { project, ...filters }
  const operations = useAtomValue(operationsAtom(scope))
  const compared = useAtomValue(usualOperationsAtom(scope))
  const components = useComponentKeys(project)
  return (
    <Panel
      icon={ActivityIcon}
      title="Requests"
      subtitle="Any slower than usual first, then the most time in total"
      action={<AllLink to={{ page: "performance", project, ...filters }}>All requests</AllLink>}
    >
      <Loaded result={AsyncResult.all({ operations, compared })}>
        {({ operations: table, compared: usual }) => {
          const rows = operationRowsOf(table, usual)
          const byTime = rows.toSorted((left, right) => right.count * right.averageMs - left.count * left.averageMs)
          const ordered = [
            ...byTime.filter((row) => row.slower !== undefined),
            ...byTime.filter((row) => row.slower === undefined),
          ]
          const slower = ordered.filter((row) => row.slower !== undefined).length
          return (
            <>
              {ordered.length === 0 ? (
                <NoneYet>Nothing ran in this period.</NoneYet>
              ) : (
                <ul className="flex-1 divide-y">
                  {ordered.slice(0, topFew).map((row) => (
                    <li key={operationKeyOf(row)}>
                      <Link
                        to={{
                          page: "operation",
                          project,
                          ...filters,
                          component: row.component,
                          operation: row.operation,
                        }}
                        className={rowLink}
                      >
                        <span
                          className="size-2 shrink-0"
                          style={{ backgroundColor: colorOf(row.component, components) }}
                        />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <OperationName name={row.operation} className="text-[15px]" />
                          <span className="text-sm text-muted-foreground">
                            {row.slower === undefined ? (
                              `${count(row.count)} ran, ${share(row.errors, row.count)} failed`
                            ) : (
                              <span className="text-yellow-ink">
                                Slower: p95 {duration(row.slower.p95Ms)} over the last day, usually{" "}
                                {duration(row.slower.usualP95Ms)}
                              </span>
                            )}
                          </span>
                        </span>
                        <span className="flex shrink-0 flex-col items-end">
                          <span className="font-mono text-[15px]">{duration(row.p95Ms)}</span>
                          <span className="text-xs text-muted-foreground">p95</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              <PanelStats
                stats={[
                  { label: "Ran", value: count(table.count) },
                  {
                    label: "Error rate",
                    value: share(table.errors, table.count),
                    ...(table.errors > 0 ? { color: failureColor } : {}),
                  },
                  { label: "Slower", value: count(slower), ...(slower > 0 ? { color: warningColor } : {}) },
                ]}
              />
              <p className="border-t px-5 py-3 text-sm">
                <Link to={{ page: "performance", project, ...filters }} className="underline underline-offset-4">
                  Load and failures over time
                </Link>
              </p>
            </>
          )
        }}
      </Loaded>
    </Panel>
  )
}

/** The errors happening now and the new ones first, then the most frequent, each one click from its page. */
function Errors({ project, filters }: { readonly project: ProjectKey; readonly filters: Filters }) {
  const errors = useAtomValue(errorsAtom({ project, ...filters }))
  const components = useComponentKeys(project)
  return (
    <Panel
      icon={BugIcon}
      title="Errors"
      subtitle="Happening now and new first, then the most frequent"
      action={<AllLink to={{ page: "errors", project, ...filters }}>All errors</AllLink>}
    >
      <Loaded result={errors}>
        {(table) => {
          const now = endOf(table)
          const judged = table.groups.map((group) => ({
            group,
            ...(now === undefined ? { isNew: false, ongoing: false } : errorStatusOf(group, now)),
          }))
          const ordered = [
            ...judged.filter((entry) => entry.ongoing),
            ...judged.filter((entry) => entry.isNew && !entry.ongoing),
            ...judged.filter((entry) => !entry.isNew && !entry.ongoing),
          ]
          const fresh = judged.filter((entry) => entry.isNew).length
          return (
            <>
              {ordered.length === 0 ? (
                <NoneYet>No errors in this period.</NoneYet>
              ) : (
                <ul className="flex-1 divide-y">
                  {ordered.slice(0, topFew).map(({ group, isNew, ongoing }) => (
                    <li key={group.id}>
                      <Link to={{ page: "error", project, ...filters, error: group.id }} className={rowLink}>
                        <span
                          className="size-2 shrink-0"
                          style={{ backgroundColor: colorOf(group.lastComponent, components) }}
                        />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate text-[15px]">{group.title}</span>
                          <span className="text-sm text-muted-foreground">
                            {group.lastComponent}
                            {ongoing && <span className="text-failure"> · happening now</span>}
                            {isNew && <span className="text-yellow-ink"> · new</span>}
                          </span>
                        </span>
                        <span className="flex shrink-0 flex-col items-end">
                          <span className="font-mono text-[15px]">{count(group.occurrences)}</span>
                          <span className="text-xs text-muted-foreground">occurrences</span>
                        </span>
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
  )
}

/** Warnings and errors logged over the period, by when. */
function Logs({ project, filters }: { readonly project: ProjectKey; readonly filters: Filters }) {
  const counts = useAtomValue(logCountsAtom({ project, ...filters, by: "level" }))
  return (
    <Panel
      icon={ScrollTextIcon}
      title="Logs"
      subtitle="Warnings and errors over the period"
      action={<AllLink to={{ page: "logs", project, ...filters }}>All logs</AllLink>}
    >
      <Loaded result={counts}>
        {(answer) => {
          const logged = logColumnsOf(answer, ["warn", "error", "fatal"])
          const errorsLogged = logColumnsOf(answer, ["error", "fatal"])
          const totalOf = (keys: ReadonlyArray<string>) =>
            sumOf(answer.series.filter((series) => keys.includes(series.key)).map((series) => series.total))
          const warned = totalOf(["warn"])
          const failed = totalOf(["error", "fatal"])
          return (
            <>
              <div className="my-auto flex flex-col gap-3 px-5 py-5">
                <LoadBars
                  total={logged.values}
                  failed={errorsLogged.values}
                  color={warningColor}
                  height={96}
                  ticks={ticksOf(logged)}
                  label={`${count(warned)} warnings and ${count(failed)} errors logged over the period.`}
                />
                <p className="flex gap-4 text-sm text-muted-foreground">
                  <span className="flex items-center gap-2">
                    <span className="size-2.5 bg-yellow" />
                    Warnings
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="size-2.5 bg-failure" />
                    Errors
                  </span>
                </p>
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
  )
}

/** The open incidents, then those resolved lately, of the environment shown, each one click from its evidence. */
function Incidents({ project, environments }: { readonly project: ProjectKey; readonly environments: Environments }) {
  const incidents = useAtomValue(incidentsAtom(project))
  return (
    <Panel
      icon={SirenIcon}
      title="Incidents"
      subtitle="Open first, then those resolved in the last 7 days"
      action={<AllLink to={{ page: "incidents", project }}>All incidents</AllLink>}
    >
      <Loaded result={incidents}>
        {(list) => {
          const looked = list.checkedAt === undefined ? undefined : DateTime.toEpochMillis(list.checkedAt)
          const open = list.open.filter((incident) => isShownIn(environments, incident.environment))
          const resolved = list.resolved.filter((incident) => isShownIn(environments, incident.environment))
          const shown = [...open, ...resolved].slice(0, topFew)
          return (
            <>
              {shown.length === 0 ? (
                <NoneYet>No incidents in the last 7 days.</NoneYet>
              ) : (
                <ul className="flex-1 divide-y">
                  {shown.map((incident) => (
                    <li key={incident.id}>
                      <IncidentRow
                        incident={incident}
                        now={looked ?? DateTime.toEpochMillis(incident.openedAt)}
                        to={incidentActionOf(project, incident).to}
                      />
                    </li>
                  ))}
                </ul>
              )}
              <PanelStats
                stats={[
                  { label: "Open", value: count(open.length), ...(open.length > 0 ? { color: failureColor } : {}) },
                  { label: "Resolved, 7 days", value: count(resolved.length) },
                ]}
              />
            </>
          )
        }}
      </Loaded>
    </Panel>
  )
}

/** Each component's numbers over the period, one click from its own requests, errors, logs and releases. */
function Components({ project, environment }: { readonly project: ProjectKey; readonly environment?: EnvironmentKey }) {
  const inShown = environment === undefined ? {} : { environment }
  const scope = { project, ...inShown }
  const period = useAtomValue(periodAtom)
  const detail = useAtomValue(projectAtom(project))
  const operations = useAtomValue(operationsAtom(scope))
  const compared = useAtomValue(usualOperationsAtom(scope))
  return (
    <Panel
      icon={BoxesIcon}
      title="Components"
      subtitle={`How each part is doing, ${periodWords[period].toLowerCase()}`}
    >
      <Loaded result={AsyncResult.all({ detail, operations, compared })}>
        {({ detail: { components }, operations: table, compared: usual }) => {
          const keys = components.map((component) => component.key)
          const slower = slowerOperations(usual)
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
                const ran = sumOf(rows.map((row) => row.count))
                const failed = sumOf(rows.map((row) => row.errors))
                const gotSlower = usual.lastDay.rows.filter(
                  (row) => row.component === component.key && slower.has(operationKeyOf(row)),
                ).length
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
                          { label: "Ran", value: count(ran) },
                          {
                            label: "Error rate",
                            value: share(failed, ran),
                            ...(failed > 0 ? { color: failureColor } : {}),
                          },
                          {
                            label: "Slower",
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
                      {(
                        [
                          { page: "performance", label: "Performance" },
                          { page: "errors", label: "Errors" },
                          { page: "logs", label: "Logs" },
                          { page: "releases", label: "Releases" },
                        ] as const
                      ).map((area) => (
                        <Link
                          to={{ page: area.page, project, component: component.key, ...inShown }}
                          key={area.page}
                          aria-label={`${area.label} of ${component.key}`}
                          className={buttonVariants({ variant: "outline", size: "sm" })}
                        >
                          {area.label}
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

/**
 * Tech: a project's operations, errors, logs and incidents, each with its top few and a way to its
 * full page, in the environment shown and over the period; then each component's numbers, which
 * environments the project calls production, and, for an owner, each component's ingest keys.
 */
export function TechPage({
  project,
  environments,
}: {
  readonly project: ProjectKey
  readonly environments: Environments
}) {
  const environment = environments.shown
  const filters: Filters = environment === undefined ? {} : { environment }
  const detail = useAtomValue(projectAtom(project))
  const operations = useAtomValue(operationsAtom({ project, ...filters }))
  const me = useAtomValue(meAtom)
  const owner = AsyncResult.isSuccess(me) && me.value.role === "owner"
  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 p-4 md:p-6">
      <ProjectHeader
        title="Tech"
        latest={AsyncResult.map(operations, (table) =>
          table.dataUntil === undefined ? undefined : DateTime.toEpochMillis(table.dataUntil),
        )}
      >
        <EnvironmentSwitch
          project={project}
          environments={environments}
          routeOf={(picked) => ({ page: "tech", project, environment: picked })}
        />
        <PeriodSwitch />
      </ProjectHeader>

      <div className="grid gap-4 xl:grid-cols-2">
        <Requests project={project} filters={filters} />
        <Errors project={project} filters={filters} />
        <Logs project={project} filters={filters} />
        <Incidents project={project} environments={environments} />
      </div>

      <Components project={project} {...(environment === undefined ? {} : { environment })} />

      {AsyncResult.isSuccess(detail) && detail.value.settings !== undefined && (
        <ProductionPanel
          project={project}
          name={detail.value.project.name}
          settings={detail.value.settings}
          seen={detail.value.environments ?? []}
        />
      )}

      {owner && AsyncResult.isSuccess(detail) && detail.value.components.length > 0 && (
        <Suspense fallback={null}>
          <IngestKeysPanel project={project} components={detail.value.components} />
        </Suspense>
      )}
    </div>
  )
}
