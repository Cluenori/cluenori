import { CalendarClockIcon, ScrollTextIcon, SearchIcon } from "lucide-react"
import { useState } from "react"

import { failureColor, warningColor } from "@/lib/colors"
import { axisTime, count, moment } from "@/lib/format"
import {
  colorOf,
  isReceiving,
  logLines,
  now,
  platformOf,
  platformWords,
  roleOf,
  setUpStepOf,
  zoneName,
} from "@/project-facts"
import { navigate } from "@/router"
import { BarRows } from "@/views/bar-rows"
import { ComponentSwitch } from "@/views/component-switch"
import { LogList } from "@/views/log-list"
import { NothingReceived } from "@/views/nothing-received"
import { Panel } from "@/views/panel"
import { ProjectHeader } from "@/views/project-header"
import { Segmented } from "@/views/segmented"

const levels = [
  { value: "all", label: "All", shows: ["warn", "error", "fatal"] },
  { value: "warn", label: "Warnings", shows: ["warn"] },
  { value: "error", label: "Errors", shows: ["error", "fatal"] },
] as const

type Level = (typeof levels)[number]["value"]

const hour = 3_600_000
const hours = Array.from({ length: 24 }, (_, index) => Math.floor(now / hour) * hour - (23 - index) * hour)

/**
 * A project's warnings and errors, or one component's, over the last day: how many each hour, and
 * every line, searchable, each opening in place with a way to its request.
 */
export function LogsPage({ project, component }: { readonly project: string; readonly component?: string }) {
  const [level, setLevel] = useState<Level>("all")
  const [search, setSearch] = useState("")
  const chosen = levels.find((entry) => entry.value === level) ?? levels[0]
  const needle = search.trim().toLowerCase()
  const shown = (of: string) => component === undefined || of === component
  const lines = logLines.filter(
    (line) =>
      shown(line.component) &&
      chosen.shows.some((kept) => kept === line.level) &&
      (needle.length === 0 || `${line.message} ${line.category}`.toLowerCase().includes(needle)),
  )
  const perHour = (keep: (line: (typeof logLines)[number]) => boolean) =>
    hours.map((start) => lines.filter((line) => keep(line) && line.time >= start && line.time < start + hour).length)
  const warnings = lines.filter((line) => line.level === "warn").length
  const role = component === undefined ? undefined : roleOf(component)

  const header = (
    <ProjectHeader title="Logs">
      <ComponentSwitch
        value={component}
        allowAll
        onChange={(picked) =>
          navigate({ page: "logs", project, ...(picked === undefined ? {} : { component: picked }) }, { replace: true })
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
          shows="the warnings and errors it logs, searchable, each with a way to what it was doing"
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
        title="Warnings and errors by hour"
        subtitle={component === undefined ? "Last 24 hours, every component" : `Last 24 hours, ${component}`}
        badge={zoneName}
        stats={[
          { label: "Warnings", value: count(warnings), ...(warnings > 0 ? { color: warningColor } : {}) },
          {
            label: "Errors",
            value: count(lines.length - warnings),
            ...(lines.length > warnings ? { color: failureColor } : {}),
          },
        ]}
      >
        <div className="p-5">
          <BarRows
            rowHeight={64}
            label="Warnings and errors logged in each hour of the last day."
            rows={[
              { label: "Warnings", color: warningColor, values: perHour((line) => line.level === "warn") },
              { label: "Errors", color: failureColor, values: perHour((line) => line.level !== "warn") },
            ]}
            ticks={[0, 6, 12, 18].map((column) => ({ column, label: axisTime(hours[column] ?? now) }))}
            timeOf={(span) => moment(hours[span.first] ?? now)}
          />
        </div>
      </Panel>

      <Panel icon={ScrollTextIcon} title="Log lines" subtitle="Newest first; open one to see where it came from">
        <div className="flex flex-wrap items-center gap-2 border-b px-5 py-3">
          <Segmented
            label="Levels"
            options={levels.map((entry) => ({ value: entry.value, label: entry.label }))}
            value={level}
            onChange={setLevel}
          />
          <label className="flex h-9 min-w-48 flex-1 items-center gap-2 border bg-card px-3 focus-within:border-ring md:max-w-md">
            <SearchIcon className="size-4 text-muted-foreground" />
            <span className="sr-only">Search the logs</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search messages and loggers"
              className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </label>
        </div>
        {lines.length === 0 ? (
          <p className="max-w-2xl px-5 py-6 text-[15px] text-muted-foreground">
            {role === "app" && needle.length === 0
              ? `${component} logged no ${chosen.label.toLowerCase()} in the last 24 hours; an app sends the warnings and errors it logs through the Cluenori SDK.`
              : `Nothing matches${needle.length > 0 ? ` “${search.trim()}”` : ""}.`}
          </p>
        ) : (
          <LogList project={project} lines={lines} colorOf={colorOf} />
        )}
      </Panel>
    </div>
  )
}
