import { BugIcon, CalendarClockIcon } from "lucide-react"

import { failureColor, warningColor } from "@/lib/colors"
import { axisTime, count, moment, nearlyAll } from "@/lib/format"
import {
  appHealthOf,
  colorOf,
  components,
  errorGroups,
  isReceiving,
  logLines,
  now,
  platformOf,
  platformWords,
  roleOf,
  setUpStepOf,
  stackOf,
  statusOf,
  sumOf,
  zoneName,
} from "@/project-facts"
import { navigate } from "@/router"
import type { ErrorGroup } from "@/sample/sample-project"
import type { BarRow } from "@/views/bar-rows"
import { BarRows } from "@/views/bar-rows"
import { ComponentSwitch } from "@/views/component-switch"
import { ErrorList } from "@/views/error-list"
import { NothingReceived } from "@/views/nothing-received"
import type { Stat } from "@/views/panel"
import { Panel } from "@/views/panel"
import { ProjectHeader } from "@/views/project-header"

const hour = 3_600_000
const hours = Array.from({ length: 24 }, (_, index) => Math.floor(now / hour) * hour - (23 - index) * hour)

// Errors that didn't end the app, a lighter red than crashes.
const handledColor = "color-mix(in oklab, var(--failure) 55%, transparent)"

const hourlyOf = (groups: ReadonlyArray<ErrorGroup>) =>
  hours.map((_, index) => sumOf(groups.map((group) => group.hourly[index] ?? 0)))

/**
 * The chart at the top and its numbers, by what is shown. Every component: a row of errors each,
 * hatched for one that sends nothing. An app: its sessions, its crashes, and its other errors, with
 * crash-free sessions. A backend: its errors.
 */
const chartOf = (
  component: string | undefined,
  groups: ReadonlyArray<ErrorGroup>,
): { readonly title: string; readonly rows: ReadonlyArray<BarRow>; readonly stats: ReadonlyArray<Stat> } => {
  const occurrences = sumOf(groups.map((group) => group.occurrences))
  const fresh = groups.filter((group) => statusOf(group).isNew).length
  const groupStats: ReadonlyArray<Stat> = [
    { label: "Groups", value: count(groups.length) },
    { label: "Occurrences", value: count(occurrences), ...(occurrences > 0 ? { color: failureColor } : {}) },
    { label: "New", value: count(fresh), ...(fresh > 0 ? { color: warningColor } : {}) },
  ]
  if (component === undefined) {
    return {
      title: "Errors by hour",
      stats: groupStats,
      rows: components.map((of) => {
        if (!isReceiving(of)) {
          return {
            label: of,
            note: "nothing yet",
            color: "var(--muted-foreground)",
            values: hours.map(() => undefined),
          }
        }
        const own = hourlyOf(groups.filter((group) => group.lastComponent === of))
        return { label: of, note: count(sumOf(own)), color: failureColor, values: own }
      }),
    }
  }
  const health = appHealthOf(component)
  if (health === undefined) {
    const own = hourlyOf(groups)
    return {
      title: "Errors by hour",
      stats: groupStats,
      rows: [{ label: "Errors", note: count(sumOf(own)), color: failureColor, values: own }],
    }
  }
  const handled = hourlyOf(groups.filter((group) => !group.crash))
  return {
    title: "Crashes by hour",
    stats: [
      { label: "Crash-free sessions", value: nearlyAll(health.sessions - health.crashed, health.sessions) },
      { label: "Crashes", value: count(health.crashed), ...(health.crashed > 0 ? { color: failureColor } : {}) },
      { label: "Sessions", value: count(health.sessions) },
      { label: "New groups", value: count(fresh), ...(fresh > 0 ? { color: warningColor } : {}) },
    ],
    rows: [
      { label: "Sessions", note: count(health.sessions), color: colorOf(component), values: health.sessionsHourly },
      { label: "Crashes", note: count(health.crashed), color: failureColor, values: health.crashesHourly },
      { label: "Errors", note: count(sumOf(handled)), color: handledColor, values: handled },
    ],
  }
}

/**
 * Every error of a project, or of one component, over the last day: when they happened, and each
 * error group, opening in place with its stack, its releases, and its evidence. An app's crashes
 * are counted against its sessions.
 */
export function ErrorsPage({
  project,
  component,
  error,
}: {
  readonly project: string
  readonly component?: string
  readonly error?: string
}) {
  const shown = component === undefined ? components : [component]
  const groups = errorGroups.filter((group) => shown.includes(group.lastComponent))
  const filtered = component === undefined ? {} : { component }
  const chart = chartOf(component, groups)

  const header = (
    <ProjectHeader title="Errors">
      <ComponentSwitch
        value={component}
        allowAll
        onChange={(picked) =>
          navigate(
            { page: "errors", project, ...(picked === undefined ? {} : { component: picked }) },
            { replace: true },
          )
        }
      />
    </ProjectHeader>
  )

  if (component !== undefined && !isReceiving(component)) {
    return (
      <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 p-4 md:p-6">
        {header}
        <NothingReceived
          component={component}
          platform={platformWords[platformOf(component)]}
          shows={
            roleOf(component) === "app"
              ? "its crashes and errors grouped by stack, with crash-free sessions, the people affected, and what the app did before each"
              : "its errors grouped by stack, with the requests they broke"
          }
          step={setUpStepOf(component)}
        />
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 p-4 md:p-6">
      {header}

      <Panel
        icon={CalendarClockIcon}
        title={chart.title}
        subtitle={component === undefined ? "Last 24 hours, by component" : `Last 24 hours, ${component}`}
        badge={zoneName}
        stats={chart.stats}
      >
        <div className="p-5">
          <BarRows
            rowHeight={64}
            label={`${chart.title} over the last day. A component that sends nothing yet is hatched.`}
            rows={chart.rows}
            ticks={[0, 6, 12, 18].map((column) => ({ column, label: axisTime(hours[column] ?? now) }))}
            timeOf={(span) => moment(hours[span.first] ?? now)}
          />
        </div>
      </Panel>

      <Panel
        icon={BugIcon}
        title="Error groups"
        subtitle="Grouped by type and place in code, or by logged message; most frequent first"
      >
        {groups.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">No errors in the last 24 hours.</p>
        ) : (
          <ErrorList
            project={project}
            groups={groups}
            framesOf={stackOf}
            occurrencesOf={(group) => logLines.filter((line) => line.error === group.id).slice(0, 5)}
            colorOf={colorOf}
            opened={error}
            onOpen={(opened) =>
              navigate(
                { page: "errors", project, ...filtered, ...(opened === undefined ? {} : { error: opened }) },
                { replace: true },
              )
            }
            now={now}
          />
        )}
      </Panel>
    </div>
  )
}
