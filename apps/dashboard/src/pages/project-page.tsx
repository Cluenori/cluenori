import type { ProjectKey } from "@cluenori/foundation"
import { useAtomValue } from "@effect/atom-react"
import { AsyncResult } from "effect/reactivity"
import type { LucideIcon } from "lucide-react"
import {
  ActivityIcon,
  BellIcon,
  ChartNoAxesColumnIcon,
  ChevronRightIcon,
  ServerIcon,
  TagIcon,
  UsersRoundIcon,
} from "lucide-react"
import type { ReactNode } from "react"

import { failureColor } from "@/lib/colors"
import { calendarDayText, count, share } from "@/lib/format"
import { ProductionLoad, ProjectPeople } from "@/pages/project-parts"
import type { DayLoad } from "@/pages/project-parts"
import { appHealthAtom, deliveryAtom, projectAtom, todayAtom } from "@/project-data"
import type { PeopleCount } from "@/project-facts"
import {
  changeOf,
  columnTimesOf,
  loadColumnsOf,
  needsYouCountsOf,
  needsYouOf,
  releasedLineOf,
  ticksOf,
  waitingReleasesOf,
  zoneOf,
} from "@/project-facts"
import type { Route } from "@/router"
import { Link } from "@/router"
import { LoadBars } from "@/views/load-bars"
import { Loaded } from "@/views/loaded"
import { NeedsYouList } from "@/views/needs-you-list"
import { Panel, PanelStats } from "@/views/panel"
import { TrendWords } from "@/views/trend-words"

/** One count of people: what it counts, how many, and how it moved since the week before. */
function PeopleFigure({ label, people }: { readonly label: string; readonly people: PeopleCount }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 px-5 py-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="flex flex-col gap-1">
        <span className="font-mono text-2xl">{people.value === undefined ? "–" : count(people.value)}</span>
        <TrendWords
          moved={changeOf(people)}
          unknown={people.value === undefined ? "Not counted that day" : "Nothing a week before to compare"}
          className="text-sm"
        />
      </dd>
    </div>
  )
}

/** The project's apps' daily and monthly people on the latest whole UTC day, against a week before. */
function PeoplePanel({ project }: { readonly project: ProjectKey }) {
  return (
    <Panel icon={UsersRoundIcon} title="People" subtitle="Of its apps, against the week before" badge="UTC">
      <ProjectPeople project={project}>
        {(people) => {
          if (people._tag === "none") {
            return (
              <p className="px-5 py-5 text-sm text-muted-foreground">
                No app sent anything in the last 30 days, so there is no one to count. Product says how to start.
              </p>
            )
          }
          const { daily, monthly, day, days } = people.people
          const first = days[0]
          const weekBefore = days[7]
          return (
            <>
              <dl className="grid grid-cols-2 divide-x">
                <PeopleFigure label="Daily people" people={daily} />
                <PeopleFigure label="Monthly people" people={monthly} />
              </dl>
              <div className="mt-auto px-5 pt-2 pb-4">
                <LoadBars
                  total={days.map((each) => each.people)}
                  failed={[]}
                  height={56}
                  ticks={[
                    ...(first === undefined ? [] : [{ column: 0, label: calendarDayText(first.day) }]),
                    ...(weekBefore === undefined ? [] : [{ column: 7, label: calendarDayText(weekBefore.day) }]),
                  ]}
                  label={`Daily people over the 14 UTC days up to ${calendarDayText(day)}.`}
                />
              </div>
              <p className="border-t px-5 py-3 text-sm text-muted-foreground">
                On {calendarDayText(day)}
                {people.environment === undefined ? "" : `, in ${people.environment}`}, against the same day a week
                before; by the day, the 14 up to it.
              </p>
            </>
          )
        }}
      </ProjectPeople>
    </Panel>
  )
}

/** The load of the last day, by the hour, failures over it, and the numbers that matter beside it. */
function DayLoadChart({ load }: { readonly load: DayLoad }) {
  const total = loadColumnsOf(load.series, (point) => point.count)
  const failed = loadColumnsOf(load.series, (point) => point.errors)
  const { whenOf } = columnTimesOf(total)
  const ran = load.series.points.reduce((sum, point) => sum + point.count, 0)
  const failures = load.series.points.reduce((sum, point) => sum + point.errors, 0)
  const busiest = total.values.reduce<number | undefined>(
    (best, value, column) =>
      value !== undefined && value > 0 && (best === undefined || value > (total.values[best] ?? 0)) ? column : best,
    undefined,
  )
  const unknown = total.values.some((value) => value === undefined)
  return (
    <>
      <div className="flex flex-1 flex-col gap-3 px-5 py-5">
        <LoadBars
          total={total.values}
          failed={failed.values}
          height={112}
          ticks={ticksOf(total)}
          label={`${count(ran)} operations over the last 24 hours, ${count(failures)} of them failed.`}
        />
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span className="flex items-center gap-2">
            <span className="size-2.5 bg-blue" />
            Ran
          </span>
          <span className="flex items-center gap-2">
            <span className="size-2.5 bg-failure" />
            Failed
          </span>
          {unknown && (
            <span className="flex items-center gap-2">
              <span className="size-2.5 bg-muted" />
              Nothing reported
            </span>
          )}
          {load.environment !== undefined && <span>In {load.environment}</span>}
          {zoneOf(load.series) !== undefined && <span>Times in {zoneOf(load.series)}</span>}
        </p>
      </div>
      <PanelStats
        stats={[
          { label: "Ran", value: count(ran) },
          { label: "Failed", value: count(failures), ...(failures > 0 ? { color: failureColor } : {}) },
          { label: "Error rate", value: share(failures, ran), ...(failures > 0 ? { color: failureColor } : {}) },
          { label: "Busiest hour", value: busiest === undefined ? "–" : whenOf(busiest) },
        ]}
      />
    </>
  )
}

/** One of a project's doors: what is behind it, a line of what is going on there, one click in. */
function Door({
  icon: Icon,
  title,
  to,
  children,
}: {
  readonly icon: LucideIcon
  readonly title: string
  readonly to: Route
  readonly children: ReactNode
}) {
  return (
    <Link
      to={to}
      className="flex min-w-0 items-center gap-4 border bg-card px-5 py-4 outline-none hover:bg-accent/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
    >
      <span className="grid size-10 shrink-0 place-items-center border text-foreground/90">
        <Icon className="size-[18px]" strokeWidth={1.75} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[17px] font-medium tracking-[-0.01em]">{title}</span>
        <span className="text-sm text-muted-foreground">{children}</span>
      </span>
      <ChevronRightIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  )
}

/** What Product shows, in a line: how many of the apps' releases sent lately, and how many got worse. */
function ProductLine({ project }: { readonly project: ProjectKey }) {
  const health = useAtomValue(appHealthAtom({ project }))
  if (!AsyncResult.isSuccess(health)) {
    return AsyncResult.isFailure(health) ? "How the apps are used: unknown for now" : "How the apps are used"
  }
  const releases = health.value.releases
  if (releases.length === 0) {
    return "No app has sent anything yet: how to start"
  }
  const worse = releases.filter((each) => each.verdict === "worse").length
  return `${count(releases.length)} app ${releases.length === 1 ? "release" : "releases"} in use · ${
    worse === 0 ? "none worse than the one before" : `${count(worse)} worse than the one before`
  }`
}

/**
 * A project's page: its apps' people against last week, its load over the last day with what
 * failed, what needs the founder there, the most urgent first, and its three doors, Product, Tech
 * and Releases, each with a line of what is going on behind it. All of it in the environments the
 * project calls production, as Now.
 */
export function ProjectPage({ project }: { readonly project: ProjectKey }) {
  const detail = useAtomValue(projectAtom(project))
  const today = useAtomValue(todayAtom)
  const delivery = useAtomValue(deliveryAtom(project))
  const name = AsyncResult.isSuccess(detail) ? detail.value.project.name : project
  const waiting = AsyncResult.isSuccess(delivery)
    ? waitingReleasesOf(project, delivery.value.delivery, delivery.value.asOf)
    : []
  const items = AsyncResult.map(today, (answer) =>
    needsYouOf(answer, waiting).filter((item) => item.project === project),
  )
  const techCounts = AsyncResult.isSuccess(items)
    ? needsYouCountsOf(items.value.filter((item) => item.group !== "release"))
    : undefined

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-col pb-2">
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">{name}</h1>
        <p className="min-h-5 text-sm text-muted-foreground">
          {AsyncResult.isSuccess(items) &&
            (items.value.length === 0 ? "Nothing needs you here right now" : needsYouCountsOf(items.value))}
        </p>
      </header>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <PeoplePanel project={project} />
        <Panel icon={ActivityIcon} title="Load" subtitle="Last 24 hours, with what failed">
          <ProductionLoad project={project}>
            {(load) =>
              load.series.covered === undefined ? (
                <p className="px-5 py-5 text-sm text-muted-foreground">Nothing was reported in the last 24 hours.</p>
              ) : (
                <DayLoadChart load={load} />
              )
            }
          </ProductionLoad>
        </Panel>
      </div>

      <Panel icon={BellIcon} title="Needs you" subtitle="In production, the most urgent first">
        <Loaded result={items}>
          {(rows) => (
            <>
              <NeedsYouList items={rows} />
              {AsyncResult.isSuccess(today) && today.value.unanswered.includes(project) && (
                <p className="border-t px-5 py-3 text-sm text-muted-foreground">
                  The project didn&apos;t answer: what else needs you here is unknown.
                </p>
              )}
            </>
          )}
        </Loaded>
      </Panel>

      <nav aria-label={`${name}'s areas`} className="grid gap-4 lg:grid-cols-3">
        <Door icon={ChartNoAxesColumnIcon} title="Product" to={{ page: "analytics", project }}>
          <ProductLine project={project} />
        </Door>
        <Door icon={ServerIcon} title="Tech" to={{ page: "tech", project }}>
          {AsyncResult.isSuccess(items)
            ? (techCounts ?? "Nothing needs you in production")
            : "Operations, errors, logs and incidents"}
        </Door>
        <Door icon={TagIcon} title="Releases" to={{ page: "releases", project }}>
          {AsyncResult.isSuccess(delivery)
            ? [
                releasedLineOf(delivery.value.delivery) ?? "Nothing released yet",
                ...(waiting.length === 0 ? [] : [`${count(waiting.length)} waiting for you`]),
              ].join(" · ")
            : "What runs where, and what to release next"}
        </Door>
      </nav>
    </div>
  )
}
