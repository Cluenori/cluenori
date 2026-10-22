import type { ComponentKey, ProjectKey } from "@cluenori/foundation"
import type { Component } from "@cluenori/projects"
import { comparedFrom, failingMoreRule, judgedAfterMs } from "@cluenori/releases"
import { slowerRule } from "@cluenori/signals"
import { useAtom, useAtomValue } from "@effect/atom-react"
import { DateTime } from "effect"
import { Atom, AsyncResult } from "effect/reactivity"
import { ArrowUpRightIcon, CableIcon, TagIcon, TriangleAlertIcon } from "lucide-react"
import { useState } from "react"

import { duration, share } from "@/lib/format"
import { linkComponentAtom, operationsAtom, periodAtom, projectAtom, releasesAtom } from "@/project-data"
import type { Environments } from "@/project-facts"
import { colorOf, isShownIn, liveForMs, periodWords, releaseRouteOf } from "@/project-facts"
import type { Filters } from "@/router"
import { FilterSwitches } from "@/views/filter-switches"
import { LinksDialog } from "@/views/links-dialog"
import { Loaded } from "@/views/loaded"
import { Panel } from "@/views/panel"
import { ProjectHeader } from "@/views/project-header"
import { ReleaseList } from "@/views/release-list"
import { SourceProblems } from "@/views/source-problems"
import { Button } from "@/views/ui/button"

/** What "live", "worse" and "too early" mean, under the list that says them. */
const releasesMeaning = [
  `Live: ran in the last ${duration(liveForMs)}.`,
  "Each release is compared with the one before it, of the same component and environment.",
  `Worse: an operation's p95 is at least ${slowerRule.times} times and ${duration(slowerRule.byMs)} more, or it fails at least ${failingMoreRule.failures} times, ${share(failingMoreRule.rate, 1)} of its runs and ${failingMoreRule.times} times as often, or an error is first seen in it.`,
  `Too early: nothing is worse yet, but it ran under ${duration(judgedAfterMs)}, or no operation ran ${comparedFrom} times in both.`,
].join(" ")

/** One link of a component, as the list of sources shows it: what it is, and its value or that there is none. */
function LinkValue({
  label,
  value,
  href,
}: {
  readonly label: string
  readonly value?: string
  readonly href?: string
}) {
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      {value === undefined && <span className="text-[15px] text-muted-foreground">Not linked</span>}
      {value !== undefined && href === undefined && <span className="truncate font-mono text-[15px]">{value}</span>}
      {value !== undefined && href !== undefined && (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="flex min-w-0 items-center gap-1 font-mono text-[15px] underline-offset-4 hover:underline"
        >
          <span className="truncate">{value}</span>
          <span className="sr-only"> on GitHub</span>
          <ArrowUpRightIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        </a>
      )}
    </span>
  )
}

/** Each component's links, where its releases' commits and builds come from, each one click from changing. */
function Sources({
  components,
  colorOf: colorOfComponent,
  onChange,
}: {
  readonly components: ReadonlyArray<Component>
  readonly colorOf: (component: string) => string
  readonly onChange: (component: ComponentKey) => void
}) {
  if (components.length === 0) {
    return <p className="px-5 py-6 text-sm text-muted-foreground">No components yet.</p>
  }
  return (
    <ul className="divide-y">
      {components.map((component) => (
        <li
          key={component.key}
          className="grid items-center gap-x-6 gap-y-3 px-5 py-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_minmax(0,1fr)_auto]"
        >
          <span className="flex min-w-0 items-center gap-3 sm:col-span-2 lg:col-span-1">
            <span className="size-2.5 shrink-0" style={{ backgroundColor: colorOfComponent(component.key) }} />
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-[15px]">{component.name}</span>
              <span className="truncate font-mono text-sm text-muted-foreground">{component.key}</span>
            </span>
          </span>
          <LinkValue
            label="GitHub repository"
            {...(component.repository === undefined
              ? {}
              : { value: component.repository, href: `https://github.com/${component.repository}` })}
          />
          <LinkValue
            label="App Store bundle ID"
            {...(component.appStoreBundleId === undefined ? {} : { value: component.appStoreBundleId })}
          />
          <Button
            variant="outline"
            size="sm"
            className="justify-self-start sm:col-span-2 lg:col-span-1"
            onClick={() => onChange(component.key)}
          >
            Change links<span className="sr-only"> of {component.key}</span>
          </Button>
        </li>
      ))}
    </ul>
  )
}

/**
 * A project's releases, or one component's, of the environment shown, that ran, were deployed, or
 * were uploaded over the period, the latest first: how each shipped, when it ran, how much, and how it compares with the
 * release before it, each one click from its own page. Above them, any source that couldn't be read
 * lately, so missing commits and builds aren't read as none; below, where each component's releases
 * come from, each one click from changing.
 */
export function ReleasesPage({
  project,
  component,
  environments,
}: {
  readonly project: ProjectKey
  readonly component?: ComponentKey
  readonly environments: Environments
}) {
  const environment = environments.shown
  const filters: Filters = {
    ...(component === undefined ? {} : { component }),
    ...(environment === undefined ? {} : { environment }),
  }
  // Every environment's releases, the page keeping those of the environment shown (`isShownIn`).
  const scope = { project, ...(component === undefined ? {} : { component }) }
  const period = useAtomValue(periodAtom)
  const detail = useAtomValue(projectAtom(project))
  const releases = useAtomValue(releasesAtom(scope))
  // Whether telemetry arrives at all, releases or not: a service that sends no version has none.
  const operations = useAtomValue(operationsAtom(scope))
  const [linking, link] = useAtom(linkComponentAtom)
  const [editing, setEditing] = useState<ComponentKey | undefined>(undefined)
  const all = AsyncResult.isSuccess(detail) ? detail.value.components : []
  const components = all.map((entry) => entry.key)
  const shown = component ?? "every component"
  const colorOfComponent = (of: string) => colorOf(of, components)
  const edited = all.find((entry) => entry.key === editing)
  const startEditing = (key: ComponentKey) => {
    // A save from an earlier dialog isn't this one's.
    link(Atom.Reset)
    setEditing(key)
  }

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 p-4 md:p-6">
      <ProjectHeader
        title="Releases"
        latest={AsyncResult.map(operations, (table) =>
          table.dataUntil === undefined ? undefined : DateTime.toEpochMillis(table.dataUntil),
        )}
      >
        <FilterSwitches
          project={project}
          components={components}
          filters={filters}
          environments={environments}
          routeOf={(next) => ({
            page: "releases",
            project,
            ...(next.component === undefined ? {} : { component: next.component }),
            ...(next.environment === undefined ? {} : { environment: next.environment }),
          })}
        />
      </ProjectHeader>

      {AsyncResult.isSuccess(releases) && releases.value.problems.length > 0 && (
        <Panel
          icon={TriangleAlertIcon}
          title="Sources that failed"
          subtitle="Until these are fixed, releases may lack their commits or store builds"
        >
          <SourceProblems
            problems={releases.value.problems}
            asOf={releases.value.asOf}
            colorOf={colorOfComponent}
            onChangeLinks={startEditing}
          />
        </Panel>
      )}

      <Panel
        icon={TagIcon}
        title={`Releases of ${shown}`}
        subtitle={`${periodWords[period]}, the latest first, each against the release before it`}
      >
        <Loaded result={releases}>
          {(answer) => (
            <>
              <ReleaseList
                releases={answer.releases.filter((release) => isShownIn(environments, release.environment))}
                asOf={answer.asOf}
                colorOf={colorOfComponent}
                linkOf={(release) => releaseRouteOf(project, release)}
              />
              {answer.releases.length > 0 && (
                <p className="border-t px-5 py-4 text-sm text-muted-foreground">{releasesMeaning}</p>
              )}
            </>
          )}
        </Loaded>
      </Panel>

      <Panel
        icon={CableIcon}
        title="Where releases come from"
        subtitle="Each component's repository gives its releases their commits; an app's bundle ID, its builds"
      >
        <Loaded result={detail}>
          {(answer) => (
            <Sources
              components={answer.components.filter((entry) => component === undefined || entry.key === component)}
              colorOf={colorOfComponent}
              onChange={startEditing}
            />
          )}
        </Loaded>
      </Panel>

      {edited !== undefined && (
        <LinksDialog
          key={edited.key}
          component={edited}
          // Open until it is closed, or its save succeeds.
          open={!AsyncResult.isSuccess(linking)}
          onOpenChange={(open) => {
            if (!open) {
              setEditing(undefined)
            }
          }}
          saving={linking}
          onSave={(links) => link({ project, component: edited.key, links })}
        />
      )}
    </div>
  )
}
