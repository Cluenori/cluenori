import type { ComponentKey, EnvironmentKey, ProjectKey } from "@cluenori/foundation"
import type { Component, SdkKey } from "@cluenori/projects"
import type { ComponentVersionPolicy, VersionPolicyTo } from "@cluenori/releases"
import { VersionPolicyRefused } from "@cluenori/releases"
import { AppUserId } from "@cluenori/signals"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { Cause, Exit, Option, Result, Schema } from "effect"
import { AsyncResult } from "effect/reactivity"
import { Grid3x3Icon, HeartPulseIcon, KeyRoundIcon, ShapesIcon, UserSearchIcon } from "lucide-react"
import { useId, useState } from "react"

import { appColorOf, appPeriodWords, cohortRowsOf, latestSentOf, peopleNowOf } from "@/app-facts"
import { useAppEnvironments } from "@/hooks/use-app-environments"
import { count } from "@/lib/format"
import type { AppScope } from "@/project-data"
import {
  appHealthAtom,
  appPeriodAtom,
  clearVersionPolicyAtom,
  featureUseAtom,
  issueSdkKeyAtom,
  projectAtom,
  retentionAtom,
  revokeSdkKeyAtom,
  sdkKeysAtom,
  setVersionPolicyAtom,
  usageAtom,
  versionPoliciesAtom,
} from "@/project-data"
import type { Environments } from "@/project-facts"
import { colorOf, isShownIn } from "@/project-facts"
import { Link, navigate } from "@/router"
import { AnalyticsSwitches } from "@/views/analytics-switches"
import { AppsStart, ReleasesInUse, UsageTotals } from "@/views/app-usage"
import { FeatureTable } from "@/views/feature-table"
import { HealthList } from "@/views/health-list"
import { failureText, Loaded } from "@/views/loaded"
import { Panel } from "@/views/panel"
import { PeopleCounters } from "@/views/people-counters"
import { ProjectHeader } from "@/views/project-header"
import { RetentionGrid } from "@/views/retention-grid"
import { SdkKeys } from "@/views/sdk-keys"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/views/ui/alert-dialog"
import { Button, buttonVariants } from "@/views/ui/button"
import { Input } from "@/views/ui/input"
import { VersionPolicyDialog, VersionPolicySummary } from "@/views/version-policy"

// How many releases and features the summary shows; their pages list every one.
const summaryReleases = 5
const summaryFeatures = 8

const page = "mx-auto flex w-full max-w-[1500px] flex-col gap-4 p-4 md:p-6"

/** While the page waits to know which environments the apps sent from. */
const opening = <div className="p-8 text-sm text-muted-foreground">Opening the page…</div>

const isPolicyRefused = Schema.is(VersionPolicyRefused)

// Why a version policy wasn't set: the API's reason, or that it didn't answer.
const policyProblemOf = (cause: Cause.Cause<unknown>) => {
  const error = Option.getOrUndefined(Cause.findErrorOption(cause))
  return isPolicyRefused(error) ? `${error.reason}.` : failureText(cause)
}

/**
 * The analytics page of a project, or of one of its components: what to do first when no app sends
 * yet; else, first, its daily, weekly and monthly people as big counters, and the period's totals;
 * then its features, each opening its story; weekly retention and the releases in use; its
 * releases' app health against the release before each; finding one person by the app's user ID;
 * and each component's SDK keys and version policy.
 */
export function AnalyticsPage({
  project,
  component,
  named,
}: {
  readonly project: ProjectKey
  readonly component?: ComponentKey
  /** The environment the address names, if any. */
  readonly named?: EnvironmentKey
}) {
  const environments = useAppEnvironments(project, component, named)
  return environments === undefined ? (
    opening
  ) : (
    <Analytics project={project} environments={environments} {...(component === undefined ? {} : { component })} />
  )
}

function Analytics({
  project,
  component,
  environments,
}: {
  readonly project: ProjectKey
  readonly component?: ComponentKey
  readonly environments: Environments
}) {
  const environment = environments.shown
  const scope: AppScope = {
    project,
    ...(component === undefined ? {} : { component }),
    ...(environment === undefined ? {} : { environment }),
  }
  const shown = {
    ...(component === undefined ? {} : { component }),
    ...(environment === undefined ? {} : { environment }),
  }
  const detail = useAtomValue(projectAtom(project))
  // Every environment's releases, the page keeping the one shown's; it says which environments apps send from.
  const health = useAtomValue(appHealthAtom({ project, ...(component === undefined ? {} : { component }) }))
  const usage = useAtomValue(usageAtom(scope))
  const components = AsyncResult.isSuccess(detail) ? detail.value.components : []
  const keys = components.map((each) => each.key)
  const color = appColorOf(
    component,
    AsyncResult.isSuccess(health) ? health.value.releases.map((each) => each.release.component) : [],
    keys,
  )
  const periodText = appPeriodWords(useAtomValue(appPeriodAtom))

  return (
    <div className={page}>
      <ProjectHeader title="Analytics" latest={AsyncResult.map(health, latestSentOf)}>
        <AnalyticsSwitches
          project={project}
          components={keys}
          component={component}
          environments={environments}
          routeOf={(next) => ({ page: "analytics", project, ...next })}
        />
      </ProjectHeader>

      <Loaded result={AsyncResult.all({ usage, health })}>
        {({ usage: { usage: answer, period }, health: list }) => {
          const releases = list.releases.filter((each) => isShownIn(environments, each.release.environment))
          if (answer.covered === undefined && releases.length === 0) {
            return <AppsStart periodText={periodText} deployment={window.location.origin} />
          }
          return (
            <div className="flex flex-col gap-4">
              <PeopleCounters now={peopleNowOf(answer, period)} color={color} />
              <UsageTotals usage={answer} period={period} periodText={periodText} />
              <FeaturesPanel scope={scope} people={answer.people} color={color} shown={shown} />
              <div className="grid items-start gap-4 xl:grid-cols-2">
                <RetentionPanel scope={scope} color={color} />
                <ReleasesInUse usage={answer} colorOfComponent={(of) => colorOf(of, keys)} />
              </div>
              <Panel
                icon={HeartPulseIcon}
                title="App health"
                subtitle="Each release against the release before it, over everything kept of it"
                action={
                  <Link
                    to={{ page: "appReleases", project, ...shown }}
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                  >
                    All releases
                  </Link>
                }
              >
                <HealthList
                  releases={releases.slice(0, summaryReleases)}
                  asOf={list.asOf}
                  colorOf={(of) => colorOf(of, keys)}
                  linkOf={(each) => ({
                    page: "appRelease",
                    project,
                    component: each.release.component,
                    release: each.release.release,
                    environment: each.release.environment,
                  })}
                />
                {releases.length > summaryReleases && (
                  <p className="border-t px-5 py-3 text-sm text-muted-foreground">
                    {count(summaryReleases)} of {count(releases.length)}, the latest first.
                  </p>
                )}
              </Panel>
              <FindPerson project={project} />
            </div>
          )
        }}
      </Loaded>

      <AppsPanel project={project} components={components} component={component} />
    </div>
  )
}

/** Weekly cohorts of the people first seen over the period. */
function RetentionPanel({ scope, color }: { readonly scope: AppScope; readonly color: string }) {
  const retention = useAtomValue(retentionAtom(scope))
  return (
    <Panel icon={Grid3x3Icon} title="Retention" subtitle="Weekly cohorts of the people first seen in the period">
      <Loaded result={retention}>
        {(answer) =>
          answer.cohorts.length === 0 ? (
            <p className="px-5 py-6 text-sm text-muted-foreground">Nobody was first seen in this period.</p>
          ) : (
            <div className="p-5">
              <RetentionGrid rows={cohortRowsOf(answer.cohorts)} label="Retention by weekly cohort" color={color} />
            </div>
          )
        }
      </Loaded>
    </Panel>
  )
}

/** The features the most people used, and a way to all of them. */
function FeaturesPanel({
  scope,
  people,
  color,
  shown,
}: {
  readonly scope: AppScope
  readonly people: number
  readonly color: string
  readonly shown: { readonly component?: ComponentKey; readonly environment?: EnvironmentKey }
}) {
  const features = useAtomValue(featureUseAtom(scope))
  return (
    <Panel
      icon={ShapesIcon}
      title="Features"
      subtitle="By the people who used each in the period, the most first; each opens its story"
      action={
        <Link
          to={{ page: "features", project: scope.project, ...shown }}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          All features
        </Link>
      }
    >
      <Loaded result={features}>
        {(table) =>
          table.features.length === 0 ? (
            <p className="px-5 py-6 text-sm text-muted-foreground">No feature was used in this period.</p>
          ) : (
            <>
              <FeatureTable
                rows={table.features.slice(0, summaryFeatures)}
                people={people}
                color={color}
                linkOf={(feature) => ({
                  page: "feature",
                  project: scope.project,
                  feature,
                  ...(scope.environment === undefined ? {} : { environment: scope.environment }),
                })}
              />
              {table.features.length > summaryFeatures && (
                <p className="border-t px-5 py-3 text-sm text-muted-foreground">
                  {count(summaryFeatures)} of {count(table.features.length)}.
                </p>
              )}
            </>
          )
        }
      </Loaded>
    </Panel>
  )
}

/** Finding one person by the app's own user ID, which opens their page. */
function FindPerson({ project }: { readonly project: ProjectKey }) {
  const id = useId()
  const [user, setUser] = useState("")
  const [rule, setRule] = useState<string | undefined>(undefined)
  return (
    <Panel icon={UserSearchIcon} title="A person" subtitle="By your app's user ID">
      <form
        className="flex flex-col gap-2 p-5"
        onSubmit={(event) => {
          event.preventDefault()
          const decoded = Schema.decodeResult(AppUserId)(user.trim())
          if (Result.isFailure(decoded)) {
            setRule(decoded.failure.message)
            return
          }
          navigate({ page: "person", project, user: decoded.success })
        }}
      >
        <label htmlFor={`${id}-user`} className="text-sm">
          The app&apos;s user ID
        </label>
        <div className="flex gap-2">
          <Input
            id={`${id}-user`}
            value={user}
            onChange={(event) => setUser(event.target.value)}
            placeholder="user-1842"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={rule !== undefined}
            aria-describedby={`${id}-user-help`}
            className="h-9 font-mono"
          />
          <Button type="submit" variant="outline" className="h-9">
            Find
          </Button>
        </div>
        <p
          id={`${id}-user-help`}
          className={rule === undefined ? "text-sm text-muted-foreground" : "text-sm text-failure"}
        >
          {rule ?? "As the app gave it to Cluenori.identify."}
        </p>
      </form>
    </Panel>
  )
}

/** Each component's SDK keys and version policy: how its builds send, and which must update. */
function AppsPanel({
  project,
  components,
  component,
}: {
  readonly project: ProjectKey
  readonly components: ReadonlyArray<Component>
  readonly component: ComponentKey | undefined
}) {
  const policies = useAtomValue(versionPoliciesAtom(project))
  const keys = components.map((each) => each.key)
  const shown = components.filter((each) => component === undefined || each.key === component)
  return (
    <Panel
      icon={KeyRoundIcon}
      title="Apps"
      subtitle="Each component's SDK keys, which its builds send with, and the versions that must update"
    >
      {shown.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted-foreground">
          No components yet. Add the app&apos;s:{" "}
          <span className="font-mono">
            ./cluenori component add {project} notes-ios --name &quot;Notes for iPhone&quot;
          </span>
          .
        </p>
      ) : (
        <div className="flex flex-col divide-y">
          {shown.map((each) => (
            <ComponentApps
              key={each.key}
              project={project}
              component={each}
              color={colorOf(each.key, keys)}
              policies={policies}
            />
          ))}
        </div>
      )}
    </Panel>
  )
}

/** One component's SDK keys and version policy, with what can be done to them. */
function ComponentApps({
  project,
  component,
  color,
  policies,
}: {
  readonly project: ProjectKey
  readonly component: Component
  readonly color: string
  readonly policies: AsyncResult.AsyncResult<{ readonly policies: ReadonlyArray<ComponentVersionPolicy> }, unknown>
}) {
  const of = { project, component: component.key }
  const keys = useAtomValue(sdkKeysAtom(of))
  const issue = useAtomSet(issueSdkKeyAtom, { mode: "promiseExit" })
  const revoke = useAtomSet(revokeSdkKeyAtom, { mode: "promiseExit" })
  const setPolicy = useAtomSet(setVersionPolicyAtom, { mode: "promiseExit" })
  const clearPolicy = useAtomSet(clearVersionPolicyAtom, { mode: "promiseExit" })
  const [issuing, setIssuing] = useState(false)
  const [justIssued, setJustIssued] = useState<SdkKey | undefined>(undefined)
  const [keyProblem, setKeyProblem] = useState<string | undefined>(undefined)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState<{ readonly busy: boolean; readonly refusal?: string }>({ busy: false })
  const [clearProblem, setClearProblem] = useState<string | undefined>(undefined)
  const policy = AsyncResult.isSuccess(policies)
    ? policies.value.policies.find((each) => each.component === component.key)
    : undefined

  const onIssue = () => {
    setIssuing(true)
    setKeyProblem(undefined)
    void issue(of).then((exit) => {
      setIssuing(false)
      if (Exit.isSuccess(exit)) {
        setJustIssued(exit.value.key)
      } else {
        setKeyProblem(failureText(exit.cause))
      }
    })
  }
  const onRevoke = (key: SdkKey) => {
    setKeyProblem(undefined)
    void revoke({ ...of, key }).then((exit) => {
      if (Exit.isFailure(exit)) {
        setKeyProblem(failureText(exit.cause))
      }
    })
  }
  const onSave = (next: VersionPolicyTo) => {
    setSaving({ busy: true })
    void setPolicy({ ...of, policy: next }).then((exit) => {
      if (Exit.isSuccess(exit)) {
        setSaving({ busy: false })
        setEditing(false)
      } else {
        setSaving({ busy: false, refusal: policyProblemOf(exit.cause) })
      }
    })
  }

  return (
    <section aria-label={component.key} className="flex min-w-0 flex-col">
      <header className="flex items-center gap-3 px-5 pt-4">
        <span aria-hidden className="size-2.5 shrink-0" style={{ backgroundColor: color }} />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-[17px] font-medium tracking-[-0.01em]">{component.name}</span>
          <span className="font-mono text-sm text-muted-foreground">{component.key}</span>
        </span>
      </header>
      <div className="grid gap-6 px-5 py-4 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-3">
          <h2 className="text-sm text-muted-foreground">SDK keys</h2>
          <Loaded result={keys}>
            {(list) => (
              <SdkKeys
                component={component.key}
                keys={list.keys}
                issuing={issuing}
                {...(justIssued === undefined ? {} : { justIssued })}
                {...(keyProblem === undefined ? {} : { problem: keyProblem })}
                onIssue={onIssue}
                onRevoke={onRevoke}
              />
            )}
          </Loaded>
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <h2 className="text-sm text-muted-foreground">Version policy</h2>
          <Loaded result={policies}>{() => <VersionPolicySummary policy={policy} />}</Loaded>
          <span className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!AsyncResult.isSuccess(policies)}
              onClick={() => {
                setSaving({ busy: false })
                setEditing(true)
              }}
            >
              {policy === undefined ? "Set a version policy…" : "Change…"}
              <span className="sr-only"> {component.key}&apos;s version policy</span>
            </Button>
            {policy !== undefined && (
              <ClearPolicy
                component={component.key}
                onClear={() => {
                  setClearProblem(undefined)
                  void clearPolicy(of).then((exit) => {
                    if (Exit.isFailure(exit)) {
                      setClearProblem(failureText(exit.cause))
                    }
                  })
                }}
              />
            )}
          </span>
          {clearProblem !== undefined && (
            <p role="alert" className="text-sm text-failure">
              {clearProblem}
            </p>
          )}
        </div>
      </div>
      {editing && (
        <VersionPolicyDialog
          component={component.key}
          current={policy}
          open
          onOpenChange={(open) => setEditing(open)}
          saving={saving.busy}
          refusal={saving.refusal}
          onSave={onSave}
        />
      )}
    </section>
  )
}

/** Clearing a version policy, after asking: no release is asked to update once apps read it again. */
function ClearPolicy({ component, onClear }: { readonly component: ComponentKey; readonly onClear: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={<Button variant="ghost" size="sm" />}>
        Clear<span className="sr-only"> {component}&apos;s version policy</span>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Clear {component}&apos;s version policy?</AlertDialogTitle>
          <AlertDialogDescription>
            No release of it is asked to update any more, once its apps read their manifest again, within five minutes.
            You can set a policy again at any time.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <Button
            variant="destructive"
            onClick={() => {
              setOpen(false)
              onClear()
            }}
          >
            Clear the policy
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
