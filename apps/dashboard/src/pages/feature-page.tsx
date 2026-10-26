import type { FeatureStory } from "@cluenori/analytics"
import type { EnvironmentKey, FeatureKey, ProjectKey } from "@cluenori/foundation"
import type { FeatureOperationDay } from "@cluenori/signals"
import { useAtomValue } from "@effect/atom-react"
import { DateTime } from "effect"
import { AsyncResult } from "effect/reactivity"
import {
  ArrowLeftIcon,
  BugIcon,
  CalendarRangeIcon,
  ServerIcon,
  ShapesIcon,
  TagIcon,
  UsersRoundIcon,
} from "lucide-react"

import type { StoryColumns } from "@/app-facts"
import { changeOf, dayTicksOf, daySpanText, lastDaysSum, storyColumnsOf } from "@/app-facts"
import { useAppEnvironments } from "@/hooks/use-app-environments"
import { calendarDayText, count, share } from "@/lib/format"
import { featureAtom, useComponentKeys } from "@/project-data"
import type { Environments } from "@/project-facts"
import { colorOf } from "@/project-facts"
import { Link } from "@/router"
import type { BarRow } from "@/views/bar-rows"
import { BarRows } from "@/views/bar-rows"
import { CopyButton } from "@/views/copy-button"
import { EnvironmentSwitch } from "@/views/environment-switch"
import { titleParts } from "@/views/error-group"
import { Loaded } from "@/views/loaded"
import { OperationName } from "@/views/operation-name"
import { Panel } from "@/views/panel"
import { TrendWords } from "@/views/trend-words"
import { buttonVariants } from "@/views/ui/button"

const page = "mx-auto flex w-full max-w-[1500px] flex-col gap-4 p-4 md:p-6"

/**
 * One feature, as an item: the story of its use over everything kept of it, with no period
 * (`concept/Experience.md`). First the answer: its people, yesterday's against a week before, and
 * the last 7 days' events and errors; then each day of its life, its people, events, operations,
 * warnings and errors on one time axis; who used it last and the releases it was used in; its
 * errors and the operations that ran for it, each opening its own page; and a brief to copy for an
 * agent. It shows one environment, as the analytics pages do. What no service named shows as a line
 * saying how they would, not as empty panels.
 */
export function FeaturePage({
  project,
  feature,
  named,
}: {
  readonly project: ProjectKey
  readonly feature: FeatureKey
  /** The environment the address names, if any. */
  readonly named?: EnvironmentKey
}) {
  const environments = useAppEnvironments(project, undefined, named)
  return environments === undefined ? (
    <div className="p-8 text-sm text-muted-foreground">Opening the page…</div>
  ) : (
    <Feature project={project} feature={feature} environments={environments} />
  )
}

function Feature({
  project,
  feature,
  environments,
}: {
  readonly project: ProjectKey
  readonly feature: FeatureKey
  readonly environments: Environments
}) {
  const environment = environments.shown
  const inEnvironment = environment === undefined ? {} : { environment }
  const result = useAtomValue(featureAtom({ project, feature, ...inEnvironment }))
  const story = AsyncResult.isSuccess(result) ? result.value : undefined
  return (
    <div className={page}>
      <header className="flex flex-wrap items-start gap-x-4 gap-y-3 pb-2">
        <Link
          to={{ page: "features", project, ...inEnvironment }}
          aria-label="Back to every feature"
          className={buttonVariants({ variant: "outline", size: "icon", className: "mt-0.5" })}
        >
          <ArrowLeftIcon />
        </Link>
        <div className="flex min-w-0 flex-[1_1_16rem] flex-col">
          <h1 className="font-mono text-2xl font-semibold tracking-[-0.02em] wrap-anywhere">{feature}</h1>
          <p className="text-sm text-muted-foreground">{story === undefined ? "A feature" : lifeWords(story)}</p>
        </div>
        <div className="ml-auto flex max-w-full min-w-0 flex-wrap items-center gap-3">
          <EnvironmentSwitch
            project={project}
            environments={environments}
            routeOf={(picked) => ({ page: "feature", project, feature, environment: picked })}
          />
          {story !== undefined && (
            <CopyButton text={agentBrief(project, environment, story)} label="Copy for an agent" />
          )}
        </div>
      </header>
      {AsyncResult.isFailure(result) ? (
        <Panel icon={ShapesIcon} title="No story to tell" subtitle={`For the feature ${feature}`}>
          <Loaded result={result}>{() => null}</Loaded>
          <div className="px-5 pb-5">
            <Link
              to={{ page: "features", project, ...inEnvironment }}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Every feature
            </Link>
          </div>
        </Panel>
      ) : (
        <Loaded result={result}>
          {(shown) => <Story project={project} environment={environment} story={shown} />}
        </Loaded>
      )}
    </div>
  )
}

// When it was first and last used, or named by a service, as the heading's second line says it.
const lifeWords = (story: FeatureStory) => {
  const used = story.use.days
  const first = used[0]?.day
  const last = used.at(-1)?.day
  if (first === undefined || last === undefined) {
    return "A feature only its services name: no app marked it in 15 months"
  }
  return first === last
    ? `A feature, used on ${calendarDayText(first)}`
    : `A feature, used from ${calendarDayText(first)} to ${calendarDayText(last)}`
}

function Story({
  project,
  environment,
  story,
}: {
  readonly project: ProjectKey
  readonly environment: EnvironmentKey | undefined
  readonly story: FeatureStory
}) {
  const keys = useComponentKeys(project)
  const columns = storyColumnsOf(story)
  const inEnvironment = environment === undefined ? {} : { environment }
  const used = story.use.days.length > 0
  const named = columns.operations !== undefined || columns.warnings !== undefined
  return (
    <div className="flex flex-col gap-4">
      <Answer story={story} columns={columns} />
      <Panel
        icon={CalendarRangeIcon}
        title="Each day"
        subtitle={`Every UTC day of its life, ${calendarDayText(columns.days[0] ?? story.feature)} to today`}
        badge="UTC"
      >
        <div className="p-5">
          <BarRows
            rowHeight={48}
            label={`${story.feature} each UTC day: people, events, operations, warnings and errors.`}
            rows={storyRowsOf(columns, used)}
            ticks={dayTicksOf({ days: columns.days, values: columns.people })}
            timeOf={(span) => daySpanText({ days: columns.days, values: columns.people }, span)}
          />
        </div>
        {!named && (
          <p className="border-t px-5 py-3 text-sm text-muted-foreground">
            No service named this feature, so its operations, warnings and errors aren&apos;t here. A service names it
            in the <span className="font-mono">cluenori.feature</span> attribute of its spans and logs, which the
            Cluenori helpers copy from the app&apos;s requests.
          </p>
        )}
      </Panel>
      {used && (
        <div className="grid items-start gap-4 xl:grid-cols-2">
          <People project={project} story={story} />
          <Releases project={project} story={story} colorOf={(of) => colorOf(of, keys)} />
        </div>
      )}
      {named && (
        <div className="grid items-start gap-4 xl:grid-cols-2">
          <Errors project={project} story={story} inEnvironment={inEnvironment} />
          <Operations project={project} story={story} inEnvironment={inEnvironment} />
        </div>
      )}
    </div>
  )
}

// The chart's rows: use where apps marked it, then what services sent, each in its meaning's color.
const storyRowsOf = (columns: StoryColumns, used: boolean): ReadonlyArray<BarRow> => [
  ...(used
    ? [
        { label: "People", color: "var(--purple)", values: columns.people },
        { label: "Events", color: "var(--purple)", values: columns.events },
      ]
    : []),
  ...(columns.operations === undefined
    ? []
    : [{ label: "Operations", color: "var(--sky)", values: columns.operations }]),
  ...(columns.failed === undefined ? [] : [{ label: "Failed", color: "var(--failure)", values: columns.failed }]),
  ...(columns.warnings === undefined ? [] : [{ label: "Warnings", color: "var(--yellow)", values: columns.warnings }]),
  ...(columns.errors === undefined ? [] : [{ label: "Errors", color: "var(--pink)", values: columns.errors }]),
]

// One of the answer's numbers: what it counts, its value, and under it a note or its trend.
type Stat = {
  readonly label: string
  readonly value: string
  readonly note: string
  /** Against a week before; shown instead of the note when given. */
  readonly trend?: number | undefined
  readonly failing?: boolean
}

/** The few numbers that answer how the feature is doing, before the evidence. */
function Answer({ story, columns }: { readonly story: FeatureStory; readonly columns: StoryColumns }) {
  // The latest whole UTC day is the one before today's, against the same a week before.
  const yesterday = columns.people.at(-2)
  const weekBefore = columns.people.at(-9)
  const moved =
    yesterday === undefined || story.use.days.length === 0
      ? undefined
      : changeOf({ value: yesterday, weekBefore, columns: { days: [], values: [] } })
  const errors = columns.errors === undefined ? undefined : lastDaysSum(columns.errors, 7)
  const failed = columns.failed === undefined ? undefined : lastDaysSum(columns.failed, 7)
  const stats: ReadonlyArray<Stat> = [
    ...(story.use.days.length === 0
      ? []
      : [
          { label: "People", value: count(story.use.people), note: "Everyone in the 15 months kept" },
          {
            label: "Yesterday",
            value: yesterday === undefined ? "—" : count(yesterday),
            trend: moved,
            note: "People on the latest whole UTC day",
          },
          {
            label: "Events, 7 days",
            value: count(lastDaysSum(columns.events, 7) ?? 0),
            note: "Today's so far included",
          },
        ]),
    ...(columns.operations === undefined
      ? []
      : [
          {
            label: "Operations, 7 days",
            value: count(lastDaysSum(columns.operations, 7) ?? 0),
            note: failed === undefined || failed === 0 ? "None failed" : `${count(failed)} failed`,
            failing: failed !== undefined && failed > 0,
          },
        ]),
    ...(columns.errors === undefined
      ? []
      : [
          {
            label: "Errors, 7 days",
            value: errors === undefined ? "—" : count(errors),
            note: `${count(lastDaysSum(columns.warnings ?? [], 7) ?? 0)} warnings`,
            failing: errors !== undefined && errors > 0,
          },
        ]),
  ]
  return (
    <section aria-label="How it is doing" className="border bg-card">
      <dl className="grid divide-y sm:auto-cols-fr sm:grid-flow-col sm:divide-x sm:divide-y-0">
        {stats.map((stat) => (
          <div key={stat.label} className="flex min-w-0 flex-col gap-1 px-5 pt-4 pb-3.5">
            <dt className="truncate text-sm text-muted-foreground">{stat.label}</dt>
            <dd className={stat.failing === true ? "font-mono text-4xl text-failure" : "font-mono text-4xl"}>
              {stat.value}
            </dd>
            <dd className="text-sm">
              {"trend" in stat ? (
                <TrendWords moved={stat.trend} unknown="Not counted a week before" />
              ) : (
                <span className="text-muted-foreground">{stat.note}</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

/** The people who used it last, the latest first, each opening their own page. */
function People({ project, story }: { readonly project: ProjectKey; readonly story: FeatureStory }) {
  const shown = story.use.latestPeople
  return (
    <Panel
      icon={UsersRoundIcon}
      title="Who uses it"
      subtitle={`The ${count(shown.length)} who used it last, of ${count(story.use.people)}`}
    >
      <ul className="divide-y">
        {shown.map((person) => (
          <li key={person.person}>
            <Link
              to={{ page: "person", project, person: person.person }}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 px-5 py-2.5 text-[15px] hover:bg-muted/40"
            >
              <span className="flex min-w-0 flex-col">
                <span className={person.users.length === 0 ? "truncate text-muted-foreground" : "truncate font-mono"}>
                  {person.users[0] ?? "Without a user ID"}
                </span>
                <span className="text-sm text-muted-foreground">
                  {count(person.days)} {person.days === 1 ? "day" : "days"}, {count(person.events)}{" "}
                  {person.events === 1 ? "event" : "events"}
                </span>
              </span>
              <span className="text-right text-sm text-muted-foreground">
                last on <span className="font-mono">{calendarDayText(person.lastDay)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

/** The releases it was used in, the latest first used first, with their people's share. */
function Releases({
  project,
  story,
  colorOf: colorOfComponent,
}: {
  readonly project: ProjectKey
  readonly story: FeatureStory
  readonly colorOf: (component: string) => string
}) {
  const releases = story.use.releases
  return (
    <Panel icon={TagIcon} title="Releases" subtitle="Each release it was used in, the latest first used first">
      <ul className="divide-y">
        {releases.map((each) => (
          <li key={`${each.component} ${each.environment} ${each.release}`}>
            <Link
              to={{
                page: "appRelease",
                project,
                component: each.component,
                release: each.release,
                environment: each.environment,
              }}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 px-5 py-2.5 text-[15px] hover:bg-muted/40"
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-mono">{each.release}</span>
                <span className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
                  <span
                    aria-hidden
                    className="size-2 shrink-0"
                    style={{ backgroundColor: colorOfComponent(each.component) }}
                  />
                  <span className="truncate">
                    {each.component}, {each.environment}, from {calendarDayText(each.firstDay)}
                  </span>
                </span>
              </span>
              <span className="text-right font-mono">
                {count(each.people)}
                <span className="block text-sm text-muted-foreground">{share(each.people, story.use.people)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

/** Its services' errors over the 90 days kept, the most frequent first, each opening its page. */
function Errors({
  project,
  story,
  inEnvironment,
}: {
  readonly project: ProjectKey
  readonly story: FeatureStory
  readonly inEnvironment: { readonly environment?: EnvironmentKey }
}) {
  const errors = story.logs.errors
  return (
    <Panel icon={BugIcon} title="Errors" subtitle="Its services' errors in the 90 days kept, the most frequent first">
      {errors.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted-foreground">
          {story.logs.days.length === 0 ? "No service sent a warning or error for it." : "Warnings only, no error."}
        </p>
      ) : (
        <ul className="divide-y">
          {errors.map((error) => {
            const { type, message } = titleParts(error)
            return (
              <li key={error.id}>
                <Link
                  to={{ page: "error", project, error: error.id, ...inEnvironment }}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 px-5 py-2.5 text-[15px] hover:bg-muted/40"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">
                      <span className="font-medium">{type}</span>
                      {message !== undefined && <span className="text-muted-foreground"> {message}</span>}
                    </span>
                    <span className="truncate font-mono text-sm text-muted-foreground">{error.culprit}</span>
                  </span>
                  <span className="text-right font-mono text-failure">{count(error.occurrences)}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}

/** The operations that ran for it, by component and name, over every day kept, the most first. */
function Operations({
  project,
  story,
  inEnvironment,
}: {
  readonly project: ProjectKey
  readonly story: FeatureStory
  readonly inEnvironment: { readonly environment?: EnvironmentKey }
}) {
  const totals = new Map<string, { readonly of: FeatureOperationDay; count: number; errors: number }>()
  for (const each of story.operations) {
    const key = `${each.component}\u0000${each.operation}`
    const total = totals.get(key) ?? { of: each, count: 0, errors: 0 }
    total.count += each.count
    total.errors += each.errors
    totals.set(key, total)
  }
  const rows = [...totals.values()].toSorted((left, right) => right.count - left.count)
  return (
    <Panel icon={ServerIcon} title="Operations" subtitle="What its services ran for it, every day kept, the most first">
      {rows.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted-foreground">No service ran an operation for it.</p>
      ) : (
        <ul className="divide-y">
          {rows.map((row) => (
            <li key={`${row.of.component} ${row.of.operation}`}>
              <Link
                to={{
                  page: "operation",
                  project,
                  operation: row.of.operation,
                  component: row.of.component,
                  ...inEnvironment,
                }}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 px-5 py-2.5 text-[15px] hover:bg-muted/40"
              >
                <span className="flex min-w-0 flex-col">
                  <OperationName name={row.of.operation} />
                  <span className="truncate text-sm text-muted-foreground">{row.of.component}</span>
                </span>
                <span className="text-right font-mono">
                  {count(row.count)}
                  <span
                    className={row.errors > 0 ? "block text-sm text-failure" : "block text-sm text-muted-foreground"}
                  >
                    {row.errors > 0 ? `${count(row.errors)} failed` : "none failed"}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

// What an agent needs to look into one feature: what it is, how it is doing, and how to read the
// rest through the API and the CLI.
const agentBrief = (project: ProjectKey, environment: EnvironmentKey | undefined, story: FeatureStory) => {
  const columns = storyColumnsOf(story)
  const first = story.use.days[0]?.day
  const last = story.use.days.at(-1)?.day
  const query = environment === undefined ? "" : `?environment=${environment}`
  const flag = environment === undefined ? "" : ` --environment ${environment}`
  return [
    `Look into feature ${story.feature} in Cluenori project ${project}${environment === undefined ? "" : `, environment ${environment}`}, as of ${DateTime.formatIso(story.asOf)}.`,
    first === undefined || last === undefined
      ? "No app marked it in the 15 months kept."
      : `Apps: ${count(story.use.people)} people used it, from ${first} to ${last}.`,
    columns.errors === undefined && columns.operations === undefined
      ? "No service named it in cluenori.feature."
      : `Services, last 7 days: ${count(lastDaysSum(columns.operations ?? [], 7) ?? 0)} operations, ${count(lastDaysSum(columns.failed ?? [], 7) ?? 0)} failed; ${count(lastDaysSum(columns.errors ?? [], 7) ?? 0)} errors, ${count(lastDaysSum(columns.warnings ?? [], 7) ?? 0)} warnings.`,
    `Read its whole story with the API: GET /api/projects/${project}/features/${story.feature}${query}, or ./cluenori feature ${project} ${story.feature}${flag}.`,
    ...(story.logs.errors.length === 0
      ? []
      : [
          `Its errors, the most frequent first: ${story.logs.errors.map((error) => error.id).join(", ")}; read one with ./cluenori error ${project} <error> --last 90d.`,
        ]),
    ...(story.use.latestPeople.length === 0
      ? []
      : [
          `Who used it last: read one with ./cluenori person ${project} <person>, such as ${story.use.latestPeople[0]?.person ?? ""}.`,
        ]),
  ].join("\n")
}
