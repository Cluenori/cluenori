import type { ComponentKey, ProjectKey, ReleaseVersion } from "@cluenori/foundation"
import type { IndexedLevel, LogLevel, LogLine, LogMessage, LogMessageId } from "@cluenori/signals"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { cn } from "cn"
import { DateTime } from "effect"
import { AsyncResult } from "effect/reactivity"
import {
  ArrowLeftIcon,
  BugIcon,
  CalendarClockIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ListIcon,
  ScrollTextIcon,
  SearchIcon,
} from "lucide-react"
import { useState } from "react"

import { failureColor, warningColor } from "@/lib/colors"
import { ago, count, dayOf, moment, preciseTime } from "@/lib/format"
import {
  logCountsAtom,
  logLineAtom,
  logMessageAtom,
  logMessagesAtom,
  logsAtom,
  periodAtom,
  periodMillis,
  useComponentKeys,
} from "@/project-data"
import type { Environments } from "@/project-facts"
import {
  colorOf,
  columnTimesOf,
  endOf,
  logColumnsOf,
  periodCovering,
  periodWords,
  sumOf,
  ticksOf,
  zoneOf,
} from "@/project-facts"
import type { Filters } from "@/router"
import { Link } from "@/router"
import { BarRows } from "@/views/bar-rows"
import { CopyButton } from "@/views/copy-button"
import { ErrorList } from "@/views/error-list"
import { FilterSwitches } from "@/views/filter-switches"
import { OccurrenceDetail, TracedOccurrence } from "@/views/line-detail"
import { Loaded } from "@/views/loaded"
import { Panel, PanelStats } from "@/views/panel"
import { ProjectHeader } from "@/views/project-header"
import { Segmented } from "@/views/segmented"
import { TemplateText } from "@/views/template-text"
import { Button, buttonVariants } from "@/views/ui/button"

// Which lines to count and show, as the API's lowest level: every warning and error, or errors only.
const levels = [
  { value: "warn", label: "All" },
  { value: "error", label: "Errors" },
] as const satisfies ReadonlyArray<{ readonly value: IndexedLevel; readonly label: string }>

// The longest search the API takes.
const longestSearch = 200

// How many of a message's latest lines its row shows when opened.
const linesInRow = 5

const levelWords: Readonly<Record<LogLevel, string>> = {
  trace: "Trace",
  debug: "Debug",
  info: "Info",
  warn: "Warning",
  error: "Error",
  fatal: "Fatal",
}

const isError = (level: LogLevel) => level === "error" || level === "fatal"

const levelColor: Readonly<Record<LogLevel, string>> = {
  trace: "text-muted-foreground",
  debug: "text-muted-foreground",
  info: "text-muted-foreground",
  warn: "text-yellow",
  error: "text-failure",
  fatal: "text-failure",
}

/** A line's or a message's level, as a word in its color: yellow for a warning, red for an error. */
function LevelMark({ level }: { readonly level: LogLevel }) {
  return (
    <span className={cn("w-14 shrink-0 font-mono text-xs uppercase", levelColor[level])}>
      {level === "warn" ? "warn" : level}
    </span>
  )
}

/** A message's lines over the period as a strip of small bars, one a step; a step without any has none. */
function StepBars({ values, color }: { readonly values: ReadonlyArray<number | undefined>; readonly color: string }) {
  const most = Math.max(1, ...values.map((value) => value ?? 0))
  const slot = 100 / Math.max(1, values.length)
  return (
    <svg width="100%" height="20" aria-hidden className="block border-b border-foreground/15">
      {values.map((value, step) =>
        value === undefined || value === 0 ? null : (
          <rect
            key={step}
            x={`${step * slot + slot * 0.15}%`}
            width={`${slot * 0.7}%`}
            y={20 - Math.max(2, (value / most) * 18)}
            height={Math.max(2, (value / most) * 18)}
            fill={color}
          />
        ),
      )}
    </svg>
  )
}

/** One line in a list: when, and what it said, opening its own page. */
function LineRow({ project, line }: { readonly project: ProjectKey; readonly line: LogLine }) {
  const time = DateTime.toEpochMillis(line.time)
  return (
    <Link
      to={{ page: "logLine", project, line: line.id }}
      className="grid grid-cols-[minmax(0,1fr)] items-center gap-x-4 gap-y-0.5 px-5 py-2.5 text-sm outline-none hover:bg-accent/60 focus-visible:bg-accent md:grid-cols-[9.5rem_minmax(0,1fr)_1rem]"
    >
      <span className="font-mono text-[13px] text-muted-foreground" title={dayOf(time)}>
        {moment(time)}
      </span>
      <span className="min-w-0 truncate">
        <span className={cn(line.level === "fatal" && "text-failure")}>{line.message}</span>
        <span className="text-muted-foreground">
          {" "}
          · {line.component}
          {line.release === undefined ? "" : ` ${line.release}`}
          {line.exception === undefined ? "" : ` · ${line.exception.type}`}
        </span>
      </span>
      <ChevronRightIcon className="hidden size-4 text-muted-foreground md:block" />
    </Link>
  )
}

type Lines = Filters & {
  readonly project: ProjectKey
  readonly level?: IndexedLevel
  readonly search?: string
  readonly message?: LogMessageId
}

/** A message's latest lines, opened in its row, and the way to all of them. */
function MessageLines({ lines, open }: { readonly lines: Lines; readonly open: LogMessage }) {
  const page = useAtomValue(logsAtom(lines))
  const { project, level: _, search: __, message: ___, ...filters } = lines
  return (
    <div className="border-t bg-background/60">
      <Loaded result={page}>
        {({ lines: shown }) => (
          <ul className="divide-y">
            {shown.slice(0, linesInRow).map((line) => (
              <li key={line.id}>
                <LineRow project={project} line={line} />
              </li>
            ))}
          </ul>
        )}
      </Loaded>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t px-5 py-3 text-sm text-muted-foreground">
        <Link
          to={{ page: "logMessage", project, message: open.id, ...filters }}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          {open.lines > linesInRow ? `All ${count(open.lines)} lines` : "Open the message"}
        </Link>
        <span>
          First seen <span className="font-mono">{moment(DateTime.toEpochMillis(open.firstSeen))}</span>
          {open.firstRelease === undefined ? "" : `, in ${open.firstRelease}`}
        </span>
      </div>
    </div>
  )
}

/**
 * The period's log messages, the most lines first: each a row with its level, what it says, its
 * logger, its lines over the period and how many, opening in place to its latest lines.
 */
function MessageList({
  lines,
  messages,
  now,
  stepsOf,
}: {
  readonly lines: Lines
  readonly messages: ReadonlyArray<LogMessage>
  readonly now: number
  readonly stepsOf: (message: LogMessage) => ReadonlyArray<number | undefined> | undefined
}) {
  const [opened, setOpened] = useState<LogMessageId | undefined>(undefined)
  return (
    <ul className="divide-y">
      {messages.map((message) => {
        const isOpen = opened === message.id
        const steps = stepsOf(message)
        return (
          <li key={message.id}>
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => setOpened(isOpen ? undefined : message.id)}
              className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-5 gap-y-1 px-5 py-3 text-left outline-none hover:bg-accent/60 focus-visible:bg-accent md:grid-cols-[minmax(0,1fr)_9rem_4rem_8rem_1rem]"
            >
              <span className="flex min-w-0 flex-col">
                <span className="flex min-w-0 items-center gap-2">
                  <LevelMark level={message.level} />
                  <span className="line-clamp-2 break-words md:line-clamp-1">
                    <TemplateText text={message.title} />
                  </span>
                </span>
                <span className="truncate pl-16 font-mono text-[13px] text-muted-foreground">
                  {message.category} · {message.lastComponent}
                </span>
              </span>
              <span className="hidden md:block" title="Each bar is a step of the period">
                {steps !== undefined && (
                  <StepBars values={steps} color={isError(message.level) ? failureColor : warningColor} />
                )}
              </span>
              <span className="text-right font-mono">{count(message.lines)}</span>
              <span className="hidden truncate text-right text-sm text-muted-foreground md:block">
                {ago(DateTime.toEpochMillis(message.lastSeen), now)}
              </span>
              <ChevronDownIcon
                className={cn(
                  "hidden size-4 text-muted-foreground transition-transform md:block",
                  isOpen && "rotate-180",
                )}
              />
            </button>
            {isOpen && <MessageLines lines={{ ...lines, message: message.id }} open={message} />}
          </li>
        )
      })}
    </ul>
  )
}

/**
 * A project's warnings and errors over the period, as log messages (`concept/Experience.md`, "Lists,
 * groups and items"): how many of each level over time, then every message, the most lines first,
 * searchable by what its lines say and by level; a row opens in place to its latest lines, and leads
 * to the message's page and each line's.
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
  const setPeriod = useAtomSet(periodAtom)
  const components = useComponentKeys(project)
  const [level, setLevel] = useState<IndexedLevel>("warn")
  const [draft, setDraft] = useState("")
  const [search, setSearch] = useState<string | undefined>(undefined)
  const counts = useAtomValue(logCountsAtom({ ...scope, by: "level" }))
  const byMessage = useAtomValue(logCountsAtom({ ...scope, by: "message", level }))
  const lines: Lines = { ...scope, level, ...(search === undefined ? {} : { search }) }
  const table = useAtomValue(logMessagesAtom(lines))
  const inPeriod = periodWords[period].toLowerCase()

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 p-4 md:p-6">
      <ProjectHeader
        title="Logs"
        latest={AsyncResult.map(table, (answer) => {
          const newest = Math.max(...answer.messages.map((message) => DateTime.toEpochMillis(message.lastSeen)))
          return Number.isFinite(newest) ? newest : undefined
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
                <div className="px-5 py-4">
                  <BarRows
                    rowHeight={40}
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
                    ...(AsyncResult.isSuccess(table) && search === undefined && level === "warn"
                      ? [
                          {
                            label: "Messages",
                            value: count(table.value.messages.length + table.value.unshown),
                          },
                        ]
                      : []),
                  ]}
                />
              </>
            )
          }}
        </Loaded>
      </Panel>

      <Panel
        icon={ScrollTextIcon}
        title="Messages"
        subtitle="Lines that say the same, the most first; open one to see its latest"
      >
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
              <span className="sr-only">Search what the lines say</span>
              <input
                value={draft}
                maxLength={longestSearch}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Search what the lines say, then press Enter"
                className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </label>
          </form>
        </div>
        <Loaded result={table}>
          {(answer) => {
            if (answer.messages.length === 0) {
              return (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-6">
                  <p className="text-[15px] text-muted-foreground">
                    {search === undefined
                      ? `No ${level === "error" ? "errors" : "warnings or errors"} were logged in the ${inPeriod}.`
                      : `No line in the ${inPeriod} says “${search}”.`}
                  </p>
                  {period !== "90d" && (
                    <Button variant="outline" size="sm" onClick={() => setPeriod("90d")}>
                      Look in the last 90 days
                    </Button>
                  )}
                </div>
              )
            }
            // A period with messages is kept, so it ends; its newest line stands in otherwise.
            const now =
              endOf(answer) ?? Math.max(...answer.messages.map((message) => DateTime.toEpochMillis(message.lastSeen)))
            const columns = AsyncResult.isSuccess(byMessage) ? byMessage.value : undefined
            return (
              <>
                <MessageList
                  key={[component ?? "", environment ?? "", release ?? "", level, search ?? "", period].join("\u0000")}
                  lines={lines}
                  messages={answer.messages}
                  now={now}
                  // The bars count every line of a message, so a search, which counts some, has none.
                  stepsOf={(message) =>
                    // The counts keep their own top 100, which may leave out a message shown
                    // here: its history is then unknown, not zero.
                    columns === undefined ||
                    search !== undefined ||
                    !columns.series.some((series) => series.key === `${message.id}`)
                      ? undefined
                      : logColumnsOf(columns, [`${message.id}`]).values
                  }
                />
                <p className="border-t px-5 py-3 text-sm text-muted-foreground">
                  {count(answer.lines)} {answer.lines === 1 ? "line" : "lines"} in the {inPeriod}
                  {answer.unshown > 0
                    ? `; the ${count(answer.messages.length)} messages with the most are shown, and ${count(answer.unshown)} more match. Search to narrow them.`
                    : "."}
                </p>
              </>
            )
          }}
        </Loaded>
      </Panel>
    </div>
  )
}

/**
 * Lines of one message, a page of 100 at a time, newest first; older pages continue from where the
 * one before ended.
 */
function MessageLinePages({ lines }: { readonly lines: Lines }) {
  const [older, setOlder] = useState<ReadonlyArray<number>>([])
  const pages = [undefined, ...older]
  return (
    <div className="flex flex-col">
      {pages.map((before, index) => (
        <MessageLinePage
          key={before ?? "newest"}
          lines={lines}
          before={before}
          onOlder={index === pages.length - 1 ? (next) => setOlder([...older, next]) : undefined}
        />
      ))}
    </div>
  )
}

function MessageLinePage({
  lines,
  before,
  onOlder,
}: {
  readonly lines: Lines
  readonly before: number | undefined
  readonly onOlder: ((next: number) => void) | undefined
}) {
  const page = useAtomValue(logsAtom({ ...lines, ...(before === undefined ? {} : { before }) }))
  return (
    <Loaded result={page}>
      {({ lines: shown, next }) => (
        <>
          <ul className="divide-y border-b">
            {shown.map((line) => (
              <li key={line.id}>
                <LineRow project={lines.project} line={line} />
              </li>
            ))}
          </ul>
          {next !== undefined && onOlder !== undefined && (
            <div className="px-5 py-3">
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

// What an agent needs to look into one message: what it is, and how to read its lines.
const messageBrief = (project: ProjectKey, message: LogMessage, period: string) =>
  [
    `Look into this log message in Cluenori project ${project}: ${levelWords[message.level].toLowerCase()} "${message.title}" from ${message.category}.`,
    `Message ${message.id}: ${count(message.lines)} lines in the ${period}; first seen ${DateTime.formatIso(message.firstSeen)}${message.firstRelease === undefined ? "" : ` in ${message.firstRelease}`}, last ${DateTime.formatIso(message.lastSeen)} in ${message.lastComponent}${message.lastRelease === undefined ? "" : ` ${message.lastRelease}`}.`,
    `Read its lines with ./cluenori logs ${project} --message ${message.id} --last 90d, or GET /api/projects/${project}/logs?message=${message.id}; each line by its ID with GET /api/projects/${project}/logs/lines/<ID>.`,
  ].join("\n")

/**
 * One log message over the period, a list of its lines (`concept/Experience.md`, "Lists, groups and
 * items"): what it says and where from, and when it was first and last seen, which no period
 * changes; how many lines it had over the period, or that the period holds none and when it was
 * last seen; the errors its lines are occurrences of; then its lines, newest first, each opening its
 * own page.
 */
export function LogMessagePage({
  project,
  message: id,
  component,
  release,
  environments,
}: {
  readonly project: ProjectKey
  readonly message: LogMessageId
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
  const period = useAtomValue(periodAtom)
  const setPeriod = useAtomSet(periodAtom)
  const components = useComponentKeys(project)
  const detail = useAtomValue(logMessageAtom({ project, ...filters, message: id }))
  const counts = useAtomValue(logCountsAtom({ project, ...filters, by: "level", message: id }))
  const shown = AsyncResult.isSuccess(detail) ? detail.value.message : undefined
  const inPeriod = periodWords[period].toLowerCase()

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-wrap items-start gap-x-4 gap-y-3 pb-2">
        <Link
          to={{ page: "logs", project, ...filters }}
          aria-label="Back to the logs"
          className={buttonVariants({ variant: "outline", size: "icon" })}
        >
          <ArrowLeftIcon />
        </Link>
        <div className="flex min-w-0 flex-[1_1_20rem] flex-col gap-1">
          <h1 className="line-clamp-3 text-2xl font-semibold tracking-[-0.02em] break-words">
            {shown === undefined ? "Message" : <TemplateText text={shown.title} />}
          </h1>
          {shown !== undefined && (
            <p className="text-sm break-words text-muted-foreground">
              <span className={cn(isError(shown.level) ? "text-failure" : "text-yellow")}>
                {levelWords[shown.level]}
              </span>{" "}
              from <span className="font-mono text-[13px]">{shown.category}</span>, last in {shown.lastComponent}
            </p>
          )}
        </div>
        <div className="flex max-w-full min-w-0 flex-wrap items-center gap-3">
          <FilterSwitches
            project={project}
            components={components}
            filters={filters}
            environments={environments}
            routeOf={(next) => ({ page: "logMessage", project, message: id, ...next })}
          />
          {shown !== undefined && (
            <CopyButton text={messageBrief(project, shown, inPeriod)} label="Copy for an agent" />
          )}
        </div>
      </header>

      <Loaded result={AsyncResult.all({ detail, counts })}>
        {({ detail: { message, errors }, counts: answer }) => {
          const lastSeen = DateTime.toEpochMillis(message.lastSeen)
          const now = endOf(answer) ?? lastSeen
          const color = isError(message.level) ? failureColor : warningColor
          const columns = logColumnsOf(answer, ["warn", "error", "fatal"])
          const { startOf } = columnTimesOf(columns)
          // The shortest period that holds its last line, while lines are kept.
          const holding = periodCovering(message.lastSeen, DateTime.makeUnsafe(now))
          const kept = now - lastSeen <= periodMillis["90d"]
          return (
            <div className="flex flex-col gap-4">
              <Panel
                icon={CalendarClockIcon}
                title="Lines"
                subtitle={`${count(message.lines)} in the ${inPeriod}`}
                badge={zoneOf(answer)}
              >
                {message.lines === 0 ? (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-5">
                    <p className="text-[15px]">
                      None in the {inPeriod}. Last seen {ago(lastSeen, now)}, at{" "}
                      <span className="font-mono">{moment(lastSeen)}</span>.
                    </p>
                    {kept ? (
                      <Button variant="outline" size="sm" onClick={() => setPeriod(holding)}>
                        Show the {periodWords[holding].toLowerCase()}
                      </Button>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Its lines are older than the 90 days they are kept.
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="px-5 py-4">
                    <BarRows
                      rowHeight={48}
                      label={`How often ${message.title} was logged over the period.`}
                      rows={[{ label: "Lines", note: count(message.lines), color, values: columns.values }]}
                      ticks={ticksOf(columns)}
                      timeOf={(span) => moment(startOf(span.first))}
                    />
                  </div>
                )}
                <PanelStats
                  stats={[
                    {
                      label: "In the period",
                      value: count(message.lines),
                      ...(message.lines > 0 ? { color } : {}),
                    },
                    {
                      label: "First seen",
                      value: `${ago(DateTime.toEpochMillis(message.firstSeen), now)}${message.firstRelease === undefined ? "" : `, ${message.firstRelease}`}`,
                    },
                    {
                      label: "Last seen",
                      value: `${ago(lastSeen, now)}${message.lastRelease === undefined ? "" : `, ${message.lastRelease}`}`,
                    },
                  ]}
                />
              </Panel>

              {errors.length > 0 && (
                <Panel
                  icon={BugIcon}
                  title="Errors"
                  subtitle={`Its lines are occurrences of ${errors.length === 1 ? "this error" : `these ${count(errors.length)} errors`}`}
                >
                  <ErrorList
                    groups={errors}
                    now={now}
                    colorOf={(of) => colorOf(of, components)}
                    stepsOf={() => undefined}
                    linkOf={(group) => ({ page: "error", project, error: group.id, ...filters })}
                  />
                </Panel>
              )}

              {message.lines > 0 && (
                <Panel icon={ListIcon} title="Latest lines" subtitle="The newest first; open one to see it whole">
                  <MessageLinePages
                    key={[component ?? "", environment ?? "", release ?? "", period].join("\u0000")}
                    lines={{ project, ...filters, message: id }}
                  />
                </Panel>
              )}
            </div>
          )
        }}
      </Loaded>
    </div>
  )
}

// What an agent needs to look into one line: where it is, and how to read it, its message and its trace.
const lineBrief = (project: ProjectKey, line: LogLine) =>
  [
    `Look into this ${levelWords[line.level].toLowerCase()} in Cluenori project ${project}.`,
    `Log line ${line.id}, at ${DateTime.formatIso(line.time)}, in ${line.component}${line.release === undefined ? "" : ` ${line.release}`}${line.environment === undefined ? "" : ` (${line.environment})`}, from ${line.category}.`,
    line.exception === undefined ? line.message : `${line.message}\n${line.exception.type}: ${line.exception.message}`,
    `Read it with the API: GET /api/projects/${project}/logs/lines/${line.id}` +
      `; the other lines of its message with ./cluenori logs ${project} --message ${line.messageId} --last 90d` +
      (line.error === undefined ? "" : `; its error with ./cluenori error ${project} ${line.error}`) +
      (line.trace === undefined ? "." : `; its trace with ./cluenori trace ${project} ${line.trace}.`),
  ].join("\n")

/**
 * One log line, by its ID: the whole of it, with no period or filter, since it is one thing
 * (`concept/Experience.md`): when and where it was logged, what it said and its exception, beside the
 * operation it was logged in, and everything it was sent with; one click to its message, and to its
 * error when it is an occurrence of one.
 */
export function LogLinePage({ project, line: id }: { readonly project: ProjectKey; readonly line: number }) {
  const result = useAtomValue(logLineAtom({ project, line: id }))
  const line = AsyncResult.isSuccess(result) ? result.value : undefined
  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-wrap items-start gap-x-4 gap-y-3 pb-2">
        <Link
          to={line === undefined ? { page: "logs", project } : { page: "logMessage", project, message: line.messageId }}
          aria-label="Back to its message"
          className={buttonVariants({ variant: "outline", size: "icon" })}
        >
          <ArrowLeftIcon />
        </Link>
        <div className="flex min-w-0 flex-[1_1_20rem] flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-[-0.02em] break-words">
            {line === undefined ? "Log line" : levelWords[line.level]}
          </h1>
          {line !== undefined && (
            <>
              <p className="line-clamp-3 text-[15px] break-words">{line.message}</p>
              <p className="text-sm break-words text-muted-foreground">
                {dayOf(DateTime.toEpochMillis(line.time))},{" "}
                <span className="font-mono">{preciseTime(DateTime.toEpochMillis(line.time))}</span> · {line.component}
                {line.release !== undefined && (
                  <>
                    {" "}
                    <Link
                      to={{
                        page: "release",
                        project,
                        component: line.component,
                        release: line.release,
                        ...(line.environment === undefined ? {} : { environment: line.environment }),
                      }}
                      aria-label={`Release ${line.release}`}
                      className="font-mono underline-offset-4 hover:underline"
                    >
                      {line.release}
                    </Link>
                  </>
                )}
                {line.environment === undefined ? "" : `, ${line.environment}`}
              </p>
            </>
          )}
        </div>
        {line !== undefined && (
          <div className="flex max-w-full min-w-0 flex-wrap items-center gap-3">
            <Link
              to={{ page: "logMessage", project, message: line.messageId }}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Every line of its message
            </Link>
            {line.error !== undefined && (
              <Link
                to={{ page: "occurrence", project, error: line.error, line: line.id }}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                Its error
              </Link>
            )}
            <CopyButton text={lineBrief(project, line)} label="Copy for an agent" />
          </div>
        )}
      </header>
      <Loaded result={result}>
        {(shown) => {
          const traceFilters = {
            ...(shown.environment === undefined ? {} : { environment: shown.environment }),
            ...(shown.release === undefined ? {} : { release: shown.release }),
          }
          return shown.trace === undefined ? (
            <div className="flex flex-col gap-4">
              <OccurrenceDetail project={project} traceFilters={traceFilters} line={shown} operation={undefined} />
            </div>
          ) : (
            <TracedOccurrence project={project} traceFilters={traceFilters} line={shown} trace={shown.trace} />
          )
        }}
      </Loaded>
    </div>
  )
}
