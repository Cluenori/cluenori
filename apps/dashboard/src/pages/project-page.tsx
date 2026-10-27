import type { ProjectKey } from "@cluenori/foundation"
import { useAtomValue } from "@effect/atom-react"
import type { DateTime } from "effect"
import { AsyncResult } from "effect/reactivity"
import { LayoutListIcon } from "lucide-react"

import { compact, count } from "@/lib/format"
import type { ProductLine } from "@/product-lines"
import { hasNews, newsNamesOf, projectLinesOf } from "@/product-lines"
import type { ProjectPulse } from "@/project-data"
import { deliveryAtom, projectAtom, projectsAtom, todayAtom } from "@/project-data"
import { dayLoadOf } from "@/project-facts"
import { LoadBars } from "@/views/load-bars"
import { Loaded } from "@/views/loaded"
import { Panel } from "@/views/panel"
import { LineItems, ProductLineRow } from "@/views/product-lines"

/** Performance's evidence beside its line: the last 24 hours by the hour, what failed on top. */
function DaySpark({ pulse, at }: { readonly pulse: ProjectPulse | undefined; readonly at: DateTime.Utc }) {
  if (pulse === undefined || pulse.load.length === 0) {
    return null
  }
  const load = dayLoadOf(pulse, at)
  return (
    <span className="hidden w-48 flex-col gap-1 md:flex">
      <LoadBars
        total={load.ran.values}
        failed={load.failed.values}
        height={24}
        label={`${count(load.total)} operations over the last 24 hours, ${count(load.failures)} of them failed.`}
      />
      <span className="font-mono text-xs text-muted-foreground">{compact(load.total)} in 24 h</span>
    </span>
  )
}

/** One product's row: its line, and under a line with several things behind it, each of them. */
function ProductRow({
  line,
  pulse,
  at,
}: {
  readonly line: ProductLine
  readonly pulse: ProjectPulse | undefined
  readonly at: DateTime.Utc
}) {
  return (
    <li>
      <ProductLineRow
        line={line}
        aside={line.product === "performance" ? <DaySpark pulse={pulse} at={at} /> : undefined}
      />
      {/* The line opens the product; what it is about, even one thing, has rows of its own. */}
      {line.items.length > 0 && <LineItems items={line.items} />}
    </li>
  )
}

/**
 * A project's page: what it comes to, then a row for each product, the most urgent first, with what
 * it says of the project and the things behind it, each leading in; the products with nothing to say
 * last, still a way in. All of it in the environments the project calls production: Today's answer,
 * which Now asked too, and, for Releases, what runs in the environments the project calls production.
 */
export function ProjectPage({ project }: { readonly project: ProjectKey }) {
  const projects = useAtomValue(projectsAtom)
  const today = useAtomValue(todayAtom)
  const delivery = useAtomValue(deliveryAtom(project))
  const name = AsyncResult.isSuccess(projects)
    ? (projects.value.projects.find((each) => each.key === project)?.name ?? project)
    : project
  const detail = useAtomValue(projectAtom(project))
  // Releases' steady line names what runs in the environments the project calls production.
  const production = AsyncResult.isSuccess(detail) ? detail.value.settings?.productionEnvironments : undefined
  const shipped =
    AsyncResult.isSuccess(delivery) && production !== undefined
      ? { delivery: delivery.value.delivery, production }
      : undefined
  const lines = AsyncResult.map(today, (answer) => projectLinesOf(answer, project, shipped))
  const unanswered = AsyncResult.isSuccess(today) && today.value.unanswered.includes(project)
  const summary = () => {
    if (!AsyncResult.isSuccess(lines)) {
      return ""
    }
    if (unanswered) {
      return "The project didn't answer: what needs you here is unknown"
    }
    const news = lines.value.filter(hasNews)
    return news.length === 0
      ? "Nothing needs you here right now"
      : `${count(news.length)} ${news.length === 1 ? "needs" : "need"} you: ${newsNamesOf(news)}`
  }

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-col pb-2">
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">{name}</h1>
        <p className="min-h-5 text-sm text-muted-foreground">{summary()}</p>
      </header>

      <Panel icon={LayoutListIcon} title="Products" subtitle="What needs you first">
        <Loaded result={today}>
          {(answer) => (
            <ul className="divide-y">
              {projectLinesOf(answer, project, shipped).map((line) => (
                <ProductRow
                  key={line.product}
                  line={line}
                  pulse={answer.pulses?.find((pulse) => pulse.project === project)}
                  at={answer.at}
                />
              ))}
            </ul>
          )}
        </Loaded>
      </Panel>
    </div>
  )
}
