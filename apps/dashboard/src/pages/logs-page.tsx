import type { ComponentKey, EnvironmentKey, ProjectKey, ReleaseVersion } from "@cluenori/foundation"
import type { IndexedLevel } from "@cluenori/signals"
import { useAtomValue } from "@effect/atom-react"
import { DateTime } from "effect"
import { AsyncResult } from "effect/reactivity"
import { CalendarClockIcon, ScrollTextIcon, SearchIcon } from "lucide-react"
import { useState } from "react"

import { failureColor, warningColor } from "@/lib/colors"
import { count, moment } from "@/lib/format"
import { logCountsAtom, logsAtom, periodAtom, useComponentKeys } from "@/project-data"
import { colorOf, columnTimesOf, logColumnsOf, periodWords, sumOf, ticksOf, zoneOf } from "@/project-facts"
import type { Environments } from "@/project-facts"
import type { Filters } from "@/router"
import { BarRows } from "@/views/bar-rows"
import { FilterSwitches } from "@/views/filter-switches"
import { Loaded } from "@/views/loaded"
import { LogList } from "@/views/log-list"
import { Panel, PanelStats } from "@/views/panel"
import { ProjectHeader } from "@/views/project-header"
import { Segmented } from "@/views/segmented"
import { Button } from "@/views/ui/button"

// Which lines to show, as the API's lowest level: every warning and error, or errors only.
const levels = [
  { value: "warn", label: "All" },
  { value: "error", label: "Errors" },
] as const satisfies ReadonlyArray<{ readonly value: IndexedLevel; readonly label: string }>

// The longest search the API takes.
const longestSearch = 200

type Lines = {
  readonly project: ProjectKey
  readonly component?: ComponentKey
  readonly environment?: EnvironmentKey
  readonly release?: ReleaseVersion
  readonly level: IndexedLevel
  readonly search?: string
}

/** One page of lines, from `before` on, and the button to the next older one when there is one. */
function LogPage({
  lines,
  before,
  colorOf: colorOfComponent,
  onOlder,
}: {
  readonly lines: Lines
  readonly before: number | undefined
  readonly colorOf: (component: string) => string
  readonly onOlder: ((next: number) => void) | undefined
}) {
  const page = useAtomValue(logsAtom({ ...lines, ...(before === undefined ? {} : { before }) }))
  return (
    <Loaded result={page}>
      {({ lines: shown, next }) => (
        <>
          {before === undefined && shown.length === 0 ? (
            <p className="max-w-2xl px-5 py-6 text-[15px] text-muted-foreground">
              {lines.search === undefined
                ? "Nothing was logged at this level in this period."
                : `Nothing matches “${lines.search}”.`}
            </p>
          ) : (
            <LogList
              project={lines.project}
              lines={shown}
              colorOf={colorOfComponent}
              traceFilters={{
                ...(lines.environment === undefined ? {} : { environment: lines.environment }),
                ...(lines.release === undefined ? {} : { release: lines.release }),
              }}
            />
          )}
          {next !== undefined && onOlder !== undefined && (
            <div className="border-t px-5 py-3">
              <Button variant="outline" size="sm" onClick={() => onOlder(next)}>
                Show older lines
              </Button>
            </div>
          )}
        </>
      )}
    </Loaded>
  )
}

/**
 * The lines, a page of 100 at a time, newest first. Older pages continue from where the one before
 * ended, so the pages start over when what they show changes (`key`).
 */
function LogPages({
  lines,
  colorOf: colorOfComponent,
}: {
  readonly lines: Lines
  readonly colorOf: (component: string) => string
}) {
  const [older, setOlder] = useState<ReadonlyArray<number>>([])
  const pages = [undefined, ...older]
  return (
    <div className="flex flex-col">
      {pages.map((before, index) => (
        <LogPage
          key={before ?? "newest"}
          lines={lines}
          before={before}
          colorOf={colorOfComponent}
          onOlder={index === pages.length - 1 ? (next) => setOlder([...older, next]) : undefined}
        />
      ))}
    </div>
  )
}

/**
 * A project's warnings and errors, or one component's, in the environment shown, or one release's,
 * over the period: how many in each step, and every line, newest first, searchable, each opening in
 * place with a way to its trace and its release.
 */
export function LogsPage({
  project,
  component,
  release,
  environments,
}: {
  readonly project: ProjectKey
  readonly component?: ComponentKey
  readonly release?: ReleaseVersion
  readonly environments: Environments
}) {
  const environment = environments.shown
  const filters: Filters = {
    ...(component === undefined ? {} : { component }),
    ...(environment === undefined ? {} : { environment }),
    ...(release === undefined ? {} : { release }),
  }
  const scope = { project, ...filters }
  const period = useAtomValue(periodAtom)
  const components = useComponentKeys(project)
  const counts = useAtomValue(logCountsAtom({ ...scope, by: "level" }))
  const [level, setLevel] = useState<IndexedLevel>("warn")
  const [draft, setDraft] = useState("")
  const [search, setSearch] = useState<string | undefined>(undefined)
  const lines: Lines = { ...scope, level, ...(search === undefined ? {} : { search }) }
  const newest = useAtomValue(logsAtom(lines))

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 p-4 md:p-6">
      <ProjectHeader
        title="Logs"
        latest={AsyncResult.map(newest, (page) => {
          const first = page.lines[0]
          return first === undefined ? undefined : DateTime.toEpochMillis(first.time)
        })}
      >
        <FilterSwitches
          project={project}
          components={components}
          filters={filters}
          environments={environments}
          routeOf={(next) => ({ page: "logs", project, ...next })}
        />
      </ProjectHeader>

      <Panel
        icon={CalendarClockIcon}
        title="Warnings and errors over time"
        subtitle={`${periodWords[period]}, ${component ?? "every component"}`}
        badge={AsyncResult.isSuccess(counts) ? zoneOf(counts.value) : undefined}
      >
        <Loaded result={counts}>
          {(answer) => {
            const warnings = logColumnsOf(answer, ["warn"])
            const errors = logColumnsOf(answer, ["error", "fatal"])
            const { startOf } = columnTimesOf(warnings)
            const totalOf = (keys: ReadonlyArray<string>) =>
              sumOf(answer.series.filter((series) => keys.includes(series.key)).map((series) => series.total))
            const warned = totalOf(["warn"])
            const failed = totalOf(["error", "fatal"])
            return (
              <>
                <div className="p-5">
                  <BarRows
                    rowHeight={64}
                    label="Warnings and errors logged over the period."
                    rows={[
                      { label: "Warnings", note: count(warned), color: warningColor, values: warnings.values },
                      { label: "Errors", note: count(failed), color: failureColor, values: errors.values },
                    ]}
                    ticks={ticksOf(warnings)}
                    timeOf={(span) => moment(startOf(span.first))}
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

      <Panel icon={ScrollTextIcon} title="Log lines" subtitle="Newest first; open one to see where it came from">
        <div className="flex flex-wrap items-center gap-2 border-b px-5 py-3">
          <Segmented
            label="Levels"
            options={levels.map((entry) => ({ value: entry.value, label: entry.label }))}
            value={level}
            onChange={setLevel}
          />
          {/* A search is asked when it is submitted, with Enter, not on every key. */}
          <form
            role="search"
            onSubmit={(event) => {
              event.preventDefault()
              const needle = draft.trim()
              setSearch(needle.length === 0 ? undefined : needle)
            }}
            className="flex h-9 min-w-48 flex-1 items-center gap-2 border bg-card px-3 focus-within:border-ring md:max-w-md"
          >
            <SearchIcon className="size-4 text-muted-foreground" />
            <label className="flex-1">
              <span className="sr-only">Search messages and exceptions</span>
              <input
                value={draft}
                maxLength={longestSearch}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Search messages and exceptions, then press Enter"
                className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </label>
          </form>
        </div>
        <LogPages
          key={[component ?? "", environment ?? "", release ?? "", level, search ?? "", period].join("\u0000")}
          lines={lines}
          colorOf={(of) => colorOf(of, components)}
        />
      </Panel>
    </div>
  )
}
