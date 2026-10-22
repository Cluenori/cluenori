import type { ComponentKey, EnvironmentKey, ProjectKey, ReleaseVersion } from "@cluenori/foundation"
import type { DeployTarget } from "@cluenori/projects"
import type { EnvironmentDelivery, NextStep, Promotion, SemanticVersion } from "@cluenori/releases"
import { comparedFrom, defaultNotesStyle, failingMoreRule, judgedAfterMs, VersionRefused } from "@cluenori/releases"
import { slowerRule } from "@cluenori/signals"
import { useAtom, useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react"
import { Cause, DateTime, Exit, Option, Schema } from "effect"
import { Atom, AsyncResult } from "effect/reactivity"
import { HistoryIcon, PenLineIcon, TriangleAlertIcon, WaypointsIcon } from "lucide-react"
import { lazy, Suspense, useEffect, useState } from "react"

import { duration, share } from "@/lib/format"
import {
  deliveryAtom,
  linkComponentAtom,
  meAtom,
  notesStyleAtom,
  operationsAtom,
  periodAtom,
  projectAtom,
  promoteAtom,
  promoteLatestAtom,
  releaseApprovedAtom,
  releaseAtom,
  releasesAtom,
  setNotesStyleAtom,
  setVersionAtom,
} from "@/project-data"
import type { Environments } from "@/project-facts"
import { colorOf, isShownIn, liveForMs, periodWords, releaseRouteOf } from "@/project-facts"
import type { ThereNow } from "@/release-facts"
import {
  deliveryGroupsOf,
  isDelivering,
  nextReleaseOf,
  promotionsAskedEveryMs,
  shipsWithOptionsOf,
  thereNowOf,
} from "@/release-facts"
import type { Filters } from "@/router"
import { navigate } from "@/router"
import { DeliveryList } from "@/views/delivery-list"
import { FilterSwitches } from "@/views/filter-switches"
import { LinksDialog } from "@/views/links-dialog"
import { failureText, Loaded } from "@/views/loaded"
import { NotesStyleEditor } from "@/views/notes-style-editor"
import { Panel } from "@/views/panel"
import { ProjectHeader } from "@/views/project-header"
import { ReleaseList } from "@/views/release-list"
import { ReleaseNowDialog } from "@/views/release-now-dialog"
import { SourceProblems } from "@/views/source-problems"
import type { VersionToSet } from "@/views/version-line"
import { SetVersionDialog } from "@/views/version-line"

// Promoting loads when it is asked for, now and then.
const PromoteDialog = lazy(() => import("@/views/promote-dialog").then((module) => ({ default: module.PromoteDialog })))
const PromoteLatestDialog = lazy(() =>
  import("@/views/promote-dialog").then((module) => ({ default: module.PromoteLatestDialog })),
)

const isVersionRefused = Schema.is(VersionRefused)

// Why setting a version didn't happen: the API's reason when it refused, else what failed.
const versionProblemOf = (cause: Cause.Cause<unknown>) => {
  const error = Option.getOrUndefined(Cause.findErrorOption(cause))
  return isVersionRefused(error) ? error.reason : failureText(cause)
}

/** What "live", "worse" and "too early" mean, under the list that says them. */
const releasesMeaning = [
  `Live: ran in the last ${duration(liveForMs)}.`,
  "Each release is compared with the one before it, of the same component and environment.",
  `Worse: an operation's p95 is at least ${slowerRule.times} times and ${duration(slowerRule.byMs)} more, or it fails at least ${failingMoreRule.failures} times, ${share(failingMoreRule.rate, 1)} of its runs and ${failingMoreRule.times} times as often, or an error is first seen in it.`,
  `Too early: nothing is worse yet, but it ran under ${duration(judgedAfterMs)}, or no operation ran ${comparedFrom} times in both.`,
].join(" ")

/** A release being promoted from an environment's next step: what, from where, to which target. */
type Confirming = {
  readonly component: ComponentKey
  readonly release: ReleaseVersion
  readonly from: EnvironmentKey
  readonly target: DeployTarget
  readonly thereNow: ThereNow | undefined
  /** How many times one was confirmed: each confirmation starts fresh. */
  readonly count: number
}

/**
 * Confirming a promotion from an environment's next step: the promote dialog, with the release's
 * notes, which an App Store Connect app's build is sent with, once they are read.
 */
function PromoteFromStage({
  project,
  confirming,
  repository,
  owner,
  onClose,
  onChangeLinks,
}: {
  readonly project: ProjectKey
  readonly confirming: Confirming
  readonly repository: string | undefined
  readonly owner: boolean
  readonly onClose: () => void
  readonly onChangeLinks: () => void
}) {
  const { component, release, from, target } = confirming
  const scope = { project, component, release, environment: from }
  // Not handled: the release's answer failing leaves its notes said as being read; promoting still
  // works, and App Store review's refusal says when they're missing, one click from writing them.
  const answer = useAtomValue(releaseAtom(scope))
  const [promoting, promote] = useAtom(promoteAtom)
  return (
    <PromoteDialog
      release={release}
      target={target}
      thereNow={confirming.thereNow}
      repository={repository}
      notes={AsyncResult.isSuccess(answer) ? answer.value.detail.notes : undefined}
      owner={owner}
      // Open until it is closed, or the promotion started.
      open={!AsyncResult.isSuccess(promoting)}
      onOpenChange={(open) => {
        if (!open) {
          onClose()
        }
      }}
      promoting={promoting}
      onPromote={(input) => promote({ release: scope, environment: target.environment, ...input })}
      // The notes are written on the release's own page.
      onOpenNotes={() => navigate({ page: "release", project, component, release, environment: from })}
      onChangeLinks={onChangeLinks}
    />
  )
}

/**
 * A project's releases, or one component's, led by how they reach each environment: for each
 * component, what runs in each of its environments now and since when, a promotion under way, and
 * the one next step, a click from its confirmation; the components that ship with it inside it; its
 * version and its links. Above, any source that couldn't be read lately, so missing commits and
 * builds aren't read as none; below, the history: the releases of the environment shown that ran,
 * were deployed, or were uploaded over the period, the latest first, each against the release
 * before it; then how AI drafts of release notes read.
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
  const delivery = useAtomValue(deliveryAtom(project))
  const askDeliveryAgain = useAtomRefresh(deliveryAtom(project))
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
  const deliveryOf = (key: ComponentKey) =>
    AsyncResult.isSuccess(delivery)
      ? delivery.value.delivery.components.find((each) => each.component === key)
      : undefined

  // While a promotion to any environment runs, its state is asked for again: Cluenori asks GitHub
  // each minute.
  const following = AsyncResult.isSuccess(delivery) && isDelivering(delivery.value.delivery)
  useEffect(() => {
    if (!following) {
      return
    }
    const timer = window.setInterval(askDeliveryAgain, promotionsAskedEveryMs)
    return () => window.clearInterval(timer)
  }, [following, askDeliveryAgain])

  // Versions: bumped from a menu, or set in a dialog; why either didn't happen is said where it was asked.
  const setVersion = useAtomSet(setVersionAtom, { mode: "promiseExit" })
  const [bumping, setBumping] = useState<ComponentKey | undefined>(undefined)
  const [bumpProblem, setBumpProblem] = useState<{ readonly component: ComponentKey; readonly text: string }>()
  const [setting, setSetting] = useState<ComponentKey | undefined>(undefined)
  const [settingState, setSettingState] = useState<{ readonly saving: boolean; readonly refusal?: string }>({
    saving: false,
  })
  const bump = (of: ComponentKey, version: SemanticVersion) => {
    setBumping(of)
    setBumpProblem(undefined)
    void setVersion({ project, component: of, version }).then((exit) => {
      setBumping(undefined)
      if (Exit.isFailure(exit)) {
        setBumpProblem({ component: of, text: versionProblemOf(exit.cause) })
      }
    })
  }
  const startSetting = (of: ComponentKey) => {
    setSettingState({ saving: false })
    setSetting(of)
  }
  const saveVersion = (of: ComponentKey, set: VersionToSet) => {
    setSettingState({ saving: true })
    void setVersion({ project, component: of, ...set }).then((exit) => {
      if (Exit.isSuccess(exit)) {
        setSettingState({ saving: false })
        setSetting(undefined)
      } else {
        setSettingState({ saving: false, refusal: versionProblemOf(exit.cause) })
      }
    })
  }

  // Who is signed in: an owner is told how to fix what only an owner can.
  const me = useAtomValue(meAtom)
  const owner = AsyncResult.isSuccess(me) && me.value.role === "owner"

  // The next steps: building a component's latest commit for its first environment, and promoting
  // the release of the environment before to the next.
  const latest = useAtomValue(promoteLatestAtom)
  const resetLatest = useAtomSet(promoteLatestAtom)
  const promoteLatest = useAtomSet(promoteLatestAtom, { mode: "promiseExit" })
  // The component and environment being built for, and how many times one was: each starts fresh.
  const [latestOf, setLatestOf] = useState<{
    readonly component: ComponentKey
    readonly environment: EnvironmentKey
    readonly count: number
  }>()
  const latestComponent = all.find((entry) => entry.key === latestOf?.component)
  const latestLine = latestOf === undefined ? undefined : deliveryOf(latestOf.component)?.version
  const resetPromoting = useAtomSet(promoteAtom)
  const [confirming, setConfirming] = useState<Confirming | undefined>(undefined)
  const takeNext = (of: ComponentKey, stage: EnvironmentDelivery, next: NextStep) => {
    switch (next._tag) {
      case "buildLatest":
        // An answer to an earlier promotion isn't this one's.
        resetLatest(Atom.Reset)
        setLatestOf((last) => ({ component: of, environment: stage.environment, count: (last?.count ?? 0) + 1 }))
        return
      case "promote": {
        const { target } = stage
        const delivered = deliveryOf(of)
        if (target === undefined) {
          return
        }
        resetPromoting(Atom.Reset)
        setConfirming((last) => ({
          component: of,
          release: next.release,
          from: next.from,
          target,
          thereNow: delivered === undefined ? undefined : thereNowOf(delivered, stage.environment),
          count: (last?.count ?? 0) + 1,
        }))
        return
      }
    }
  }
  const confirmedComponent = all.find((entry) => entry.key === confirming?.component)

  // Releasing an App Store version review approved, from the environment it goes to.
  const [releasing, releaseNow] = useAtom(releaseApprovedAtom)
  const [releasingOne, setReleasingOne] = useState<Promotion | undefined>(undefined)

  // The project's notes style: its own, or Cluenori's default.
  const notesStyle = useAtomValue(notesStyleAtom(project))
  const [stylePosting, saveStyle] = useAtom(setNotesStyleAtom)

  const historyScope = [
    shown === "every component" ? "Every component" : shown,
    ...(environment === undefined ? [] : [`in ${environment}`]),
  ].join(" ")

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
        icon={WaypointsIcon}
        title="Delivery"
        subtitle="What runs in each environment now, in the order releases go, and the next step"
      >
        <Loaded result={AsyncResult.all({ delivery, detail })}>
          {(answer) => (
            <DeliveryList
              groups={deliveryGroupsOf(answer.delivery.delivery.components).filter(
                (group) =>
                  component === undefined ||
                  group.delivery.component === component ||
                  group.shipping.some((each) => each.component === component),
              )}
              components={answer.detail.components}
              colorOf={colorOfComponent}
              production={environments.production}
              asOf={answer.delivery.asOf}
              linkOf={(release) => releaseRouteOf(project, release)}
              bumping={bumping}
              bumpProblem={bumpProblem}
              actions={{
                onNext: takeNext,
                onReleaseNow: (promotion) => {
                  releaseNow(Atom.Reset)
                  setReleasingOne(promotion)
                },
                onChangeLinks: startEditing,
                onBump: bump,
                onSetVersion: startSetting,
              }}
            />
          )}
        </Loaded>
      </Panel>

      <Panel
        icon={HistoryIcon}
        title="Release history"
        subtitle={`${historyScope}, ${periodWords[period].toLowerCase()}, the latest first, each against the release before it`}
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
        icon={PenLineIcon}
        title="Release notes style"
        subtitle="How AI drafts of every component's release notes read"
      >
        <Loaded result={notesStyle}>
          {(answer) => (
            <NotesStyleEditor
              // A style saved elsewhere, or just now, starts the field again.
              key={answer.style}
              style={answer.style}
              isDefault={answer.style === defaultNotesStyle}
              saving={stylePosting.waiting}
              saved={AsyncResult.isSuccess(stylePosting)}
              problem={AsyncResult.isFailure(stylePosting) ? failureText(stylePosting.cause) : undefined}
              onSave={(style) => saveStyle({ project, style })}
            />
          )}
        </Loaded>
      </Panel>

      {latestOf !== undefined && latestComponent !== undefined && (
        <Suspense fallback={null}>
          <PromoteLatestDialog
            key={latestOf.count}
            component={latestComponent.key}
            environment={latestOf.environment}
            targets={(latestComponent.deployTargets ?? []).filter((target) => target.workflow !== undefined)}
            repository={latestComponent.repository}
            nextRelease={latestLine === undefined ? undefined : nextReleaseOf(latestLine)}
            owner={owner}
            // Open until it is closed, or the promotion started: its environment then shows it.
            open={!AsyncResult.isSuccess(latest)}
            onOpenChange={(open) => {
              if (!open) {
                setLatestOf(undefined)
              }
            }}
            promoting={latest}
            onPromote={(input) => void promoteLatest({ project, component: latestComponent.key, ...input })}
            onOpenVersions={() => {
              setLatestOf(undefined)
              startSetting(latestComponent.key)
            }}
            onChangeLinks={() => {
              setLatestOf(undefined)
              startEditing(latestComponent.key)
            }}
          />
        </Suspense>
      )}

      {confirming !== undefined && (
        <Suspense fallback={null}>
          <PromoteFromStage
            key={confirming.count}
            project={project}
            confirming={confirming}
            repository={confirmedComponent?.repository}
            owner={owner}
            onClose={() => setConfirming(undefined)}
            onChangeLinks={() => {
              setConfirming(undefined)
              startEditing(confirming.component)
            }}
          />
        </Suspense>
      )}

      {releasingOne !== undefined && (
        <ReleaseNowDialog
          promotion={releasingOne}
          // Open until it is closed, or it was released.
          open={!AsyncResult.isSuccess(releasing)}
          onOpenChange={(open) => {
            if (!open) {
              setReleasingOne(undefined)
            }
          }}
          releasing={releasing}
          onRelease={() =>
            releaseNow({
              release: {
                project,
                component: releasingOne.component,
                release: releasingOne.release,
                environment: releasingOne.environment,
              },
              promotion: releasingOne.id,
            })
          }
        />
      )}

      {setting !== undefined && (
        <SetVersionDialog
          key={setting}
          component={setting}
          current={deliveryOf(setting)?.version}
          open
          onOpenChange={(open) => {
            if (!open) {
              setSetting(undefined)
            }
          }}
          saving={settingState.saving}
          refusal={settingState.refusal}
          onSave={(set) => saveVersion(setting, set)}
        />
      )}

      {edited !== undefined && (
        <LinksDialog
          key={edited.key}
          component={edited}
          shipsWithOptions={shipsWithOptionsOf(all, edited.key)}
          environments={[...new Set([...environments.production, ...environments.offered])]}
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
