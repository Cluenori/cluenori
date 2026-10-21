import type { ComponentKey, ProjectKey } from "@cluenori/foundation"
import { comparedFrom, failingMoreRule, judgedAfterMs } from "@cluenori/releases"
import { slowerRule } from "@cluenori/signals"
import { useAtomValue } from "@effect/atom-react"
import { DateTime } from "effect"
import { AsyncResult } from "effect/reactivity"
import { TagIcon } from "lucide-react"

import { duration, share } from "@/lib/format"
import { operationsAtom, periodAtom, releasesAtom, useComponentKeys } from "@/project-data"
import { colorOf, liveForMs, periodWords, releaseRouteOf } from "@/project-facts"
import { navigate } from "@/router"
import { ComponentSwitch } from "@/views/component-switch"
import { Loaded } from "@/views/loaded"
import { Panel } from "@/views/panel"
import { PeriodSwitch } from "@/views/period-switch"
import { ProjectHeader } from "@/views/project-header"
import { ReleaseList } from "@/views/release-list"

/** What "live", "worse" and "too early" mean, under the list that says them. */
const releasesMeaning = [
  `Live: ran in the last ${duration(liveForMs)}.`,
  "Each release is compared with the one before it, of the same component and environment.",
  `Worse: an operation's p95 is at least ${slowerRule.times} times and ${duration(slowerRule.byMs)} more, or it fails at least ${failingMoreRule.failures} times, ${share(failingMoreRule.rate, 1)} of its runs and ${failingMoreRule.times} times as often, or an error is first seen in it.`,
  `Too early: nothing is worse yet, but it ran under ${duration(judgedAfterMs)}, or no operation ran ${comparedFrom} times in both.`,
].join(" ")

/**
 * A project's releases, or one component's, that ran over the period, the latest first: when each
 * ran, how much, and how it compares with the release before it, each one click from its own page.
 */
export function ReleasesPage({
  project,
  component,
}: {
  readonly project: ProjectKey
  readonly component?: ComponentKey
}) {
  const scope = { project, ...(component === undefined ? {} : { component }) }
  const period = useAtomValue(periodAtom)
  const components = useComponentKeys(project)
  const releases = useAtomValue(releasesAtom(scope))
  // Whether telemetry arrives at all, releases or not: a service that sends no version has none.
  const operations = useAtomValue(operationsAtom(scope))
  const shown = component ?? "every component"

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 p-4 md:p-6">
      <ProjectHeader
        title="Releases"
        latest={AsyncResult.map(operations, (table) =>
          table.dataUntil === undefined ? undefined : DateTime.toEpochMillis(table.dataUntil),
        )}
      >
        <ComponentSwitch
          components={components}
          value={component}
          allowAll
          onChange={(picked) =>
            navigate(
              { page: "releases", project, ...(picked === undefined ? {} : { component: picked }) },
              { replace: true },
            )
          }
        />
        <PeriodSwitch />
      </ProjectHeader>

      <Panel
        icon={TagIcon}
        title={`Releases of ${shown}`}
        subtitle={`${periodWords[period]}, the latest first, each against the release before it`}
      >
        <Loaded result={releases}>
          {(answer) => (
            <>
              <ReleaseList
                releases={answer.releases}
                asOf={answer.asOf}
                colorOf={(of) => colorOf(of, components)}
                linkOf={(release) => releaseRouteOf(project, release)}
              />
              {answer.releases.length > 0 && (
                <p className="border-t px-5 py-4 text-sm text-muted-foreground">{releasesMeaning}</p>
              )}
            </>
          )}
        </Loaded>
      </Panel>
    </div>
  )
}
