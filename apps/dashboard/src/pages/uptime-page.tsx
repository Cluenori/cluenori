import type { ProjectKey } from "@cluenori/foundation"
import type { MonitorDetail, MonitorId, MonitorState, MonitorStep } from "@cluenori/incidents"
import { useAtomValue } from "@effect/atom-react"
import { cn } from "cn"
import { DateTime } from "effect"
import { AsyncResult } from "effect/reactivity"
import { ActivityIcon, ArrowLeftIcon, CalendarDaysIcon, CircleXIcon, RadarIcon, SirenIcon } from "lucide-react"
import { useState } from "react"

import type { StripDay } from "@/incident-facts"
import {
  lastDaysOf,
  monitorBriefOf,
  standingWordsOf,
  statusOf,
  stripOf,
  uptimeAnswerOf,
  uptimeOf,
} from "@/incident-facts"
import { failureColor } from "@/lib/colors"
import { axisTime, count, duration, moment, uptime } from "@/lib/format"
import { monitorAtom, monitorsAtom, useComponentKeys } from "@/project-data"
import { colorOf, incidentActionOf } from "@/project-facts"
import { Link } from "@/router"
import type { ColumnSpan } from "@/views/bar-rows"
import { BarRows, largestOf } from "@/views/bar-rows"
import { CopyButton } from "@/views/copy-button"
import { IncidentRow } from "@/views/incident-row"
import { Loaded } from "@/views/loaded"
import { Panel, PanelStats } from "@/views/panel"
import { buttonVariants } from "@/views/ui/button"
import { UptimeStrip } from "@/views/uptime-strip"

const clockNow = () => DateTime.toEpochMillis(DateTime.nowUnsafe())

// How many days each monitor's strip shows on the list, and on its own page.
const listedDays = 30
const shownDays = 90

// Each status's color: red when it fails now, mint when it passes, gray before its first check.
const statusDot = { up: "bg-mint", down: "bg-failure", unchecked: "bg-muted-foreground/50" } as const
const toneDot = { failure: "bg-failure", steady: "bg-mint", quiet: "bg-muted-foreground/50" } as const

// The strip's sentence, for screen readers: "Last 30 days: 99.86% up, 1 day with failed checks".
const stripLabel = (days: ReadonlyArray<StripDay>) => {
  const checked = days.filter((day) => day.checks > 0)
  const failing = checked.filter((day) => day.failed > 0).length
  const checks = checked.reduce((sum, day) => sum + day.checks, 0)
  const failed = checked.reduce((sum, day) => sum + day.failed, 0)
  return checks === 0
    ? `Last ${count(days.length)} days: not checked`
    : `Last ${count(days.length)} days: ${uptime(checks - failed, checks)} up, ${count(failing)} ${failing === 1 ? "day" : "days"} with failed checks`
}

/** One monitor as a row of Uptime: how it is now and since when, its last 30 days, and its uptime. */
function MonitorRow({
  project,
  state,
  color,
  now,
}: {
  readonly project: ProjectKey
  readonly state: MonitorState
  readonly color: string
  readonly now: number
}) {
  const { monitor, lastCheck } = state
  const days = stripOf(state, now, listedDays)
  const lasted = uptimeOf(lastDaysOf(state, now, listedDays))
  const status = statusOf(state)
  return (
    <Link
      to={{ page: "monitor", project, monitor: monitor.id }}
      className="flex flex-col gap-3 px-5 py-4 outline-none hover:bg-accent/60 focus-visible:bg-accent/60"
    >
      <span className="flex min-w-0 items-center gap-4">
        <span className={cn("size-2 shrink-0", statusDot[status])} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="font-mono text-sm wrap-anywhere">{monitor.url}</span>
          <span className="flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
            <span className="flex items-center gap-2">
              <span className="size-2 shrink-0" style={{ backgroundColor: color }} />
              {monitor.component}
            </span>
            <span className={cn(status === "down" && "text-failure", status === "up" && "text-mint-ink")}>
              {standingWordsOf(state)}
            </span>
            {lastCheck?.ms !== undefined && <span>answers in {duration(lastCheck.ms)}</span>}
          </span>
        </span>
        <span className="shrink-0 font-mono text-sm">
          {lasted === undefined ? <span className="text-muted-foreground">–</span> : lasted}
        </span>
      </span>
      <UptimeStrip days={days} label={stripLabel(days)} />
    </Link>
  )
}

/**
 * Uptime, every monitor of a project, a list (`concept/Experience.md`): first whether every monitor
 * is up; then each, with how it is now and since when, its last 30 days, a cell each, and its uptime
 * over them, each opening its own page. Without monitors, how to add one.
 */
export function UptimePage({ project }: { readonly project: ProjectKey }) {
  const monitors = useAtomValue(monitorsAtom(project))
  const components = useComponentKeys(project)
  const [now] = useState(clockNow)
  const answer = AsyncResult.isSuccess(monitors) ? uptimeAnswerOf(monitors.value.monitors) : undefined
  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-col gap-1 pb-2">
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">Uptime</h1>
        {answer !== undefined && (
          <p className="flex items-center gap-2.5 text-[17px]">
            <span className={cn("size-2.5 shrink-0", toneDot[answer.tone])} />
            {answer.words}
          </p>
        )}
        <p className="text-sm text-muted-foreground">
          Each monitor is fetched every minute, and passes with a status below 400 within 10 seconds. Two failed checks
          in a row open an incident.
        </p>
      </header>

      <Panel
        icon={RadarIcon}
        title="Monitors"
        subtitle={`How each is now, and its last ${listedDays} days, a cell a day`}
        action={
          <Link to={{ page: "incidents", project }} className={buttonVariants({ variant: "outline", size: "sm" })}>
            Incidents
          </Link>
        }
      >
        <Loaded result={monitors}>
          {(list) =>
            list.monitors.length === 0 ? (
              <p className="max-w-2xl px-5 py-5 text-[15px]">
                No monitors. Add one for each component, such as its health endpoint:{" "}
                <span className="font-mono text-sm">
                  ./cluenori monitor add {project} {"<component>"} {"<url>"}
                </span>
              </p>
            ) : (
              <ul className="divide-y">
                {list.monitors.map((state) => (
                  <li key={state.monitor.id}>
                    <MonitorRow
                      project={project}
                      state={state}
                      color={colorOf(state.monitor.component, components)}
                      now={now}
                    />
                  </li>
                ))}
              </ul>
            )
          }
        </Loaded>
      </Panel>
    </div>
  )
}

// The last 24 hours as five-minute columns, from the first step after `now` a day ago: a step
// without checks is undefined, unknown, never 0.
const recentColumnsOf = (recent: ReadonlyArray<MonitorStep>, now: number) => {
  const step = 5 * 60_000
  const from = Math.floor((now - 86_400_000) / step) * step + step
  const byStart = new Map(recent.map((point) => [DateTime.toEpochMillis(point.start), point] as const))
  const starts = Array.from({ length: 288 }, (_, index) => from + index * step)
  return { from, step, points: starts.map((start) => byStart.get(start)) }
}

/** A monitor's last 24 hours: how long its answers took, and its failed checks, every five minutes. */
function RecentPanel({ detail, now }: { readonly detail: MonitorDetail; readonly now: number }) {
  const { from, step, points } = recentColumnsOf(detail.recent, now)
  const checks = detail.recent.reduce((sum, point) => sum + point.checks, 0)
  const failed = detail.recent.reduce((sum, point) => sum + point.failed, 0)
  const slowest = largestOf(detail.recent.map((point) => point.slowestMs))
  const answered = detail.recent.filter((point) => point.averageMs !== undefined)
  const average =
    answered.length === 0
      ? undefined
      : answered.reduce((sum, point) => sum + (point.averageMs ?? 0) * point.checks, 0) /
        answered.reduce((sum, point) => sum + point.checks, 0)
  const ticks = [0, 72, 144, 216].map((column) => ({ column, label: axisTime(from + column * step) }))
  const timeOf = (span: ColumnSpan) =>
    `${axisTime(from + span.first * step)}–${axisTime(from + (span.last + 1) * step)}`
  return (
    <Panel
      icon={ActivityIcon}
      title="Last 24 hours"
      subtitle="Its answers, every five minutes; hatched where it wasn't checked"
    >
      {checks === 0 ? (
        <p className="px-5 py-5 text-sm text-muted-foreground">Not checked in the last 24 hours.</p>
      ) : (
        <div className="flex flex-col gap-4 px-5 py-4">
          <BarRows
            rowHeight={56}
            label="How long the monitor's answers took on average, every five minutes over the last 24 hours."
            rows={[
              {
                label: "Answer time",
                note: average === undefined ? "no answer" : `${duration(average)} average`,
                color: "var(--mint)",
                values: points.map((point) => point?.averageMs),
              },
            ]}
            format={duration}
            combine={largestOf}
            ticks={ticks}
            timeOf={timeOf}
          />
          {failed > 0 && (
            <BarRows
              rowHeight={40}
              label="How many of the monitor's checks failed, every five minutes over the last 24 hours."
              rows={[
                {
                  label: "Failed",
                  note: count(failed),
                  color: failureColor,
                  values: points.map((point) => point?.failed),
                },
              ]}
              ticks={ticks}
              timeOf={timeOf}
            />
          )}
        </div>
      )}
      <PanelStats
        stats={[
          { label: "Up", value: checks === 0 ? "–" : uptime(checks - failed, checks) },
          { label: "Checks", value: count(checks) },
          { label: "Failed", value: count(failed), ...(failed > 0 ? { color: failureColor } : {}) },
          { label: "Slowest", value: slowest === undefined ? "–" : duration(slowest) },
        ]}
      />
    </Panel>
  )
}

/** A monitor's last 90 days, a cell each, and its uptime over the last 7, 30 and 90. */
function DaysPanel({ state, now }: { readonly state: MonitorState; readonly now: number }) {
  const days = stripOf(state, now, shownDays)
  const over = (span: number) => uptimeOf(lastDaysOf(state, now, span)) ?? "–"
  return (
    <Panel icon={CalendarDaysIcon} title="Last 90 days" subtitle="A cell a UTC day; point at one for its checks">
      <div className="px-5 py-5">
        <UptimeStrip days={days} label={stripLabel(days)} className="h-10" />
        <div className="mt-2 flex justify-between font-mono text-xs text-muted-foreground">
          <span>{days[0]?.day}</span>
          <span>{days.at(-1)?.day}</span>
        </div>
      </div>
      <PanelStats
        stats={[
          { label: "Last 7 days", value: over(7) },
          { label: "Last 30 days", value: over(30) },
          { label: "Last 90 days", value: over(90) },
        ]}
      />
    </Panel>
  )
}

/** A monitor's latest failed checks: when, what was wrong, and how long it took to say so. */
function FailuresPanel({ detail }: { readonly detail: MonitorDetail }) {
  return (
    <Panel icon={CircleXIcon} title="Failed checks" subtitle="The latest first, of the 7 days every check is kept">
      {detail.failures.length === 0 ? (
        <p className="px-5 py-5 text-sm text-muted-foreground">No check failed in the last 7 days.</p>
      ) : (
        <ul className="divide-y">
          {detail.failures.map((check) => (
            <li key={DateTime.toEpochMillis(check.at)} className="flex flex-wrap items-baseline gap-x-4 px-5 py-3">
              <span className="w-32 shrink-0 font-mono text-sm text-muted-foreground">
                {moment(DateTime.toEpochMillis(check.at))}
              </span>
              <span className="text-[15px] text-failure">{check.problem}</span>
              {check.ms !== undefined && <span className="text-sm text-muted-foreground">in {duration(check.ms)}</span>}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

/**
 * One monitor, by its ID, an item (`concept/Experience.md`): no period, its whole history. How it is
 * now and since when first; then its last 24 hours by five minutes, its last 90 days, its failed
 * checks, and its incidents, each opening its own page; and a brief to copy for an agent.
 */
export function MonitorPage({ project, monitor: id }: { readonly project: ProjectKey; readonly monitor: MonitorId }) {
  const result = useAtomValue(monitorAtom({ project, monitor: id }))
  const components = useComponentKeys(project)
  const [now] = useState(clockNow)
  const detail = AsyncResult.isSuccess(result) ? result.value : undefined
  const state = detail?.state
  const status = state === undefined ? undefined : statusOf(state)
  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-wrap items-start gap-x-4 gap-y-3 pb-2">
        <Link
          to={{ page: "uptime", project }}
          aria-label="Back to every monitor"
          className={buttonVariants({ variant: "outline", size: "icon" })}
        >
          <ArrowLeftIcon />
        </Link>
        <div className="flex min-w-0 flex-[1_1_20rem] flex-col gap-1">
          {state === undefined ? (
            <h1 className="text-2xl font-semibold tracking-[-0.02em]">Monitor</h1>
          ) : (
            <>
              <p
                className={cn(
                  "flex items-center gap-2 text-sm font-medium",
                  status === "down" && "text-failure",
                  status === "up" && "text-mint-ink",
                  status === "unchecked" && "text-muted-foreground",
                )}
              >
                <span className={cn("size-2 shrink-0", statusDot[status ?? "unchecked"])} />
                {standingWordsOf(state)}
              </p>
              <h1 className="font-mono text-xl font-semibold tracking-[-0.01em] wrap-anywhere">{state.monitor.url}</h1>
              <p className="flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
                <span className="flex items-center gap-2">
                  <span
                    className="size-2 shrink-0"
                    style={{ backgroundColor: colorOf(state.monitor.component, components) }}
                  />
                  {state.monitor.component}
                </span>
                <span>Watched since {moment(DateTime.toEpochMillis(state.monitor.addedAt))}</span>
                {state.lastCheck !== undefined && (
                  <span>
                    Last checked {moment(DateTime.toEpochMillis(state.lastCheck.at))}
                    {state.lastCheck.status === undefined ? "" : `, HTTP ${state.lastCheck.status}`}
                    {state.lastCheck.ms === undefined ? "" : ` in ${duration(state.lastCheck.ms)}`}
                  </span>
                )}
              </p>
            </>
          )}
        </div>
        {detail !== undefined && (
          <div className="flex max-w-full min-w-0 flex-wrap items-center gap-3">
            <CopyButton text={monitorBriefOf(project, detail, now)} label="Copy for an agent" />
          </div>
        )}
      </header>
      <Loaded result={result}>
        {(shown) => (
          <div className="grid gap-4 xl:grid-cols-2">
            <div className="min-w-0 xl:col-span-2">
              <RecentPanel detail={shown} now={now} />
            </div>
            <DaysPanel state={shown.state} now={now} />
            <Panel icon={SirenIcon} title="Incidents" subtitle="Of its URL, the latest opened first">
              {shown.incidents.length === 0 ? (
                <p className="px-5 py-5 text-sm text-muted-foreground">It never was down two checks in a row.</p>
              ) : (
                <ul className="divide-y">
                  {shown.incidents.map((incident) => (
                    <li key={incident.id}>
                      <IncidentRow incident={incident} now={now} to={incidentActionOf(project, incident).to} />
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            <div className="min-w-0 xl:col-span-2">
              <FailuresPanel detail={shown} />
            </div>
          </div>
        )}
      </Loaded>
    </div>
  )
}
