import type { ComponentKey, ProjectKey } from "@cluenori/foundation"
import type { ErrorGroup, ErrorGroupId } from "@cluenori/signals"
import { useAtomValue } from "@effect/atom-react"
import { DateTime } from "effect"
import { AsyncResult } from "effect/reactivity"
import { BugIcon, CalendarClockIcon } from "lucide-react"

import { failureColor, warningColor } from "@/lib/colors"
import { count, moment } from "@/lib/format"
import { errorAtom, errorsAtom, logCountsAtom, periodAtom, useComponentKeys } from "@/project-data"
import {
  colorOf,
  columnTimesOf,
  endOf,
  framesOf,
  logColumnsOf,
  periodWords,
  statusOf,
  ticksOf,
  zoneOf,
} from "@/project-facts"
import { navigate } from "@/router"
import { BarRows } from "@/views/bar-rows"
import { ComponentSwitch } from "@/views/component-switch"
import { ErrorEvidence, ErrorList } from "@/views/error-list"
import { Loaded } from "@/views/loaded"
import { Panel, PanelStats } from "@/views/panel"
import { PeriodSwitch } from "@/views/period-switch"
import { ProjectHeader } from "@/views/project-header"

/** An opened error's evidence: its latest occurrences in the period, and its stack. */
function OpenedError({
  project,
  group,
  now,
}: {
  readonly project: ProjectKey
  readonly group: ErrorGroup
  readonly now: number
}) {
  const detail = useAtomValue(errorAtom({ project, error: group.id }))
  return (
    <Loaded result={detail}>
      {({ latest }) => (
        <ErrorEvidence
          project={project}
          group={group}
          now={now}
          latest={latest}
          frames={framesOf(latest.find((line) => line.exception?.stack !== undefined)?.exception)}
        />
      )}
    </Loaded>
  )
}

/**
 * Every error of a project, or of one component, over the period: when they happened, by component,
 * and each error group, most frequent first, opening in place with its stack and its latest
 * occurrences, each one click from its request.
 */
export function ErrorsPage({
  project,
  component,
  error,
}: {
  readonly project: ProjectKey
  readonly component?: ComponentKey
  readonly error?: ErrorGroupId
}) {
  const scope = { project, ...(component === undefined ? {} : { component }) }
  const period = useAtomValue(periodAtom)
  const components = useComponentKeys(project)
  const errors = useAtomValue(errorsAtom(scope))
  const byComponent = useAtomValue(logCountsAtom({ ...scope, by: "component", level: "error" }))
  const byGroup = useAtomValue(logCountsAtom({ ...scope, by: "error", level: "error" }))
  const shown = component === undefined ? components : [component]
  const periodText = periodWords[period].toLowerCase()

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 p-4 md:p-6">
      <ProjectHeader
        title="Errors"
        latest={AsyncResult.map(errors, (table) => {
          const latest = table.groups.map((group) => DateTime.toEpochMillis(group.lastSeen))
          return latest.length === 0 ? undefined : Math.max(...latest)
        })}
      >
        <ComponentSwitch
          components={components}
          value={component}
          allowAll
          onChange={(picked) =>
            navigate(
              { page: "errors", project, ...(picked === undefined ? {} : { component: picked }) },
              { replace: true },
            )
          }
        />
        <PeriodSwitch />
      </ProjectHeader>

      <Panel
        icon={CalendarClockIcon}
        title="Errors over time"
        subtitle={
          component === undefined ? `${periodWords[period]}, by component` : `${periodWords[period]}, ${component}`
        }
        badge={AsyncResult.isSuccess(byComponent) ? zoneOf(byComponent.value) : undefined}
      >
        <Loaded result={AsyncResult.all({ byComponent, errors })}>
          {({ byComponent: counts, errors: table }) => {
            const columns = logColumnsOf(counts, shown)
            const { startOf } = columnTimesOf(columns)
            const now = endOf(table)
            const fresh = now === undefined ? 0 : table.groups.filter((group) => statusOf(group, now).isNew).length
            return (
              <>
                <div className="p-5">
                  <BarRows
                    rowHeight={64}
                    label={`Errors logged over the ${periodText}, by component.`}
                    rows={shown.map((of) => {
                      const series = counts.series.find((entry) => entry.key === of)
                      return {
                        label: of,
                        // A component with no series recorded no errors: it may be fine, or silent.
                        note: series === undefined ? "none recorded" : count(series.total),
                        color: failureColor,
                        values: logColumnsOf(counts, [of]).values,
                      }
                    })}
                    ticks={ticksOf(columns)}
                    timeOf={(span) => moment(startOf(span.first))}
                  />
                </div>
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
        icon={BugIcon}
        title="Error groups"
        subtitle="Grouped by type and place in code, or by logged message; most frequent first"
      >
        <Loaded result={errors}>
          {(table) => {
            const now = endOf(table)
            if (table.groups.length === 0 || now === undefined) {
              return <p className="px-5 py-6 text-sm text-muted-foreground">No errors in this period.</p>
            }
            // Each group's bars, once they are counted; the 100 most frequent are.
            const counts = AsyncResult.isSuccess(byGroup) ? byGroup.value : undefined
            return (
              <ErrorList
                groups={table.groups}
                now={now}
                colorOf={(of) => colorOf(of, components)}
                stepsOf={(group) =>
                  counts?.series.some((series) => series.key === group.id) === true
                    ? logColumnsOf(counts, [group.id]).values
                    : undefined
                }
                opened={error}
                onOpen={(opened) =>
                  navigate(
                    { page: "errors", ...scope, ...(opened === undefined ? {} : { error: opened }) },
                    { replace: true },
                  )
                }
                renderOpened={(group) => <OpenedError project={project} group={group} now={now} />}
              />
            )
          }}
        </Loaded>
      </Panel>
    </div>
  )
}
