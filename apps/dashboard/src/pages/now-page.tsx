import type { ProjectKey } from "@cluenori/foundation"
import { useAtomValue } from "@effect/atom-react"
import type { DateTime } from "effect"
import { AsyncResult } from "effect/reactivity"
import { FolderPlusIcon, FoldersIcon, RssIcon } from "lucide-react"
import { lazy, Suspense } from "react"

import { compact, count } from "@/lib/format"
import type { ProductLine, ProjectLines } from "@/product-lines"
import { hasNews, newsNamesOf, projectsNowOf } from "@/product-lines"
import type { ProjectPulse } from "@/project-data"
import { feedsAtom, todayAtom } from "@/project-data"
import { dayLoadOf } from "@/project-facts"
import { Link } from "@/router"
import { LoadBars } from "@/views/load-bars"
import { Loaded } from "@/views/loaded"
import { Panel } from "@/views/panel"
import { lineDot, ProductLineRow, SteadyLines } from "@/views/product-lines"

// The feeds' rows load with the feeds' answer, after start: most deployments start without feeds.
const FeedRows = lazy(() => import("@/views/feed-rows").then((module) => ({ default: module.FeedRows })))

/** A project as Now lists it: its key and its name. */
export type ListedProject = { readonly key: ProjectKey; readonly name: string }

// "Notes needs you: Uptime, Errors and Releases", "3 projects need you".
const summaryOf = (needing: ReadonlyArray<{ readonly name: string; readonly lines: ReadonlyArray<ProductLine> }>) => {
  const [only] = needing
  if (only === undefined) {
    return "Nothing needs you right now"
  }
  if (needing.length > 1) {
    return `${count(needing.length)} projects need you`
  }
  return `${only.name} needs you: ${newsNamesOf(only.lines)}`
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

/** A project's last 24 hours as a small chart, and how many ran; nothing before its services report. */
function LoadSpark({ pulse, at }: { readonly pulse: ProjectPulse | undefined; readonly at: DateTime.Utc }) {
  if (pulse === undefined || pulse.load.length === 0) {
    return null
  }
  const load = dayLoadOf(pulse, at)
  return (
    <span className="hidden w-40 shrink-0 flex-col gap-1 sm:flex">
      <LoadBars
        total={load.ran.values}
        failed={load.failed.values}
        height={20}
        label={`${count(load.total)} operations in the last 24 hours, ${count(load.failures)} failed`}
      />
      <span className="font-mono text-xs text-muted-foreground">{compact(load.total)} in 24 h</span>
    </span>
  )
}

/** A project on Now, with its lines from Today: those with news first. */
type ProjectNow = ProjectLines<ListedProject>

/**
 * A project: its name, with what its lines come to, one click from its page; under it, each line
 * with news, leading to what it is about; then the steady ones in a quiet row.
 */
function ProjectLines({ now, at }: { readonly now: ProjectNow; readonly at: DateTime.Utc }) {
  const { project, lines, answered, pulse } = now
  const news = lines.filter(hasNews)
  const [first] = news
  const tone = !answered ? "unknown" : (first?.tone ?? "steady")
  const needing =
    news.length === 0 ? "Nothing needs you" : `${count(news.length)} ${news.length === 1 ? "needs" : "need"} you`
  const state = answered ? needing : "Didn't answer: what it would show is missing"
  return (
    <li className="flex flex-col pb-2">
      <Link
        to={{ page: "project", project: project.key }}
        className="flex items-center gap-4 px-5 pt-4 pb-2 outline-none hover:bg-accent/60 focus-visible:bg-accent/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
      >
        <span className={`size-2.5 shrink-0 ${lineDot[tone]}`} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[17px] font-medium">{project.name}</span>
          <span className="text-sm text-muted-foreground">{state}</span>
        </span>
        <LoadSpark pulse={pulse} at={at} />
      </Link>
      {news.map((line) => (
        <ProductLineRow key={line.product} line={line} className="pl-11" />
      ))}
      <SteadyLines lines={lines.filter((line) => !hasNews(line))} className="px-5 pt-1 pb-2 pl-11" />
    </li>
  )
}

/**
 * Now: every project, a line for each product with news, the project most urgent first, each line
 * one click from what it is about, and the steady ones in a quiet row; all of it Today's one answer.
 * Then the feeds, when there are any, with what arrived lately.
 */
export function NowPage({ projects }: { readonly projects: ReadonlyArray<ListedProject> }) {
  const today = useAtomValue(todayAtom)
  const feeds = useAtomValue(feedsAtom)
  const nameOf = (key: ProjectKey) => projects.find((project) => project.key === key)?.name ?? key
  const listed = AsyncResult.isSuccess(today) ? projectsNowOf(today.value, projects) : undefined
  const needing = listed
    ?.map((now) => ({ name: now.project.name, lines: now.lines.filter(hasNews) }))
    .filter((now) => now.lines.length > 0)

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-col pb-2">
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">Now</h1>
        <p className="min-h-5 text-sm text-muted-foreground">{needing === undefined ? "" : summaryOf(needing)}</p>
      </header>

      {projects.length === 0 ? (
        <NoProjects />
      ) : (
        <div className="grid items-start gap-4 2xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <Panel icon={FoldersIcon} title="Projects" subtitle="What needs you first">
            <Loaded result={today}>
              {(answer) => (
                <ul className="divide-y">
                  {projectsNowOf(answer, projects).map((now) => (
                    <ProjectLines key={now.project.key} now={now} at={answer.at} />
                  ))}
                </ul>
              )}
            </Loaded>
          </Panel>

          {AsyncResult.isSuccess(feeds) && feeds.value.feeds.length > 0 && (
            <Panel icon={RssIcon} title="Feeds" subtitle="Chosen events across projects, in production">
              <Suspense fallback={null}>
                <FeedRows feeds={feeds.value.feeds} now={feeds.value.asOf} nameOf={nameOf} />
              </Suspense>
            </Panel>
          )}
        </div>
      )}
    </div>
  )
}
