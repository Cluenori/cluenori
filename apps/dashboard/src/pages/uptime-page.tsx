import type { ComponentKey, ProjectKey } from "@cluenori/foundation"
import type { AlertLevel, MonitorDetail, MonitorId, MonitorState, MonitorStep } from "@cluenori/incidents"
import { AddMonitor } from "@cluenori/incidents"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { cn } from "cn"
import { DateTime, Exit, Result, Schema } from "effect"
import { AsyncResult } from "effect/reactivity"
import {
  ActivityIcon,
  ArrowLeftIcon,
  CalendarDaysIcon,
  CircleXIcon,
  PlusIcon,
  RadarIcon,
  SirenIcon,
  Trash2Icon,
} from "lucide-react"
import { useState } from "react"

import type { StripDay } from "@/incident-facts"
import {
  lastDaysOf,
  monitorBriefOf,
  monitorNameOf,
  standingWordsOf,
  statusOf,
  stripOf,
  uptimeAnswerOf,
  uptimeOf,
  urlOf,
} from "@/incident-facts"
import { failureColor } from "@/lib/colors"
import { axisTime, count, duration, moment, uptime } from "@/lib/format"
import { addMonitorAtom, monitorAtom, monitorsAtom, removeMonitorAtom, useComponentKeys } from "@/project-data"
import { colorOf, incidentActionOf } from "@/project-facts"
import { Link, navigate } from "@/router"
import type { ColumnSpan } from "@/views/bar-rows"
import { BarRows, largestOf } from "@/views/bar-rows"
import { CopyButton } from "@/views/copy-button"
import { IncidentRow } from "@/views/incident-row"
import { failureText, Loaded } from "@/views/loaded"
import { Panel, PanelStats } from "@/views/panel"
import { Segmented } from "@/views/segmented"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/views/ui/alert-dialog"
import { Button, buttonVariants } from "@/views/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/views/ui/dialog"
import { Input } from "@/views/ui/input"
import { NativeSelect, NativeSelectOption } from "@/views/ui/native-select"
import { UptimeStrip } from "@/views/uptime-strip"

const clockNow = () => DateTime.toEpochMillis(DateTime.nowUnsafe())

// How many days each monitor's strip shows on the list, and on its own page.
const listedDays = 30
const shownDays = 90

// Each status's color: red when it fails now, mint when it passes, gray before its first check.
const statusDot = { up: "bg-mint", down: "bg-failure", unchecked: "bg-muted-foreground/50" } as const
const toneDot = { failure: "bg-failure", steady: "bg-mint", quiet: "bg-muted-foreground/50" } as const

// How a monitor's alerts reach phones, in a word or two.
const levelWords = { alarm: "Alarm", timeSensitive: "Time sensitive", quiet: "Quiet" } as const

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
  const url = urlOf(monitor)
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
          <span className="font-mono text-sm wrap-anywhere">{monitorNameOf(monitor)}</span>
          <span className="flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
            <span className="flex items-center gap-2">
              <span className="size-2 shrink-0" style={{ backgroundColor: color }} />
              {monitor.component}
              {monitor.environment === undefined ? "" : `, ${monitor.environment}`}
            </span>
            <span>{levelWords[monitor.level]}</span>
            <span className={cn(status === "down" && "text-failure", status === "up" && "text-mint-ink")}>
              {standingWordsOf(state)}
            </span>
            {lastCheck?.ms !== undefined && <span>answers in {duration(lastCheck.ms)}</span>}
          </span>
        </span>
        {url !== undefined && (
          <span className="shrink-0 font-mono text-sm">
            {lasted === undefined ? <span className="text-muted-foreground">–</span> : lasted}
          </span>
        )}
      </span>
      {url !== undefined && <UptimeStrip days={days} label={stripLabel(days)} />}
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
          Each monitor is looked at every minute. A URL is fetched and passes with a status below 400 within 10 seconds;
          two failed checks in a row open an incident. Others watch an operation, error, log message or event; add those
          with Monitor this on its page.
        </p>
      </header>

      <Panel
        icon={RadarIcon}
        title="Monitors"
        subtitle={`How each is now, and its last ${listedDays} days, a cell a day`}
        action={
          <span className="flex items-center gap-2">
            <AddUrlMonitor project={project} components={components} />
            <Link to={{ page: "incidents", project }} className={buttonVariants({ variant: "outline", size: "sm" })}>
              Incidents
            </Link>
          </span>
        }
      >
        <Loaded result={monitors}>
          {(list) =>
            list.monitors.length === 0 ? (
              <p className="max-w-2xl px-5 py-5 text-[15px]">
                No monitors. Add one for each component, such as its health endpoint, with Add a monitor, or{" "}
                <span className="font-mono text-sm">
                  ./cluenori monitor add {project} {"<component>"} --url {"<url>"}
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
  // No average over the day: a step's average is of its answered checks, which the steps don't count.
  const answered = detail.recent.some((point) => point.averageMs !== undefined)
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
                note: answered ? "average, every 5 min" : "no answer",
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

/** Removing a monitor, which resolves its open incident, after asking; then every monitor shows. */
function RemoveMonitor({ project, monitor }: { readonly project: ProjectKey; readonly monitor: MonitorId }) {
  const [open, setOpen] = useState(false)
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const remove = useAtomSet(removeMonitorAtom, { mode: "promiseExit" })
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={<Button variant="ghost" size="sm" />}>
        <Trash2Icon />
        Remove
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove this monitor?</AlertDialogTitle>
          <AlertDialogDescription>
            {problem ?? "It stops being looked at, and its open incident resolves. Its past incidents stay."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <Button
            variant="destructive"
            onClick={() => {
              void remove({ project, monitor }).then((exit) => {
                if (Exit.isSuccess(exit)) {
                  setOpen(false)
                  navigate({ page: "uptime", project })
                } else {
                  setProblem(failureText(exit.cause))
                }
              })
            }}
          >
            Remove the monitor
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// A URL typed in, and the monitor, are checked by the API's own rules, so a refusal says the rule.
const decodeMonitor = Schema.decodeUnknownResult(AddMonitor)

/** Adding a monitor of a URL, in a dialog: its component, its URL, and its alerts' level. */
function AddUrlMonitor({
  project,
  components,
}: {
  readonly project: ProjectKey
  readonly components: ReadonlyArray<ComponentKey>
}) {
  const [open, setOpen] = useState(false)
  const [component, setComponent] = useState<string>("")
  const [url, setUrl] = useState("")
  const [level, setLevel] = useState<AlertLevel>("alarm")
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const add = useAtomSet(addMonitorAtom, { mode: "promiseExit" })
  const chosen = component === "" ? (components[0] ?? "") : component
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        setProblem(undefined)
      }}
    >
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <PlusIcon />
        Add a monitor
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Monitor a URL</DialogTitle>
          <DialogDescription>
            Fetched every minute; it passes with a status below 400 within 10 seconds, and two failed checks in a row
            open an incident. To watch an operation, error, log message or event, use Monitor this on its page.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault()
            const decoded = decodeMonitor({
              component: chosen,
              condition: { _tag: "noAnswer", subject: { _tag: "url", url: url.trim() } },
              level,
            })
            if (Result.isFailure(decoded)) {
              setProblem(decoded.failure.message)
              return
            }
            void add({ project, monitor: decoded.success }).then((exit) => {
              if (Exit.isSuccess(exit)) {
                setOpen(false)
                navigate({ page: "monitor", project, monitor: exit.value.id })
              } else {
                setProblem(failureText(exit.cause))
              }
            })
          }}
        >
          <div className="flex flex-col gap-1.5 text-sm">
            <span id={`${project}-monitor-component`}>Component</span>
            <NativeSelect
              aria-labelledby={`${project}-monitor-component`}
              value={chosen}
              onChange={(event) => setComponent(event.target.value)}
              className="h-9 w-full"
            >
              {components.map((key) => (
                <NativeSelectOption key={key} value={key}>
                  {key}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <label htmlFor={`${project}-monitor-url`} className="flex flex-col gap-1.5 text-sm">
            URL
            <Input
              id={`${project}-monitor-url`}
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://api.notes.app/health"
              autoComplete="off"
              spellCheck={false}
              className="h-9 font-mono"
            />
          </label>
          <Segmented
            label="Its alerts"
            options={[
              { value: "alarm", label: "Alarm" },
              { value: "timeSensitive", label: "Time sensitive" },
              { value: "quiet", label: "Quiet" },
            ]}
            value={level}
            onChange={setLevel}
          />
          {problem !== undefined && <p className="text-sm text-failure">{problem}</p>}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button type="submit">Add the monitor</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
              <h1 className="font-mono text-xl font-semibold tracking-[-0.01em] wrap-anywhere">
                {monitorNameOf(state.monitor)}
              </h1>
              <p className="flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
                <span className="flex items-center gap-2">
                  <span
                    className="size-2 shrink-0"
                    style={{ backgroundColor: colorOf(state.monitor.component, components) }}
                  />
                  {state.monitor.component}
                  {state.monitor.environment === undefined ? "" : `, ${state.monitor.environment}`}
                </span>
                <span>{levelWords[state.monitor.level]} alerts</span>
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
            <RemoveMonitor project={project} monitor={id} />
          </div>
        )}
      </header>
      <Loaded result={result}>
        {(shown) => (
          <div className="grid gap-4 xl:grid-cols-2">
            {urlOf(shown.state.monitor) !== undefined && (
              <>
                <div className="min-w-0 xl:col-span-2">
                  <RecentPanel detail={shown} now={now} />
                </div>
                <DaysPanel state={shown.state} now={now} />
              </>
            )}
            <Panel
              icon={SirenIcon}
              title="Incidents"
              subtitle={
                urlOf(shown.state.monitor) === undefined
                  ? "Its own, the latest opened first"
                  : "Of its URL, the latest opened first"
              }
            >
              {shown.incidents.length === 0 ? (
                <p className="px-5 py-5 text-sm text-muted-foreground">
                  {urlOf(shown.state.monitor) === undefined
                    ? "It never fired."
                    : "It never was down two checks in a row."}
                </p>
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
            {urlOf(shown.state.monitor) !== undefined && (
              <div className="min-w-0 xl:col-span-2">
                <FailuresPanel detail={shown} />
              </div>
            )}
          </div>
        )}
      </Loaded>
    </div>
  )
}
