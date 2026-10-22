import type { ComponentKey, EnvironmentKey, ProjectKey } from "@cluenori/foundation"
import type { FeatureUse } from "@cluenori/signals"
import { useAtomValue } from "@effect/atom-react"
import { AsyncResult } from "effect/reactivity"
import { ShapesIcon } from "lucide-react"
import { useId, useState } from "react"

import { appColorOf, appPeriodWords, latestSentOf } from "@/app-facts"
import { useAppEnvironments } from "@/hooks/use-app-environments"
import { count } from "@/lib/format"
import { appHealthAtom, appPeriodAtom, featureUseAtom, useComponentKeys, usageAtom } from "@/project-data"
import type { Environments } from "@/project-facts"
import { AnalyticsSwitches } from "@/views/analytics-switches"
import { FeatureTable, featureName } from "@/views/feature-table"
import { Loaded } from "@/views/loaded"
import { Panel } from "@/views/panel"
import { ProjectHeader } from "@/views/project-header"
import { Segmented } from "@/views/segmented"
import { Input } from "@/views/ui/input"

type SortKey = "people" | "events" | "screens" | "memory"

const sorts: ReadonlyArray<{ readonly value: SortKey; readonly label: string }> = [
  { value: "people", label: "People" },
  { value: "events", label: "Events" },
  { value: "screens", label: "Screens" },
  { value: "memory", label: "Peak memory" },
]

// The largest first; a feature whose memory wasn't measured goes last when sorting by memory.
const valueOf = (row: FeatureUse, by: SortKey) => {
  switch (by) {
    case "people":
      return row.people
    case "events":
      return row.events
    case "screens":
      return row.screens
    case "memory":
      return row.memory?.peakP95Bytes ?? -1
  }
}

/**
 * Every feature key of a project's apps used over the period, or of one component's: searchable by
 * key, sorted by people, events, screens or peak memory, each with the share of the period's people
 * who used it.
 */
export function FeaturesPage({
  project,
  component,
  named,
}: {
  readonly project: ProjectKey
  readonly component?: ComponentKey
  readonly named?: EnvironmentKey
}) {
  const environments = useAppEnvironments(project, component, named)
  if (environments === undefined) {
    return <div className="p-8 text-sm text-muted-foreground">Opening the page…</div>
  }
  return <Features project={project} component={component} environments={environments} />
}

function Features({
  project,
  component,
  environments,
}: {
  readonly project: ProjectKey
  readonly component: ComponentKey | undefined
  readonly environments: Environments
}) {
  const id = useId()
  const environment = environments.shown
  const scope = {
    project,
    ...(component === undefined ? {} : { component }),
    ...(environment === undefined ? {} : { environment }),
  }
  const features = useAtomValue(featureUseAtom(scope))
  const usage = useAtomValue(usageAtom(scope))
  const health = useAtomValue(appHealthAtom({ project, ...(component === undefined ? {} : { component }) }))
  const period = useAtomValue(appPeriodAtom)
  const keys = useComponentKeys(project)
  const [search, setSearch] = useState("")
  const [by, setBy] = useState<SortKey>("people")
  const color = appColorOf(
    component,
    AsyncResult.isSuccess(health) ? health.value.releases.map((each) => each.release.component) : [],
    keys,
  )

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 p-4 md:p-6">
      <ProjectHeader title="Features" latest={AsyncResult.map(health, latestSentOf)}>
        <AnalyticsSwitches
          project={project}
          components={keys}
          component={component}
          environments={environments}
          routeOf={(next) => ({ page: "features", project, ...next })}
        />
      </ProjectHeader>
      <Panel icon={ShapesIcon} title="Every feature" subtitle={`Used in ${appPeriodWords(period)}`}>
        <div className="flex flex-wrap items-center gap-3 border-b px-5 py-3">
          <label htmlFor={`${id}-search`} className="sr-only">
            Search features
          </label>
          <Input
            id={`${id}-search`}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search features, such as notes.edit"
            autoComplete="off"
            spellCheck={false}
            className="h-9 max-w-sm font-mono"
          />
          <span className="ml-auto flex items-center gap-2.5 text-sm">
            <span aria-hidden className="text-muted-foreground">
              Sort by
            </span>
            <Segmented label="Sort by" options={sorts} value={by} onChange={setBy} />
          </span>
        </div>
        <Loaded result={AsyncResult.all({ features, usage })}>
          {({ features: table, usage: { usage: answer } }) => {
            const needle = search.trim().toLowerCase()
            const rows = table.features
              .filter((row) => needle === "" || featureName(row).toLowerCase().includes(needle))
              .toSorted((left, right) => valueOf(right, by) - valueOf(left, by))
            if (table.features.length === 0) {
              return <p className="px-5 py-6 text-sm text-muted-foreground">No feature was used in this period.</p>
            }
            return (
              <>
                {rows.length === 0 ? (
                  <p className="px-5 py-6 text-sm text-muted-foreground">No feature matches “{search.trim()}”.</p>
                ) : (
                  <FeatureTable rows={rows} people={answer.people} color={color} />
                )}
                <p className="mt-auto border-t px-5 py-3 text-sm text-muted-foreground">
                  {count(rows.length)} of {count(table.features.length)}. A feature is the key the app marks its screens
                  and actions with; &ldquo;(no feature)&rdquo; is what it marked with none.
                </p>
              </>
            )
          }}
        </Loaded>
      </Panel>
    </div>
  )
}
