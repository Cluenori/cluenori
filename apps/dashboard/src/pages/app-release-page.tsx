import type { ReleaseHealth } from "@cluenori/analytics"
import type { ComponentKey, EnvironmentKey, ProjectKey, ReleaseVersion } from "@cluenori/foundation"
import { useAtomValue } from "@effect/atom-react"
import { cn } from "cn"
import { DateTime, Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import { ArrowLeftIcon, HeartPulseIcon, ShapesIcon, UsersRoundIcon } from "lucide-react"

import {
  appPeriodWords,
  dayTicksOf,
  daySpanText,
  healthMeaning,
  healthRowsOf,
  healthWordsOf,
  latestOf,
  usageColumnsOf,
} from "@/app-facts"
import { count, ratio } from "@/lib/format"
import { appPeriodAtom, featureUseAtom, releaseHealthAtom, useComponentKeys, usageAtom } from "@/project-data"
import { colorOf, liveForMs } from "@/project-facts"
import { Link } from "@/router"
import { AppPeriodSwitch } from "@/views/app-period-switch"
import { BarRows } from "@/views/bar-rows"
import { FeatureTable } from "@/views/feature-table"
import { HealthTable } from "@/views/health-table"
import { Loaded } from "@/views/loaded"
import { Panel, PanelStats } from "@/views/panel"
import { verdictClass } from "@/views/release-list"
import { ReleaseRan } from "@/views/release-ran"
import { buttonVariants } from "@/views/ui/button"

/** A release's app health against the release before it: the verdict in words, then measure by measure. */
function HealthPanel({ health }: { readonly health: ReleaseHealth }) {
  const verdict = healthWordsOf(health)
  const previous = health.release.previous
  return (
    <Panel
      icon={HeartPulseIcon}
      title={previous === undefined ? "Nothing to compare with" : `Against ${previous}`}
      subtitle={
        previous === undefined
          ? "No release of it was seen before this one"
          : "The release before it, of the same component and environment, over everything kept of each"
      }
    >
      <div className="flex flex-col gap-1.5 px-5 py-5">
        <p className={cn("text-xl font-medium tracking-[-0.01em]", verdictClass[verdict.tone])}>{verdict.words}</p>
        <p className="max-w-4xl text-sm text-pretty text-muted-foreground">{healthMeaning}</p>
      </div>
      <div className="border-t">
        <HealthTable rows={healthRowsOf(health)} release={health.release.release} previous={previous} />
      </div>
    </Panel>
  )
}

/**
 * One release of an app, in one environment: when it sent, its app health against the release
 * before it with the verdict in words, the people on it by day over the period, and how its features
 * were used, with the memory each took.
 */
export function AppReleasePage({
  project,
  component,
  release,
  environment,
}: {
  readonly project: ProjectKey
  readonly component: ComponentKey
  readonly release: ReleaseVersion
  readonly environment?: EnvironmentKey
}) {
  const of = { project, component, release, ...(environment === undefined ? {} : { environment }) }
  const health = useAtomValue(releaseHealthAtom(of))
  const usage = useAtomValue(usageAtom(of))
  const features = useAtomValue(featureUseAtom(of))
  const period = useAtomValue(appPeriodAtom)
  const keys = useComponentKeys(project)
  const color = colorOf(component, keys)
  const where = environment === undefined ? component : `${component} in ${environment}`

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-wrap items-start gap-x-4 gap-y-3 pb-2">
        <Link
          to={{ page: "appReleases", project, component, ...(environment === undefined ? {} : { environment }) }}
          aria-label="Back to the releases' app health"
          className={buttonVariants({ variant: "outline", size: "icon", className: "mt-0.5" })}
        >
          <ArrowLeftIcon />
        </Link>
        <div className="flex min-w-0 flex-[1_1_16rem] flex-col">
          <h1 className="font-mono text-2xl font-semibold tracking-[-0.02em] wrap-anywhere">{release}</h1>
          <p className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-muted-foreground">
            <span className="flex items-center gap-2">
              <span aria-hidden className="size-2 shrink-0" style={{ backgroundColor: color }} />
              {where}
            </span>
            {AsyncResult.isSuccess(health) && Option.isSome(health.value.health) && (
              <span className="flex items-center gap-2">
                Sent
                <ReleaseRan
                  ran={health.value.health.value.release}
                  live={
                    DateTime.toEpochMillis(health.value.asOf) -
                      DateTime.toEpochMillis(health.value.health.value.release.lastSeen) <
                    liveForMs
                  }
                />
              </span>
            )}
          </p>
        </div>
        <div className="ml-auto">
          <AppPeriodSwitch />
        </div>
      </header>

      <Loaded result={health}>
        {({ health: found }) =>
          Option.isNone(found) ? (
            <Panel icon={HeartPulseIcon} title="App health" subtitle="Over everything kept of the release">
              <p className="px-5 py-6 text-sm text-muted-foreground">
                This release sent nothing in the last 90 days, so there is no app health to show.
              </p>
            </Panel>
          ) : (
            <HealthPanel health={found.value} />
          )
        }
      </Loaded>

      <Panel
        icon={UsersRoundIcon}
        title="People on it"
        subtitle={`Active each UTC day on this release, in ${appPeriodWords(period)}`}
        badge="UTC"
      >
        <Loaded result={usage}>
          {({ usage: answer, period: asked }) => {
            if (answer.covered === undefined) {
              return <p className="px-5 py-6 text-sm text-muted-foreground">It sent nothing in this period.</p>
            }
            const daily = usageColumnsOf(answer, asked, (day) => day.people)
            const sessions = usageColumnsOf(answer, asked, (day) => day.sessions)
            const noteOf = (columns: typeof daily) => {
              const latest = latestOf(columns)
              return latest === undefined ? "unknown" : count(latest)
            }
            return (
              <>
                <div className="p-5">
                  <BarRows
                    rowHeight={56}
                    label={`People and sessions on ${release} by UTC day over ${appPeriodWords(period)}.`}
                    rows={[
                      { label: "DAU", note: noteOf(daily), color, values: daily.values },
                      { label: "Sessions", note: noteOf(sessions), color, values: sessions.values },
                    ]}
                    ticks={dayTicksOf(daily)}
                    timeOf={(span) => daySpanText(daily, span)}
                  />
                </div>
                <PanelStats
                  stats={[
                    { label: "People", value: count(answer.people) },
                    { label: "Sessions", value: count(answer.sessions) },
                    ...(answer.sessionsPerPerson === undefined
                      ? []
                      : [{ label: "Sessions per person", value: ratio(answer.sessionsPerPerson) }]),
                  ]}
                />
              </>
            )
          }}
        </Loaded>
      </Panel>

      <Panel icon={ShapesIcon} title="Features on it" subtitle="By the people who used each, with the memory it took">
        <Loaded result={AsyncResult.all({ features, usage })}>
          {({ features: table, usage: { usage: answer } }) =>
            table.features.length === 0 ? (
              <p className="px-5 py-6 text-sm text-muted-foreground">No feature was used on it in this period.</p>
            ) : (
              <FeatureTable rows={table.features} people={answer.people} color={color} />
            )
          }
        </Loaded>
      </Panel>
    </div>
  )
}
