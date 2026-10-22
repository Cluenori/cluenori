import type { ComponentKey, EnvelopeName, EnvironmentKey, ProjectKey, ReleaseVersion } from "@cluenori/foundation"
import type { Incident } from "@cluenori/incidents"
import type { Component } from "@cluenori/projects"
import type {
  ChangedCommit,
  ComparedOperation,
  MergedPullRequest,
  ReleaseChanges,
  ReleaseDetail,
  StoreBuild,
  Verdict,
} from "@cluenori/releases"
import { comparedFrom, failingMoreRule, judgedAfterMs } from "@cluenori/releases"
import { slowerRule } from "@cluenori/signals"
import { useAtom, useAtomValue, useAtomSet } from "@effect/atom-react"
import { cn } from "cn"
import { Cause, DateTime, Option } from "effect"
import { Atom, AsyncResult } from "effect/reactivity"
import {
  ActivityIcon,
  ArrowLeftIcon,
  ArrowUpRightIcon,
  BellIcon,
  BugIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  CircleXIcon,
  GaugeIcon,
  GitCompareArrowsIcon,
  GitPullRequestIcon,
  PlusIcon,
  ScrollTextIcon,
  SearchXIcon,
  SmartphoneIcon,
  TriangleAlertIcon,
  ZapIcon,
} from "lucide-react"
import type { ReactNode } from "react"
import { useState } from "react"

import { liveColor } from "@/lib/colors"
import { count, duration, moment, share } from "@/lib/format"
import type { ReleaseScope } from "@/project-data"
import { linkComponentAtom, periodAtom, projectAtom, releaseAtom } from "@/project-data"
import type { Ran } from "@/project-facts"
import {
  appleWords,
  changesCountOf,
  colorOf,
  incidentActionOf,
  isLive,
  periodCovering,
  ranOf,
  releaseRouteOf,
  storeStageOf,
  verdictOf,
} from "@/project-facts"
import type { Route } from "@/router"
import { Link } from "@/router"
import type { Attention } from "@/views/attention-list"
import { AttentionList } from "@/views/attention-list"
import { CommitName } from "@/views/commit-name"
import type { Moved } from "@/views/compared-table"
import { ComparedTable } from "@/views/compared-table"
import { ErrorList } from "@/views/error-list"
import { LinksDialog } from "@/views/links-dialog"
import { Loaded } from "@/views/loaded"
import { OperationName } from "@/views/operation-name"
import type { Stat } from "@/views/panel"
import { Panel, PanelStats } from "@/views/panel"
import { verdictClass } from "@/views/release-list"
import { SourceProblems } from "@/views/source-problems"
import { Button, buttonVariants } from "@/views/ui/button"

const slowerWords = `at least ${slowerRule.times} times and ${duration(slowerRule.byMs)} more`
const failingWords = `at least ${failingMoreRule.failures} times, ${share(failingMoreRule.rate, 1)} of its runs and ${failingMoreRule.times} times as often`

/** What each verdict means, under it. */
const verdictMeaning: Readonly<Record<Verdict, string>> = {
  worse: `An operation's p95 is ${slowerWords} than in the release before, or it fails ${failingWords}, or an error was first seen in it.`,
  better: "Nothing got worse, and an operation got faster or fails less than in the release before.",
  same: "No operation got slower or faster, or fails more or less, than in the release before.",
  tooEarly: `Nothing is worse yet, but it ran under ${duration(judgedAfterMs)}, or no operation ran ${comparedFrom} times in both releases.`,
  first: "There is no release before it to compare with.",
  unmeasured:
    "No operation of it was counted yet. Once its telemetry reports this version, it is compared with the release before it.",
}

// An incident's color: red while open, yellow once someone is on it, gray once resolved.
const toneOf = (incident: Incident): Attention["tone"] => {
  if (incident.resolvedAt !== undefined) {
    return "over"
  }
  return incident.acknowledgedAt === undefined ? "failure" : "warning"
}

// When an incident opened, and whether it is still open.
const incidentWhen = (incident: Incident) => {
  const opened = `${incident.component}, opened ${moment(DateTime.toEpochMillis(incident.openedAt))}`
  const acknowledged = incident.acknowledgedAt === undefined ? "" : ", acknowledged"
  return incident.resolvedAt === undefined
    ? `${opened}, still open${acknowledged}`
    : `${opened}, resolved ${moment(DateTime.toEpochMillis(incident.resolvedAt))}`
}

const at = (time: DateTime.Utc) => moment(DateTime.toEpochMillis(time))

// What a release's numbers are: when it ran and how much, once it has telemetry; and when its deploy
// was reported. A build's upload is the store panel's.
const statsOf = (detail: ReleaseDetail, ran: Ran | undefined, live: boolean): ReadonlyArray<Stat> => {
  const { summary } = detail
  const { count: runs, errors } = summary
  return [
    ...(ran === undefined
      ? []
      : [
          { label: "From", value: at(ran.firstSeen) },
          live ? { label: "Until", value: "Live", color: liveColor } : { label: "Until", value: at(ran.lastSeen) },
        ]),
    ...(runs === undefined || errors === undefined
      ? []
      : [
          { label: "Runs", value: count(runs) },
          { label: "Error rate", value: share(errors, runs) },
        ]),
    ...(summary.deployedAt === undefined ? [] : [{ label: "Deployed", value: at(summary.deployedAt) }]),
  ]
}

/** The release's verdict against the one before it, what it means, and when and how much it ran. */
function VerdictPanel({
  project,
  detail,
  live,
}: {
  readonly project: ProjectKey
  readonly detail: ReleaseDetail
  readonly live: boolean
}) {
  const { summary } = detail
  const verdict = verdictOf(summary)
  const previous = summary.previous
  const stats = statsOf(detail, ranOf(summary), live)
  return (
    <Panel
      icon={GitCompareArrowsIcon}
      title={previous === undefined ? "Nothing to compare with" : `Against ${previous}`}
      subtitle={
        previous === undefined
          ? "No release of it was known before this one"
          : "The release before it, of the same component and environment"
      }
    >
      <div className="flex flex-col gap-1.5 px-5 py-5">
        <p className={cn("text-xl font-medium tracking-[-0.01em]", verdictClass[verdict.tone])}>{verdict.words}</p>
        <p className="max-w-3xl text-sm text-muted-foreground">{verdictMeaning[summary.verdict]}</p>
        {previous !== undefined && (
          <Link
            to={releaseRouteOf(project, { ...summary, release: previous })}
            className={buttonVariants({ variant: "outline", size: "sm", className: "mt-2.5 self-start" })}
          >
            Open the release before
          </Link>
        )}
      </div>
      {stats.length > 0 && <PanelStats stats={stats} />}
    </Panel>
  )
}

// A phased release's days, done ones filled: Apple releases to everyone over 7.
function PhasedDays({ day }: { readonly day: number }) {
  return (
    <span aria-hidden className="flex gap-1">
      {Array.from({ length: 7 }, (_, index) => (
        <span key={index} className={cn("h-2 w-6 border", index < day ? "border-mint bg-mint" : "bg-background")} />
      ))}
    </span>
  )
}

/** Where the release's app build stands in App Store Connect, in words, with Apple's own states beside. */
function StorePanel({ store }: { readonly store: StoreBuild }) {
  const stage = storeStageOf(store)
  // Apple's state of its App Store version, unless the stage already says it in the same words.
  const appStore = store.appStoreState === undefined ? undefined : appleWords(store.appStoreState)
  const states = [
    ...(appStore === undefined || appStore.toLowerCase() === stage.words.toLowerCase()
      ? []
      : [{ label: "App Store", value: appStore }]),
    ...(store.internalTesting === undefined
      ? []
      : [{ label: "TestFlight, internal", value: appleWords(store.internalTesting) }]),
    ...(store.externalTesting === undefined
      ? []
      : [{ label: "TestFlight, external", value: appleWords(store.externalTesting) }]),
  ]
  return (
    <Panel
      icon={SmartphoneIcon}
      title="App Store Connect"
      subtitle={`Build ${store.buildNumber} of version ${store.version}`}
    >
      <div className="flex flex-col gap-3 px-5 py-5">
        <p className={cn("text-xl font-medium tracking-[-0.01em]", stage.failed && "text-failure")}>{stage.words}</p>
        {store.stage === "releasing" && store.phasedRelease?.day !== undefined && (
          <PhasedDays day={store.phasedRelease.day} />
        )}
        {states.length > 0 && (
          <dl className="grid max-w-xl grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-1 text-sm">
            {states.map((state) => (
              <div key={state.label} className="contents">
                <dt className="text-muted-foreground">{state.label}</dt>
                <dd>{state.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
      <PanelStats
        stats={[
          { label: "Uploaded", value: at(store.uploadedAt) },
          ...(store.phasedRelease?.startedAt === undefined
            ? []
            : [{ label: "Phased since", value: at(store.phasedRelease.startedAt) }]),
          ...(store.earliestReleaseAt === undefined
            ? []
            : [{ label: "Earliest release", value: at(store.earliestReleaseAt) }]),
        ]}
      />
    </Panel>
  )
}

// A row that opens a page on GitHub, marked as leaving the dashboard; a plain row without one.
function OutRow({ href, children }: { readonly href: string | undefined; readonly children: ReactNode }) {
  const row = "flex items-start gap-4 px-5 py-3"
  if (href === undefined) {
    return <div className={row}>{children}</div>
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={cn(row, "outline-none hover:bg-accent/60 focus-visible:bg-accent")}
    >
      {children}
      <ArrowUpRightIcon aria-hidden className="mt-1 size-4 shrink-0 text-muted-foreground" />
    </a>
  )
}

function PullRequests({ pullRequests }: { readonly pullRequests: ReadonlyArray<MergedPullRequest> }) {
  return (
    <ul className="divide-y">
      {pullRequests.map((pullRequest) => (
        <li key={pullRequest.number}>
          <OutRow href={pullRequest.url}>
            <span className="w-14 shrink-0 font-mono text-[15px] text-muted-foreground">#{pullRequest.number}</span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-[15px] wrap-anywhere">{pullRequest.title}</span>
              <span className="text-sm text-muted-foreground">
                {pullRequest.author}
                {pullRequest.labels.length > 0 && ` · ${pullRequest.labels.join(", ")}`}
              </span>
            </span>
          </OutRow>
        </li>
      ))}
    </ul>
  )
}

function Commits({ commits }: { readonly commits: ReadonlyArray<ChangedCommit> }) {
  return (
    <ul className="divide-y">
      {commits.map((commit) => (
        <li key={commit.sha}>
          <OutRow href={commit.url}>
            <span className="w-16 shrink-0 font-mono text-[15px] text-muted-foreground">{commit.sha.slice(0, 7)}</span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-[15px] wrap-anywhere">{commit.message}</span>
              <span className="text-sm text-muted-foreground">
                {commit.author} · <span className="font-mono">{at(commit.committedAt)}</span>
              </span>
            </span>
          </OutRow>
        </li>
      ))}
    </ul>
  )
}

// GitHub's page comparing two releases.
function CompareLink({ url, className }: { readonly url: string; readonly className?: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className={cn(buttonVariants({ variant: "outline", size: "sm" }), className)}
    >
      Compare on GitHub
      <ArrowUpRightIcon data-icon="inline-end" />
    </a>
  )
}

/**
 * What changed in the repository since the release before: its pull requests, each with its
 * number, title, author and labels, or, without any, its commits, the newest first; how many
 * commits and files, and lines added and removed, as far as they are known; and GitHub's comparison
 * of the two, one click away.
 */
function ChangesPanel({ previous, changes }: { readonly previous: string; readonly changes: ReleaseChanges }) {
  const listed = changes.pullRequests.length > 0 ? "pullRequests" : "commits"
  const cut = listed === "commits" && changes.commits.length < changes.totalCommits
  return (
    <Panel
      icon={GitPullRequestIcon}
      title={`Changes since ${previous}`}
      subtitle={changesCountOf(changes)}
      // On a phone the comparison closes the panel, so its title and counts keep the header's width.
      action={changes.url !== undefined && <CompareLink url={changes.url} className="hidden sm:inline-flex" />}
    >
      {listed === "pullRequests" ? (
        <PullRequests pullRequests={changes.pullRequests} />
      ) : (
        <Commits commits={changes.commits} />
      )}
      {cut && (
        <p className="border-t px-5 py-3 text-sm text-muted-foreground">
          The latest {count(changes.commits.length)} of {count(changes.totalCommits)} commits.
        </p>
      )}
      {listed === "commits" && changes.commits.length === 0 && (
        <p className="px-5 py-5 text-sm text-muted-foreground">No commits between the two.</p>
      )}
      {changes.url !== undefined && (
        <div className="border-t px-5 py-3 sm:hidden">
          <CompareLink url={changes.url} />
        </div>
      )}
    </Panel>
  )
}

/**
 * What changed since the release before, while it isn't known: without a repository linked, one
 * click to link it; with one, that the two releases' commits haven't both been found in it yet.
 */
function ChangesUnknown({
  previous,
  component,
  onLink,
}: {
  readonly previous: string
  readonly component: Component
  readonly onLink: () => void
}) {
  return (
    <Panel icon={GitPullRequestIcon} title={`Changes since ${previous}`} subtitle="Not known yet">
      <div className="flex flex-col gap-4 px-5 py-5">
        {component.repository === undefined ? (
          <>
            <p className="max-w-2xl text-[15px]">
              Link {component.key} to its GitHub repository to see the pull requests and commits since {previous}.
            </p>
            <Button variant="outline" size="sm" className="self-start" onClick={onLink}>
              Link the repository
            </Button>
          </>
        ) : (
          <p className="max-w-2xl text-[15px] text-muted-foreground">
            The commits of this release and of {previous} haven&apos;t both been found in{" "}
            <span className="font-mono">{component.repository}</span> yet.
          </p>
        )}
      </div>
    </Panel>
  )
}

// The areas a release opens in, filtered to it.
const areasOut = [
  { page: "performance", label: "Performance", icon: ActivityIcon },
  { page: "errors", label: "Errors", icon: BugIcon },
  { page: "logs", label: "Logs", icon: ScrollTextIcon },
] as const

/**
 * One release full screen, against the release before it: how it shipped (its commit, its store
 * build), each area of the project filtered to it and its environment one click away, its verdict,
 * when and how much it ran, the sources that failed lately for its component, and what changed in
 * its repository since; then what moved, each part shown only when
 * something did: the operations slower and failing more, the errors first seen in it, the incidents
 * that opened while it ran, the operations faster and failing less, and the operations new in it.
 * Each opens its own page.
 */
export function ReleasePage({
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
  const key: ReleaseScope = { project, component, release, ...(environment === undefined ? {} : { environment }) }
  const projectDetail = useAtomValue(projectAtom(project))
  const answer = useAtomValue(releaseAtom(key))
  const setPeriod = useAtomSet(periodAtom)
  const [linking, link] = useAtom(linkComponentAtom)
  const [linkingOpen, setLinkingOpen] = useState(false)
  const all = AsyncResult.isSuccess(projectDetail) ? projectDetail.value.components : []
  const components = all.map((entry) => entry.key)
  const linked = all.find((entry) => entry.key === component)
  const back: Route = { page: "releases", project }
  const where = environment === undefined ? component : `${component}, ${environment}`
  const notFound =
    AsyncResult.isFailure(answer) &&
    Option.exists(Cause.findErrorOption(answer.cause), (error) => error._tag === "ReleaseNotFound")
  const shown = AsyncResult.isSuccess(answer) ? answer.value : undefined
  const ran = shown === undefined ? undefined : ranOf(shown.detail.summary)
  const commit = shown?.detail.summary.commit
  // The release's own environment, which the areas it opens show.
  const ranIn = shown?.detail.summary.environment
  const releaseEnvironment = ranIn === undefined ? {} : { environment: ranIn }
  const operationOf = (operation: EnvelopeName): Route => ({ page: "operation", project, component, operation })
  const compared = (rows: ReadonlyArray<ComparedOperation>, moved: Moved) => (
    <ComparedTable rows={rows} moved={moved} linkOf={(row) => operationOf(row.operation)} />
  )
  const startLinking = () => {
    // A save from an earlier dialog isn't this one's.
    link(Atom.Reset)
    setLinkingOpen(true)
  }

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3 pb-2">
        <Link
          to={back}
          aria-label="Back to all releases"
          className={buttonVariants({ variant: "outline", size: "icon" })}
        >
          <ArrowLeftIcon />
        </Link>
        <div className="flex min-w-0 flex-[1_1_16rem] flex-col">
          <h1 className="font-mono text-2xl font-semibold tracking-[-0.02em] wrap-anywhere">{release}</h1>
          <p className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-muted-foreground">
            <span className="flex items-center gap-2">
              <span className="size-2 shrink-0" style={{ backgroundColor: colorOf(component, components) }} />
              {where}
            </span>
            {commit !== undefined && (
              <span className="flex min-w-0 items-center gap-2">
                <CommitName commit={commit} className="text-foreground" />
                {commit.message !== undefined && <span className="min-w-0 truncate">{commit.message}</span>}
              </span>
            )}
          </p>
        </div>
        {/* Each area of the project, filtered to this release, over the shortest period that covers it. */}
        {shown !== undefined && ran !== undefined && (
          <nav aria-label="This release in each area" className="flex flex-wrap gap-2">
            {areasOut.map((area) => (
              <Link
                key={area.page}
                to={{ page: area.page, project, component, release, ...releaseEnvironment }}
                onClick={() => setPeriod(periodCovering(ran.firstSeen, shown.asOf))}
                className={buttonVariants({ variant: "outline" })}
              >
                <area.icon data-icon="inline-start" />
                {area.label}
                <span className="sr-only"> of this release</span>
              </Link>
            ))}
          </nav>
        )}
      </header>

      {notFound ? (
        <Panel icon={SearchXIcon} title="There is no such release" subtitle={where}>
          <div className="flex flex-col gap-4 px-5 py-6">
            <p className="max-w-2xl text-[15px]">
              {component} has no release <span className="font-mono">{release}</span>
              {environment === undefined ? "" : ` in ${environment}`} that Cluenori knows of. The link may be mistyped,
              or from another project.
            </p>
            <Link to={back} className={buttonVariants({ variant: "outline", className: "self-start" })}>
              All releases
            </Link>
          </div>
        </Panel>
      ) : (
        <Loaded result={answer}>
          {({ detail, asOf }) => {
            const live = isLive(detail.summary, asOf)
            const previous = detail.summary.previous ?? "the release before"
            const { store } = detail.summary
            return (
              <div className="flex flex-col gap-4">
                <VerdictPanel project={project} detail={detail} live={live} />
                {store !== undefined && <StorePanel store={store} />}
                {detail.problems.length > 0 && (
                  <Panel
                    icon={TriangleAlertIcon}
                    title="Sources that failed"
                    subtitle="Until these are fixed, this release may lack its commit, what changed, or its store build"
                  >
                    <SourceProblems
                      problems={detail.problems}
                      asOf={asOf}
                      colorOf={(of) => colorOf(of, components)}
                      {...(linked === undefined ? {} : { onChangeLinks: startLinking })}
                    />
                  </Panel>
                )}
                {detail.changes !== undefined && <ChangesPanel previous={previous} changes={detail.changes} />}
                {detail.changes === undefined && detail.summary.previous !== undefined && linked !== undefined && (
                  <ChangesUnknown previous={detail.summary.previous} component={linked} onLink={startLinking} />
                )}
                {detail.slower.length > 0 && (
                  <Panel icon={GaugeIcon} title="Slower" subtitle={`p95 ${slowerWords} than in ${previous}`}>
                    {compared(detail.slower, { measure: "p95", worse: true })}
                  </Panel>
                )}
                {detail.failingMore.length > 0 && (
                  <Panel icon={CircleXIcon} title="Fails more" subtitle={`Failed ${failingWords} as in ${previous}`}>
                    {compared(detail.failingMore, { measure: "errorRate", worse: true })}
                  </Panel>
                )}
                {detail.newErrors.length > 0 && (
                  <Panel
                    icon={BugIcon}
                    title="New errors"
                    subtitle="First seen in this release, with how often they happened while it ran"
                  >
                    <ErrorList
                      groups={detail.newErrors}
                      now={live ? DateTime.toEpochMillis(asOf) : undefined}
                      colorOf={(of) => colorOf(of, components)}
                      stepsOf={() => undefined}
                      linkOf={(group) => ({ page: "error", project, component, error: group.id })}
                    />
                  </Panel>
                )}
                {detail.incidents.length > 0 && (
                  <Panel
                    icon={BellIcon}
                    title="Incidents while it ran"
                    subtitle="Opened while it ran: the open ones, and those resolved in the last 7 days"
                  >
                    <AttentionList
                      items={detail.incidents.map((incident) => ({
                        key: incident.id,
                        tone: toneOf(incident),
                        title: incident.title,
                        detail: incidentWhen(incident),
                        action: incidentActionOf(project, incident),
                      }))}
                    />
                  </Panel>
                )}
                {detail.faster.length > 0 && (
                  <Panel icon={ZapIcon} title="Faster" subtitle={`p95 in ${previous} was ${slowerWords}`}>
                    {compared(detail.faster, { measure: "p95", worse: false })}
                  </Panel>
                )}
                {detail.failingLess.length > 0 && (
                  <Panel icon={CircleCheckIcon} title="Fails less" subtitle={`${previous} failed ${failingWords}`}>
                    {compared(detail.failingLess, { measure: "errorRate", worse: false })}
                  </Panel>
                )}
                {detail.newOperations.length > 0 && (
                  <Panel icon={PlusIcon} title="New operations" subtitle={`Ran in this release, not in ${previous}`}>
                    <ul className="divide-y">
                      {detail.newOperations.map((operation) => (
                        <li key={operation}>
                          <Link
                            to={operationOf(operation)}
                            className="flex items-center gap-4 px-5 py-3 outline-none hover:bg-accent/60 focus-visible:bg-accent"
                          >
                            <OperationName name={operation} className="flex-1 text-[15px]" />
                            <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </Panel>
                )}
              </div>
            )
          }}
        </Loaded>
      )}

      {linked !== undefined && linkingOpen && (
        <LinksDialog
          component={linked}
          // Open until it is closed, or its save succeeds.
          open={!AsyncResult.isSuccess(linking)}
          onOpenChange={(open) => {
            if (!open) {
              setLinkingOpen(false)
            }
          }}
          saving={linking}
          onSave={(links) => link({ project, component, links })}
        />
      )}
    </div>
  )
}
