import type { ComponentKey, EnvelopeName, EnvironmentKey, ProjectKey, ReleaseVersion } from "@cluenori/foundation"
import { Period } from "@cluenori/foundation"
import type { Incident } from "@cluenori/incidents"
import type { Member } from "@cluenori/members"
import type { Component, DeployTarget } from "@cluenori/projects"
import type {
  ChangedCommit,
  ComparedOperation,
  LifeTotals,
  MergedPullRequest,
  Promotion,
  ReleaseChanges,
  ReleaseDetail,
  ReleaseLife,
  ReleaseNote,
  StoreBuild,
  Verdict,
} from "@cluenori/releases"
import { comparedFrom, DraftUnavailable, failingMoreRule, judgedAfterMs } from "@cluenori/releases"
import type { ErrorGroupId } from "@cluenori/signals"
import { slowerRule } from "@cluenori/signals"
import { useAtom, useAtomRefresh, useAtomValue, useAtomSet } from "@effect/atom-react"
import { cn } from "cn"
import { Cause, DateTime, Exit, Option, Schema } from "effect"
import { Atom, AsyncResult } from "effect/reactivity"
import {
  ActivityIcon,
  ArrowLeftIcon,
  ArrowUpRightIcon,
  BellIcon,
  BugIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  GaugeIcon,
  GitCompareArrowsIcon,
  GitPullRequestIcon,
  NotebookPenIcon,
  RocketIcon,
  SearchXIcon,
  SmartphoneIcon,
  TriangleAlertIcon,
} from "lucide-react"
import type { ReactNode } from "react"
import { Fragment, lazy, Suspense, useEffect, useState } from "react"

import { useEnvironments } from "@/hooks/use-environments"
import { failureColor, warningColor } from "@/lib/colors"
import { count, duration, moment, ratio, share } from "@/lib/format"
import type { ReleaseScope } from "@/project-data"
import {
  deliveryAtom,
  draftNotesAtom,
  linkComponentAtom,
  meAtom,
  membersAtom,
  periodAtom,
  projectAtom,
  promoteAtom,
  releaseApprovedAtom,
  releaseAtom,
  saveNotesAtom,
} from "@/project-data"
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
  zoneOf,
} from "@/project-facts"
import type { ThereNow, WherePart } from "@/release-facts"
import {
  draftEnvironmentOf,
  isFollowing,
  nextStepWords,
  promotionNextOf,
  promotionStates,
  promotionsAskedEveryMs,
  promotionsShown,
  rateOf,
  rateUnitOf,
  livedWords,
  releaseBriefOf,
  shipsWithOptionsOf,
  sinceWords,
  starterOf,
  thereNowOf,
  whereItRunsOf,
} from "@/release-facts"
import type { Route } from "@/router"
import { Link } from "@/router"
import type { Attention } from "@/views/attention-list"
import { AttentionList } from "@/views/attention-list"
import { CommitName } from "@/views/commit-name"
import type { Moved } from "@/views/compared-table"
import { ComparedTable } from "@/views/compared-table"
import { CopyButton } from "@/views/copy-button"
import { ErrorList } from "@/views/error-list"
import { LifeChart, stepWords } from "@/views/life-chart"
import { LinksDialog } from "@/views/links-dialog"
import { failureText, Loaded } from "@/views/loaded"
import type { DraftOutcome, SaveOutcome } from "@/views/notes-editor"
import { NotesEditor } from "@/views/notes-editor"
import { OperationName } from "@/views/operation-name"
import { Panel, PanelStats } from "@/views/panel"
import { PromotionList } from "@/views/promotion-list"
import { verdictClass } from "@/views/release-list"
import { ReleaseNowDialog } from "@/views/release-now-dialog"
import { SourceProblems } from "@/views/source-problems"
import { Button, buttonVariants } from "@/views/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/views/ui/dropdown-menu"

// Promoting loads when it is asked for, now and then.
const PromoteDialog = lazy(() => import("@/views/promote-dialog").then((module) => ({ default: module.PromoteDialog })))

const isDraftUnavailable = Schema.is(DraftUnavailable)

// Why no draft was written: the API's reason when it gave one, else what failed.
const draftProblemOf = (cause: Cause.Cause<unknown>) => {
  const error = Option.getOrUndefined(Cause.findErrorOption(cause))
  return isDraftUnavailable(error) ? error.reason : failureText(cause)
}

// Where the notes editor is, which promoting to an App Store Connect app leads to.
const notesEditorId = "release-notes"

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

/** A number of the release beside the release before's, and the page that shows what is behind it. */
type Compared = {
  readonly label: string
  readonly value: string
  /** The release before's, in the same unit; absent without one. */
  readonly before?: string
  readonly color?: string
  readonly to?: Route
}

// A rate a person reads at a glance: "4,130", "12", "0.4".
const rateText = (value: number) => (value > 0 && value < 10 ? ratio(value) : count(Math.round(value)))

// The share of a life's requests that failed; unknown without requests.
const failedShareOf = (of: LifeTotals) =>
  of.requests === undefined || of.failed === undefined ? undefined : share(of.failed, of.requests)

// The release before's number, when there is one.
const beside = (before: string | undefined) => (before === undefined ? {} : { before })

// Why an answer covers what it does, under its title.
const answerSubtitle = (lived: string | undefined, previous: string | undefined) => {
  if (lived !== undefined) {
    return `Its whole life, ${lived}${previous === undefined ? "" : ", beside the release before's"}`
  }
  return previous === undefined
    ? "No release of it was known before this one"
    : "The release before it, of the same component and environment"
}

/**
 * A release's numbers over its whole life, each beside the release before's over its own: its
 * app's people, its requests and how many failed, its warnings and errors, each counted an hour or
 * a day of its life so lives of different lengths compare, and how long it ran; each only when its
 * telemetry sent it, and each leading to what is behind it.
 */
const comparedOf = (
  life: ReleaseLife,
  routes: { readonly people?: Route; readonly requests: Route; readonly logs: Route },
) => {
  const { totals, previous } = life
  const unit = rateUnitOf(totals)
  const rate = (of: LifeTotals, value: number | undefined) =>
    value === undefined ? undefined : rateText(rateOf(value, of, unit.ms))
  const failed = failedShareOf
  const numbers: ReadonlyArray<Compared | undefined> = [
    totals.people === undefined
      ? undefined
      : {
          label: "People",
          value: count(totals.people),
          ...beside(previous?.people === undefined ? undefined : count(previous.people)),
          ...(routes.people === undefined ? {} : { to: routes.people }),
        },
    totals.requests === undefined
      ? undefined
      : {
          label: `Requests ${unit.words}`,
          value: rate(totals, totals.requests) ?? "",
          ...beside(previous === undefined ? undefined : rate(previous, previous.requests)),
          to: routes.requests,
        },
    failed(totals) === undefined
      ? undefined
      : {
          label: "Failed",
          value: failed(totals) ?? "",
          ...beside(previous === undefined ? undefined : failed(previous)),
          ...((totals.failed ?? 0) > 0 ? { color: failureColor } : {}),
          to: routes.requests,
        },
    totals.warnings === undefined
      ? undefined
      : {
          label: `Warnings ${unit.words}`,
          value: rate(totals, totals.warnings) ?? "",
          ...beside(previous === undefined ? undefined : rate(previous, previous.warnings)),
          ...(totals.warnings > 0 ? { color: warningColor } : {}),
          to: routes.logs,
        },
    totals.errors === undefined
      ? undefined
      : {
          label: `Errors ${unit.words}`,
          value: rate(totals, totals.errors) ?? "",
          ...beside(previous === undefined ? undefined : rate(previous, previous.errors)),
          ...(totals.errors > 0 ? { color: failureColor } : {}),
          to: routes.logs,
        },
    {
      label: "Ran for",
      value: livedWords(totals),
      ...beside(previous === undefined ? undefined : livedWords(previous)),
    },
  ]
  return numbers.filter((number) => number !== undefined)
}

/** The release's numbers in a strip, each over the release before's, each a link to what is behind it. */
function ComparedNumbers({
  numbers,
  previous,
  onOpen,
}: {
  readonly numbers: ReadonlyArray<Compared>
  readonly previous: string | undefined
  /** Before a number's page opens: its period is set to cover the release. */
  readonly onOpen: () => void
}) {
  return (
    <dl className="mt-auto grid grid-cols-2 border-t sm:auto-cols-fr sm:grid-flow-col sm:grid-cols-none [&>div]:border-b sm:[&>div]:border-b-0 sm:[&>div+div]:border-l">
      {numbers.map((number) => {
        const value = (
          <span
            className="truncate font-mono text-lg"
            style={number.color === undefined ? {} : { color: number.color }}
          >
            {number.value}
          </span>
        )
        return (
          <div key={number.label} className="flex min-w-0 flex-col gap-1 px-5 py-4 odd:border-r sm:odd:border-r-0">
            <dt className="truncate text-sm text-muted-foreground">{number.label}</dt>
            <dd className="flex min-w-0 flex-col">
              {number.to === undefined ? (
                value
              ) : (
                <Link
                  to={number.to}
                  onClick={onOpen}
                  className="flex min-w-0 underline-offset-4 outline-none hover:underline focus-visible:underline"
                >
                  {value}
                </Link>
              )}
              {number.before !== undefined && previous !== undefined && (
                <span className="truncate font-mono text-[13px] text-muted-foreground" title={`In ${previous}`}>
                  before {number.before}
                </span>
              )}
            </dd>
          </div>
        )
      })}
    </dl>
  )
}

/**
 * The answer first: how the release compares with the one before it, in words and what that means;
 * then its numbers over its whole life beside the release before's.
 */
function AnswerPanel({
  project,
  detail,
  live,
  routes,
  onOpen,
}: {
  readonly project: ProjectKey
  readonly detail: ReleaseDetail
  readonly live: boolean
  readonly routes: Parameters<typeof comparedOf>[1]
  readonly onOpen: () => void
}) {
  const { summary, life } = detail
  const verdict = verdictOf(summary)
  const previous = summary.previous
  const lived = life === undefined ? undefined : `${at(life.totals.from)} to ${live ? "now" : at(life.totals.to)}`
  return (
    <Panel
      icon={GitCompareArrowsIcon}
      title={previous === undefined ? "Nothing to compare with" : `Against ${previous}`}
      subtitle={answerSubtitle(lived, previous)}
      action={
        previous !== undefined && (
          <Link
            to={releaseRouteOf(project, { ...summary, release: previous })}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "hidden sm:inline-flex")}
          >
            Open {previous.length > 18 ? "the release before" : previous}
          </Link>
        )
      }
    >
      <div className="flex flex-col gap-1.5 px-5 py-5">
        <p className={cn("text-xl font-medium tracking-[-0.01em]", verdictClass[verdict.tone])}>{verdict.words}</p>
        <p className="max-w-3xl text-sm text-pretty text-muted-foreground">
          {summary.verdict === "unmeasured" && life !== undefined
            ? "It sent no operations, so there is nothing to compare: its app's people are counted below."
            : verdictMeaning[summary.verdict]}
        </p>
        {previous !== undefined && (
          <Link
            to={releaseRouteOf(project, { ...summary, release: previous })}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-2.5 self-start sm:hidden")}
          >
            Open the release before
          </Link>
        )}
      </div>
      {life !== undefined && <ComparedNumbers numbers={comparedOf(life, routes)} previous={previous} onOpen={onOpen} />}
    </Panel>
  )
}

/**
 * The errors a release logged over its whole life, the most frequent first, those first seen in it
 * marked new, each opening its error; then how many warnings it logged, one click from its lines.
 * A release that logged nothing says so.
 */
function ErrorsPanel({
  detail,
  colorOf: colorOfComponent,
  routes,
  linkOf,
  onOpen,
}: {
  readonly detail: ReleaseDetail
  readonly colorOf: (component: string) => string
  readonly routes: { readonly errors: Route; readonly logs: Route }
  readonly linkOf: (error: ErrorGroupId) => Route
  readonly onOpen: () => void
}) {
  const { summary, life, errors } = detail
  const totals = life?.totals
  const fresh = errors.filter((group) => group.firstRelease === summary.release).length
  return (
    <Panel
      icon={BugIcon}
      title="Errors and warnings"
      subtitle={
        errors.length === 0
          ? "Over its whole life"
          : `${count(errors.length)} ${errors.length === 1 ? "error" : "errors"}${fresh > 0 ? `, ${count(fresh)} new in it` : ""}, the most frequent first`
      }
      action={
        <Link to={routes.errors} onClick={onOpen} className={buttonVariants({ variant: "outline", size: "sm" })}>
          Open in Errors
        </Link>
      }
    >
      {errors.length === 0 ? (
        <p className="px-5 py-5 text-sm text-muted-foreground">No errors logged in its whole life.</p>
      ) : (
        // Each error opens over a period that covers the release.
        <div onClickCapture={onOpen}>
          <ErrorList
            groups={errors}
            now={undefined}
            isNew={(group) => group.firstRelease === summary.release}
            colorOf={colorOfComponent}
            stepsOf={() => undefined}
            linkOf={(group) => linkOf(group.id)}
          />
        </div>
      )}
      {totals?.warnings !== undefined && (
        <p className="mt-auto flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t px-5 py-3 text-sm text-muted-foreground">
          <span>
            {totals.warnings === 0
              ? "No warnings"
              : `${count(totals.warnings)} ${totals.warnings === 1 ? "warning" : "warnings"}`}
            {totals.logsFrom === undefined
              ? " in its whole life."
              : ` since ${at(totals.logsFrom)}: older ones aren't kept.`}
          </span>
          <Link
            to={routes.logs}
            onClick={onOpen}
            className="text-foreground underline-offset-4 outline-none hover:underline focus-visible:underline"
          >
            Open in Logs
          </Link>
        </p>
      )}
    </Panel>
  )
}

/**
 * Its operations against the release before: those that got slower or fail more first, in color,
 * then those that got faster or fail less, and those new in it, each opening its operation; or, when
 * nothing moved, that nothing did, with the rule.
 */
function OperationsPanel({
  detail,
  linkOf,
  requests,
  onOpen,
}: {
  readonly detail: ReleaseDetail
  readonly linkOf: (operation: EnvelopeName) => Route
  readonly requests: Route
  readonly onOpen: () => void
}) {
  const previous = detail.summary.previous
  const groups: ReadonlyArray<{
    readonly title: string
    readonly rows: ReadonlyArray<ComparedOperation>
    readonly moved: Moved
  }> = [
    { title: "Slower", rows: detail.slower, moved: { measure: "p95", worse: true } },
    { title: "Fails more", rows: detail.failingMore, moved: { measure: "errorRate", worse: true } },
    { title: "Faster", rows: detail.faster, moved: { measure: "p95", worse: false } },
    { title: "Fails less", rows: detail.failingLess, moved: { measure: "errorRate", worse: false } },
  ]
  const moved = groups.filter((group) => group.rows.length > 0)
  return (
    <Panel
      icon={GaugeIcon}
      title="Requests"
      subtitle={previous === undefined ? "Its operations" : `Its operations against ${previous}`}
      action={
        <Link to={requests} onClick={onOpen} className={buttonVariants({ variant: "outline", size: "sm" })}>
          Open in Performance
        </Link>
      }
    >
      {moved.map((group) => (
        <section key={group.title} aria-label={group.title} className="border-b last:border-b-0">
          <p className="px-5 pt-3 text-sm font-medium text-muted-foreground">{group.title}</p>
          <ComparedTable rows={group.rows} moved={group.moved} linkOf={(row) => linkOf(row.operation)} />
        </section>
      ))}
      {detail.newOperations.length > 0 && (
        <section aria-label="New operations" className="border-b last:border-b-0">
          <p className="px-5 pt-3 text-sm font-medium text-muted-foreground">New operations</p>
          <ul className="divide-y">
            {detail.newOperations.map((operation) => (
              <li key={operation}>
                <Link
                  to={linkOf(operation)}
                  className="flex items-center gap-4 px-5 py-3 outline-none hover:bg-accent/60 focus-visible:bg-accent"
                >
                  <OperationName name={operation} className="flex-1 text-[15px]" />
                  <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {moved.length === 0 && detail.newOperations.length === 0 && (
        <p className="px-5 py-5 text-sm text-pretty text-muted-foreground">
          {previous === undefined
            ? "There is no release before it to compare its operations with."
            : `Nothing moved against ${previous}: no operation's p95 is ${slowerWords} than before, or fails ${failingWords}, or the other way.`}
        </p>
      )}
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

/**
 * A release's promotions, the latest first; one approved in App Store review one click from being
 * released. Promoting it is the page header's. Without promotions it says so; without deploy
 * targets either, a quiet line says how to add one, one click from the component's links when the
 * page can change them; nothing for a component that ships with another, as the header says so.
 */
function PromotionsPanel({
  hasTargets,
  shipsWithAnother,
  promotions,
  asOf,
  starterOf: starterOfPromotion,
  onReleaseNow,
  onLink,
}: {
  readonly hasTargets: boolean
  /** Whether its component ships with another, whose deploys deploy it. */
  readonly shipsWithAnother: boolean
  readonly promotions: ReadonlyArray<Promotion>
  readonly asOf: DateTime.Utc
  readonly starterOf: (promotion: Promotion) => string
  readonly onReleaseNow: (promotion: Promotion) => void
  readonly onLink: (() => void) | undefined
}) {
  if (!hasTargets && promotions.length === 0) {
    return shipsWithAnother ? null : (
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-sm text-muted-foreground">
        <span>Add a deploy target to promote releases from here.</span>
        {onLink !== undefined && (
          <Button variant="link" size="sm" className="h-auto px-0 text-sm" onClick={onLink}>
            Change links
          </Button>
        )}
      </p>
    )
  }
  return (
    <Panel icon={RocketIcon} title="Promotions" subtitle="Deploys started from Cluenori, the latest first">
      {promotions.length === 0 ? (
        <p className="px-5 py-5 text-sm text-muted-foreground">Not promoted from Cluenori yet.</p>
      ) : (
        <PromotionList promotions={promotions} now={asOf} starterOf={starterOfPromotion} onReleaseNow={onReleaseNow} />
      )}
    </Panel>
  )
}

/** Where a release runs now, in a sentence: "In dev since 13:57 · not in prod yet". */
function WhereItRuns({ parts, asOf }: { readonly parts: ReadonlyArray<WherePart>; readonly asOf: DateTime.Utc }) {
  const words = (part: WherePart, first: boolean) => {
    switch (part._tag) {
      case "runs":
        return (
          <>
            {first ? "In" : "in"} {part.environment} since{" "}
            <span className="font-mono">{sinceWords(part.since, asOf)}</span>
          </>
        )
      case "nowhere":
        return "Not in any environment now"
      case "going":
        return `going to ${part.environment}: ${promotionStates[part.state].words}`
      case "notYet":
        return `not in ${part.environment} yet`
      case "other":
        return (
          <>
            {part.environment} runs <span className="font-mono">{part.release}</span>
          </>
        )
      case "nothing":
        return `nothing in ${part.environment} yet`
    }
  }
  return (
    <p className="text-[15px] text-pretty">
      {parts.map((part, index) => (
        <Fragment key={index}>
          {index > 0 && <span className="text-muted-foreground"> · </span>}
          {words(part, index === 0)}
        </Fragment>
      ))}
    </p>
  )
}

/**
 * Promoting a release to an environment it isn't the next step for, such as back to one that has
 * moved on: a menu of its component's deploy targets, each saying what runs there now. Choosing one
 * opens the confirmation, which says what it replaces.
 */
function PromoteElsewhere({
  release,
  targets,
  thereNowOf: thereNowIn,
  primary,
  onPick,
}: {
  readonly release: ReleaseVersion
  readonly targets: ReadonlyArray<DeployTarget>
  readonly thereNowOf: (environment: EnvironmentKey) => ThereNow | undefined
  /** Whether the page has a primary action, so this promotes to another environment. */
  readonly primary: boolean
  readonly onPick: (target: DeployTarget) => void
}) {
  const there = (environment: EnvironmentKey) => {
    const now = thereNowIn(environment)
    if (now === undefined) {
      return undefined
    }
    if (now._tag === "nothing") {
      return "nothing there yet"
    }
    return now.release === release ? "runs it now" : `runs ${now.release} now`
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" />}>
        {primary ? "Promote to another environment" : "Promote to an environment"}
        <ChevronDownIcon data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Promote {release} to</DropdownMenuLabel>
          {targets.map((target) => (
            <DropdownMenuItem key={target.environment} onClick={() => onPick(target)}>
              {target.environment}{" "}
              {there(target.environment) !== undefined && (
                <span className="ml-auto truncate pl-3 text-muted-foreground">{there(target.environment)}</span>
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * A release's notes for its users, where an app's build takes them: shown for a component with an
 * App Store Connect app, or a release that has notes. Drafting asks for where the release goes.
 */
function NotesPanel({
  notes,
  targets,
  onDraft,
  onSave,
}: {
  readonly notes: ReadonlyArray<ReleaseNote>
  readonly targets: ReadonlyArray<DeployTarget>
  readonly onDraft: (environment: DeployTarget["environment"]) => Promise<DraftOutcome>
  readonly onSave: (notes: ReadonlyArray<ReleaseNote>) => Promise<SaveOutcome>
}) {
  return (
    // The notes editor is where promoting to an App Store Connect app leads.
    <div id={notesEditorId} tabIndex={-1} className="scroll-mt-4 outline-none">
      <Panel
        icon={NotebookPenIcon}
        title="Release notes"
        subtitle="What's New on the App Store and What to Test in TestFlight, one for each language"
      >
        <NotesEditor
          notes={notes}
          draftEnvironments={targets.map((target) => target.environment)}
          defaultDraftEnvironment={draftEnvironmentOf(targets)}
          onDraft={onDraft}
          onSave={onSave}
        />
      </Panel>
    </div>
  )
}

/** The deployment's members, for an owner's page to name who did what; none while they load. */
function WithMembers({ children }: { readonly children: (members: ReadonlyArray<Member> | undefined) => ReactNode }) {
  const members = useAtomValue(membersAtom)
  return children(AsyncResult.isSuccess(members) ? members.value.members : undefined)
}

/**
 * One release, an item: its whole life, whatever any period, against the release before it
 * (`concept/Experience.md`). The answer first, how it compares and its numbers beside the release
 * before's; then its life step by step, its errors and warnings, its requests, and what changed;
 * then how it ships: its promotions (first while one moves), notes, store build and the sources
 * that failed. Each number opens what is behind it, and "Copy for an agent" hands the release to an
 * agent with the commands that read all of it.
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
  const delivery = useAtomValue(deliveryAtom(project))
  const askDeliveryAgain = useAtomRefresh(deliveryAtom(project))
  const setPeriod = useAtomSet(periodAtom)
  const [linking, link] = useAtom(linkComponentAtom)
  const [linkingOpen, setLinkingOpen] = useState(false)
  const environments = useEnvironments(project, environment)
  const me = useAtomValue(meAtom)
  const myself = AsyncResult.isSuccess(me) ? me.value : undefined
  const owner = myself?.role === "owner"
  const [promoting, promote] = useAtom(promoteAtom)
  // The target being confirmed, what runs there now, and how many times one was: each confirmation
  // starts fresh.
  const [confirming, setConfirming] = useState<
    { readonly target: DeployTarget; readonly thereNow: ThereNow | undefined; readonly count: number } | undefined
  >(undefined)
  const [releasing, releaseNow] = useAtom(releaseApprovedAtom)
  const [releasingOne, setReleasingOne] = useState<Promotion | undefined>(undefined)
  const draftNotes = useAtomSet(draftNotesAtom, { mode: "promiseExit" })
  const saveNotes = useAtomSet(saveNotesAtom, { mode: "promiseExit" })
  const askAgain = useAtomRefresh(releaseAtom(key))
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
  const gitHubRelease = shown?.detail.gitHubRelease
  // The release's own environment, which the pages its numbers open show.
  const ranIn = shown?.detail.summary.environment
  const releaseEnvironment = ranIn === undefined ? {} : { environment: ranIn }
  const operationOf = (operation: EnvelopeName): Route => ({ page: "operation", project, component, operation })
  const startLinking = () => {
    // A save from an earlier dialog isn't this one's.
    link(Atom.Reset)
    setLinkingOpen(true)
  }
  // Where the release runs now, by its component's delivery, and its one next step, if any.
  const delivered = AsyncResult.isSuccess(delivery)
    ? delivery.value.delivery.components.find((each) => each.component === component)
    : undefined
  const next = delivered === undefined ? undefined : promotionNextOf(delivered, release)
  const startPromoting = (target: DeployTarget) => {
    // An answer to an earlier promotion isn't this one's.
    promote(Atom.Reset)
    setConfirming((last) => ({
      target,
      thereNow: delivered === undefined ? undefined : thereNowOf(delivered, target.environment),
      count: (last?.count ?? 0) + 1,
    }))
  }
  const startReleasing = (promotion: Promotion) => {
    releaseNow(Atom.Reset)
    setReleasingOne(promotion)
  }
  // From the promote dialog to the notes editor: the dialog closes, then the editor is scrolled to.
  const openNotes = () => {
    setConfirming(undefined)
    window.setTimeout(() => {
      const editor = document.getElementById(notesEditorId)
      editor?.scrollIntoView({ block: "start" })
      editor?.focus({ preventScroll: true })
    }, 0)
  }
  const draft = (draftFor: DeployTarget["environment"]): Promise<DraftOutcome> =>
    draftNotes({ release: key, environment: draftFor }).then((exit) =>
      Exit.isSuccess(exit)
        ? { _tag: "drafted", draft: exit.value }
        : { _tag: "unavailable", reason: draftProblemOf(exit.cause) },
    )
  const save = (notes: ReadonlyArray<ReleaseNote>): Promise<SaveOutcome> =>
    saveNotes({ release: key, notes }).then((exit) =>
      Exit.isSuccess(exit) ? { _tag: "saved" } : { _tag: "failed", problem: failureText(exit.cause) },
    )
  // A promotion of this release just started, shown at once, before the release's answer has it.
  const started =
    AsyncResult.isSuccess(promoting) && promoting.value.component === component && promoting.value.release === release
      ? promoting.value
      : undefined
  const promotions = shown === undefined ? [] : promotionsShown(shown.detail.promotions, started)
  // Others' promotions name who started them, by the members' emails, which an owner may read.
  const byOthers = promotions.some(
    (promotion) => promotion.startedBy !== undefined && promotion.startedBy !== myself?.id,
  )
  const following = isFollowing(promotions)
  // The component it ships with, whose deploys deploy it, and its release of the same version.
  const shipsWith =
    linked?.shipsWith === undefined
      ? undefined
      : {
          component: linked.shipsWith,
          route: {
            page: "release" as const,
            project,
            component: linked.shipsWith,
            release,
            ...(environment === undefined ? {} : { environment }),
          },
        }

  // While a promotion runs, its state is asked for again: Cluenori asks GitHub each minute.
  useEffect(() => {
    if (!following) {
      return
    }
    const timer = window.setInterval(() => {
      askAgain()
      askDeliveryAgain()
    }, promotionsAskedEveryMs)
    return () => window.clearInterval(timer)
  }, [following, askAgain, askDeliveryAgain])

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-wrap items-start gap-x-4 gap-y-3 pb-2">
        <Link
          to={back}
          aria-label="Back to all releases"
          className={buttonVariants({ variant: "outline", size: "icon", className: "mt-0.5" })}
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
            {gitHubRelease !== undefined && (
              <a
                href={gitHubRelease.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-foreground underline-offset-4 outline-none hover:underline focus-visible:underline"
              >
                Release on GitHub
                <ArrowUpRightIcon aria-hidden className="size-3.5" />
              </a>
            )}
            {shown?.detail.summary.deployedAt !== undefined && (
              <span>Deployed {at(shown.detail.summary.deployedAt)}</span>
            )}
          </p>
          {/* Where it runs now, and what can be done with it: its one next step, and promoting it elsewhere. */}
          {!notFound && (
            <div className="mt-3 flex flex-col gap-3">
              {delivered !== undefined && AsyncResult.isSuccess(delivery) && (
                <WhereItRuns parts={whereItRunsOf(delivered, release)} asOf={delivery.value.asOf} />
              )}
              {AsyncResult.isFailure(delivery) && (
                <p className="text-sm text-muted-foreground">
                  Where it runs now isn&apos;t known: {failureText(delivery.cause)}
                </p>
              )}
              {shipsWith !== undefined && (
                <p className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
                  <span>Ships with {shipsWith.component}: its deploys deploy this release too.</span>
                  <Link to={shipsWith.route} className={buttonVariants({ variant: "outline", size: "sm" })}>
                    Open {shipsWith.component} {release}
                  </Link>
                </p>
              )}
              {shown !== undefined && shown.detail.deployTargets.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {next !== undefined && (
                    <Button
                      className="h-auto min-h-9 py-1.5 text-left whitespace-normal"
                      onClick={() => startPromoting(next.target)}
                    >
                      <RocketIcon data-icon="inline-start" />
                      {nextStepWords({ _tag: "promote", release, from: next.from }, next.target.environment)}
                    </Button>
                  )}
                  {shown.detail.deployTargets.some((target) => target.environment !== next?.target.environment) && (
                    <PromoteElsewhere
                      release={release}
                      targets={shown.detail.deployTargets.filter(
                        (target) => target.environment !== next?.target.environment,
                      )}
                      thereNowOf={(there) => (delivered === undefined ? undefined : thereNowOf(delivered, there))}
                      primary={next !== undefined}
                      onPick={startPromoting}
                    />
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        {shown !== undefined && (
          <div className="flex flex-wrap items-center gap-2">
            <CopyButton text={releaseBriefOf(project, shown.detail)} label="Copy for an agent" />
          </div>
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
            const { store } = detail.summary
            const filters = { project, component, release, ...releaseEnvironment }
            const routes = {
              requests: { page: "performance", ...filters } satisfies Route,
              errors: { page: "errors", ...filters } satisfies Route,
              logs: { page: "logs", ...filters } satisfies Route,
              ...(detail.life?.totals.people === undefined
                ? {}
                : { people: { page: "appRelease", ...filters } satisfies Route }),
            }
            // A page of numbers opened from here shows the whole release: the shortest period that covers it.
            const life = detail.life
            const coverIt = () => {
              if (life !== undefined) {
                setPeriod(periodCovering(life.totals.from, asOf))
              }
            }
            const promotionsPanel =
              owner && byOthers ? (
                <WithMembers>
                  {(members) => (
                    <PromotionsPanel
                      hasTargets={detail.deployTargets.length > 0}
                      shipsWithAnother={shipsWith !== undefined}
                      promotions={promotions}
                      asOf={asOf}
                      starterOf={(promotion) => starterOf(promotion.startedBy, myself?.id, members)}
                      onReleaseNow={startReleasing}
                      onLink={linked === undefined ? undefined : startLinking}
                    />
                  )}
                </WithMembers>
              ) : (
                <PromotionsPanel
                  hasTargets={detail.deployTargets.length > 0}
                  shipsWithAnother={shipsWith !== undefined}
                  promotions={promotions}
                  asOf={asOf}
                  starterOf={(promotion) => starterOf(promotion.startedBy, myself?.id, undefined)}
                  onReleaseNow={startReleasing}
                  onLink={linked === undefined ? undefined : startLinking}
                />
              )
            return (
              <div className="flex flex-col gap-4">
                {following && promotionsPanel}
                <AnswerPanel project={project} detail={detail} live={live} routes={routes} onOpen={coverIt} />
                {life !== undefined && (
                  <Panel
                    icon={ActivityIcon}
                    title="Its life"
                    subtitle={`${stepWords[life.step]}, from when it started to ${live ? "now" : "when it stopped"}`}
                    badge={
                      life.step === "1d"
                        ? "UTC"
                        : zoneOf({ covered: new Period({ from: life.totals.from, to: life.totals.to }) })
                    }
                  >
                    <LifeChart life={life} />
                  </Panel>
                )}
                {ran !== undefined && (
                  <>
                    <ErrorsPanel
                      detail={detail}
                      colorOf={(of) => colorOf(of, components)}
                      routes={routes}
                      linkOf={(error) => ({ page: "error", ...filters, error })}
                      onOpen={coverIt}
                    />
                    <OperationsPanel detail={detail} linkOf={operationOf} requests={routes.requests} onOpen={coverIt} />
                  </>
                )}
                {detail.changes !== undefined && (
                  <ChangesPanel previous={detail.summary.previous ?? "the release before"} changes={detail.changes} />
                )}
                {detail.changes === undefined && detail.summary.previous !== undefined && linked !== undefined && (
                  <ChangesUnknown previous={detail.summary.previous} component={linked} onLink={startLinking} />
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
                {!following && promotionsPanel}
                {(detail.notes.length > 0 || detail.deployTargets.some((target) => target.appStore !== undefined)) && (
                  <NotesPanel notes={detail.notes} targets={detail.deployTargets} onDraft={draft} onSave={save} />
                )}
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
              </div>
            )
          }}
        </Loaded>
      )}

      {confirming !== undefined && (
        <Suspense fallback={null}>
          <PromoteDialog
            key={confirming.count}
            release={release}
            target={confirming.target}
            thereNow={confirming.thereNow}
            repository={shown?.detail.repository}
            notes={shown?.detail.notes ?? []}
            owner={owner}
            // Open until it is closed, or the promotion started.
            open={!AsyncResult.isSuccess(promoting)}
            onOpenChange={(open) => {
              if (!open) {
                setConfirming(undefined)
              }
            }}
            promoting={promoting}
            onPromote={(input) => promote({ release: key, environment: confirming.target.environment, ...input })}
            onOpenNotes={openNotes}
            {...(linked === undefined
              ? {}
              : {
                  onChangeLinks: () => {
                    setConfirming(undefined)
                    startLinking()
                  },
                })}
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
          onRelease={() => releaseNow({ release: key, promotion: releasingOne.id })}
        />
      )}

      {linked !== undefined && linkingOpen && (
        <LinksDialog
          component={linked}
          shipsWithOptions={shipsWithOptionsOf(all, linked.key)}
          environments={
            environments === undefined ? [] : [...new Set([...environments.production, ...environments.offered])]
          }
          // Open until it is closed, or its save succeeds.
          open={!AsyncResult.isSuccess(linking)}
          onOpenChange={(open) => {
            if (!open) {
              setLinkingOpen(false)
            }
          }}
          saving={linking}
          onSave={(links) => link({ project, component, links, release: key })}
        />
      )}
    </div>
  )
}
