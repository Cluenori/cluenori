import type { ComponentKey, EnvironmentKey, ProjectKey } from "@cluenori/foundation"
import { useAtomValue } from "@effect/atom-react"
import { AsyncResult } from "effect/reactivity"
import { UsersRoundIcon } from "lucide-react"

import {
  appColorOf,
  appEnvironmentsOf,
  appPeriodWords,
  dayTicksOf,
  daySpanText,
  latestOf,
  usageColumnsOf,
} from "@/app-facts"
import { warningColor } from "@/lib/colors"
import { count } from "@/lib/format"
import { appHealthAtom, appPeriodAtom, usageAtom, useComponentKeys } from "@/project-data"
import type { Environments } from "@/project-facts"
import { Link } from "@/router"
import { BarRows } from "@/views/bar-rows"
import { Loaded } from "@/views/loaded"
import { Panel, PanelStats } from "@/views/panel"
import { buttonVariants } from "@/views/ui/button"

// The overview's summary of the project's apps, which loads after start, with the analytics rules.

/**
 * How the project's apps are used, when they sent anything over the analytics period: people by
 * UTC day in the environment the apps sent from that the page shows, or production; the period's
 * people, the latest day's, and the releases whose app health got worse. Nothing at all for a
 * project whose apps sent nothing, such as one of services alone; its Analytics page says how to
 * start.
 */
export function AppsSummary({
  project,
  environments,
}: {
  readonly project: ProjectKey
  readonly environments: Environments
}) {
  const health = useAtomValue(appHealthAtom({ project }))
  if (!AsyncResult.isSuccess(health) || health.value.releases.length === 0) {
    return null
  }
  const sentFrom = health.value.releases.map((each) => each.release.environment)
  const shown = appEnvironmentsOf(sentFrom, environments.production, environments.shown).shown
  const releases = health.value.releases.filter((each) => shown === undefined || each.release.environment === shown)
  return (
    <AppsUsage
      project={project}
      {...(shown === undefined ? {} : { shown })}
      worse={releases.filter((each) => each.verdict === "worse").length}
      components={releases.map((each) => each.release.component)}
    />
  )
}

function AppsUsage({
  project,
  shown,
  worse,
  components: sentBy,
}: {
  readonly project: ProjectKey
  readonly shown?: EnvironmentKey
  /** How many releases' app health got worse. */
  readonly worse: number
  /** The components the apps sent from. */
  readonly components: ReadonlyArray<ComponentKey>
}) {
  const usage = useAtomValue(usageAtom({ project, ...(shown === undefined ? {} : { environment: shown }) }))
  const period = useAtomValue(appPeriodAtom)
  const components = useComponentKeys(project)
  const color = appColorOf(undefined, sentBy, components)
  return (
    <Panel
      icon={UsersRoundIcon}
      title="Apps"
      subtitle={`People each UTC day, ${appPeriodWords(period)}${shown === undefined ? "" : `, in ${shown}`}`}
      badge="UTC"
      action={
        <Link
          to={{ page: "analytics", project, ...(shown === undefined ? {} : { environment: shown }) }}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          Open
        </Link>
      }
    >
      <Loaded result={usage}>
        {({ usage: answer, period: asked }) => {
          const daily = usageColumnsOf(answer, asked, (day) => day.people)
          const latest = latestOf(daily)
          return (
            <>
              <div className="px-5 py-5">
                <BarRows
                  rowHeight={56}
                  label={`Daily active people of the project's apps, ${appPeriodWords(period)}.`}
                  rows={[{ label: "DAU", color, values: daily.values }]}
                  ticks={dayTicksOf(daily)}
                  timeOf={(span) => daySpanText(daily, span)}
                />
              </div>
              <PanelStats
                stats={[
                  ...(latest === undefined ? [] : [{ label: "DAU, latest day", value: count(latest) }]),
                  { label: "People", value: count(answer.people) },
                  { label: "Sessions", value: count(answer.sessions) },
                  {
                    label: "Releases worse",
                    value: count(worse),
                    ...(worse > 0 ? { color: warningColor } : {}),
                  },
                ]}
              />
            </>
          )
        }}
      </Loaded>
    </Panel>
  )
}
