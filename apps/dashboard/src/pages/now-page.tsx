import type { ProjectKey } from "@cluenori/foundation"
import { useAtomValue } from "@effect/atom-react"
import { AsyncResult } from "effect/reactivity"
import { BellIcon, FolderPlusIcon, FoldersIcon } from "lucide-react"

import { compact, count } from "@/lib/format"
import { ProductionLoad, ProjectPeople } from "@/pages/project-parts"
import type { AppPeople, DayLoad } from "@/pages/project-parts"
import { deliveriesAtom, todayAtom } from "@/project-data"
import type { NeedsYou, ProjectState } from "@/project-facts"
import { changeOf, loadColumnsOf, needsYouOf, projectStateOf, waitingReleasesOf } from "@/project-facts"
import { Link } from "@/router"
import { LoadBars } from "@/views/load-bars"
import { Loaded } from "@/views/loaded"
import { NeedsYouList } from "@/views/needs-you-list"
import { Panel } from "@/views/panel"
import { TrendWords } from "@/views/trend-words"

/** A project as Now lists it: its key and its name. */
export type ListedProject = { readonly key: ProjectKey; readonly name: string }

const stateDot: Readonly<Record<ProjectState["tone"], string>> = {
  failure: "bg-failure",
  warning: "bg-yellow",
  release: "bg-purple",
  fine: "bg-mint",
  unknown: "bg-muted-foreground/50",
}

// "4 things need you, across 3 projects".
const summaryOf = (items: ReadonlyArray<NeedsYou>) => {
  if (items.length === 0) {
    return "Nothing needs you right now"
  }
  const projects = new Set(items.map((item) => item.project)).size
  const things = items.length === 1 ? "1 thing needs you" : `${count(items.length)} things need you`
  return projects === 1 ? `${things}, in 1 project` : `${things}, across ${count(projects)} projects`
}

/** The start of a workspace without projects: how to create the first. */
function NoProjects() {
  return (
    <Panel
      icon={FolderPlusIcon}
      title="No projects yet"
      subtitle="A project is one product, with the components that ship separately"
    >
      <div className="flex max-w-2xl flex-col gap-3 px-5 py-6">
        <p className="text-[15px]">Create the first from a terminal, in Cluenori&apos;s folder:</p>
        <pre className="border bg-background px-3 py-2 font-mono text-sm">
          ./cluenori project create notes --name Notes
        </pre>
        <p className="text-sm text-muted-foreground">
          Then add its components, each with the ingest key its telemetry is sent with:{" "}
          <span className="font-mono">./cluenori component add notes notes-api --name &quot;Notes API&quot;</span>.
          Reload this page to see it.
        </p>
      </div>
    </Panel>
  )
}

/** A project's last 24 hours as a small chart, and how many ran. */
function LoadSpark({ load }: { readonly load: DayLoad }) {
  const total = loadColumnsOf(load.series, (point) => point.count)
  const failed = loadColumnsOf(load.series, (point) => point.errors)
  const ran = load.series.points.reduce((sum, point) => sum + point.count, 0)
  const failures = load.series.points.reduce((sum, point) => sum + point.errors, 0)
  if (load.series.covered === undefined || load.series.points.length === 0) {
    return <span className="text-sm text-muted-foreground">Nothing in 24 h</span>
  }
  return (
    <span className="flex w-full flex-col gap-1">
      <LoadBars
        total={total.values}
        failed={failed.values}
        height={24}
        label={`${count(ran)} operations in the last 24 hours, ${count(failures)} failed`}
      />
      <span className="font-mono text-xs text-muted-foreground">{compact(ran)} in 24 h</span>
    </span>
  )
}

/** A project's daily people, and how they moved since the week before. */
function DailyPeople({ people }: { readonly people: AppPeople }) {
  if (people._tag === "none") {
    return <span className="text-sm text-muted-foreground">No app data</span>
  }
  const daily = people.people.daily
  return (
    <span className="flex flex-col items-end gap-0.5">
      <span className="flex items-baseline gap-1.5">
        <span className="font-mono text-[17px]">{daily.value === undefined ? "–" : count(daily.value)}</span>
        <span className="text-xs text-muted-foreground">daily people</span>
      </span>
      <TrendWords
        moved={changeOf(daily)}
        unknown={daily.value === undefined ? "Not counted yesterday" : "No week before"}
        className="text-xs"
      />
    </span>
  )
}

function ProjectRow({ project, state }: { readonly project: ListedProject; readonly state: ProjectState | undefined }) {
  return (
    <li>
      <Link
        to={{ page: "project", project: project.key }}
        className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 px-5 py-4 outline-none hover:bg-accent/60 focus-visible:bg-accent/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:grid-cols-[minmax(0,1fr)_10rem_9rem] sm:gap-x-6"
      >
        <span className="flex min-w-0 items-start gap-3">
          <span className={`mt-2 size-2.5 shrink-0 ${state === undefined ? "bg-muted" : stateDot[state.tone]}`} />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-[17px] font-medium">{project.name}</span>
            <span className="text-sm text-muted-foreground">{state?.line ?? "Asking…"}</span>
          </span>
        </span>
        {/* On a phone, the day's load goes under the name and the people, the width of the row. */}
        <span className="order-last col-span-2 flex min-w-0 sm:order-none sm:col-span-1">
          <ProductionLoad project={project.key}>{(load) => <LoadSpark load={load} />}</ProductionLoad>
        </span>
        <span className="flex justify-end text-right">
          <ProjectPeople project={project.key}>{(people) => <DailyPeople people={people} />}</ProjectPeople>
        </span>
      </Link>
    </li>
  )
}

/**
 * Now: what needs the founder across every project, the most urgent first, each one click from what
 * it is about; then every project, its state, its last 24 hours, and its daily people against last
 * week, one click from its own page.
 */
export function NowPage({ projects }: { readonly projects: ReadonlyArray<ListedProject> }) {
  const today = useAtomValue(todayAtom)
  const deliveries = useAtomValue(deliveriesAtom)
  const nameOf = (key: ProjectKey) => projects.find((project) => project.key === key)?.name ?? key
  const asked = AsyncResult.isSuccess(deliveries) ? deliveries.value : []
  // Releases waiting, from each project's delivery that answered; one that didn't is said below.
  const waiting = asked.flatMap(({ project, delivery }) =>
    AsyncResult.isSuccess(delivery) ? waitingReleasesOf(project, delivery.value.delivery, delivery.value.asOf) : [],
  )
  const deliveryFailed = asked.filter(({ delivery }) => AsyncResult.isFailure(delivery)).map(({ project }) => project)
  const items = AsyncResult.isSuccess(today) ? needsYouOf(today.value, waiting) : undefined
  const stateOf = (project: ProjectKey) => {
    if (AsyncResult.isFailure(today)) {
      return projectStateOf([], false)
    }
    return items === undefined || !AsyncResult.isSuccess(today)
      ? undefined
      : projectStateOf(
          items.filter((item) => item.project === project),
          !today.value.unanswered.includes(project),
        )
  }

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-col pb-2">
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">Now</h1>
        <p className="min-h-5 text-sm text-muted-foreground">{items === undefined ? "" : summaryOf(items)}</p>
      </header>

      {projects.length === 0 ? (
        <NoProjects />
      ) : (
        <div className="grid items-start gap-4 2xl:grid-cols-2">
          <Panel icon={BellIcon} title="Needs you" subtitle="In production, the most urgent first">
            <Loaded result={today}>
              {(answer) => (
                <>
                  <NeedsYouList items={needsYouOf(answer, waiting)} projectName={nameOf} />
                  {answer.unanswered.length > 0 && (
                    <p className="border-t px-5 py-3 text-sm text-muted-foreground">
                      {answer.unanswered.map(nameOf).join(", ")} didn&apos;t answer: what needs you there is unknown.
                    </p>
                  )}
                  {deliveryFailed.length > 0 && (
                    <p className="border-t px-5 py-3 text-sm text-muted-foreground">
                      Whether releases wait for you in {deliveryFailed.map(nameOf).join(", ")} is unknown: its releases
                      didn&apos;t answer.
                    </p>
                  )}
                </>
              )}
            </Loaded>
          </Panel>

          <Panel icon={FoldersIcon} title="Projects" subtitle="State, last 24 hours, daily people">
            <ul className="divide-y">
              {projects.map((project) => (
                <ProjectRow key={project.key} project={project} state={stateOf(project.key)} />
              ))}
            </ul>
          </Panel>
        </div>
      )}
    </div>
  )
}
