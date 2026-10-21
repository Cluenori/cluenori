import type { ComponentKey, EnvelopeName, EnvironmentKey, ProjectKey, ReleaseVersion } from "@cluenori/foundation"
import type { Incident } from "@cluenori/incidents"
import type { ComparedOperation, ReleaseDetail, Verdict } from "@cluenori/releases"
import { comparedFrom, failingMoreRule, judgedAfterMs } from "@cluenori/releases"
import { slowerRule } from "@cluenori/signals"
import { useAtomValue } from "@effect/atom-react"
import { cn } from "cn"
import { Cause, DateTime, Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import {
  ArrowLeftIcon,
  BellIcon,
  BugIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  CircleXIcon,
  GaugeIcon,
  GitCompareArrowsIcon,
  PlusIcon,
  SearchXIcon,
  ZapIcon,
} from "lucide-react"

import { liveColor } from "@/lib/colors"
import { count, duration, moment, share } from "@/lib/format"
import type { ReleaseScope } from "@/project-data"
import { releaseAtom, useComponentKeys } from "@/project-data"
import { colorOf, incidentActionOf, isLive, releaseRouteOf, verdictOf } from "@/project-facts"
import type { Route } from "@/router"
import { Link } from "@/router"
import type { Attention } from "@/views/attention-list"
import { AttentionList } from "@/views/attention-list"
import type { Moved } from "@/views/compared-table"
import { ComparedTable } from "@/views/compared-table"
import { ErrorList } from "@/views/error-list"
import { Loaded } from "@/views/loaded"
import { OperationName } from "@/views/operation-name"
import { Panel, PanelStats } from "@/views/panel"
import { verdictClass } from "@/views/release-list"
import { buttonVariants } from "@/views/ui/button"

const slowerWords = `at least ${slowerRule.times} times and ${duration(slowerRule.byMs)} more`
const failingWords = `at least ${failingMoreRule.failures} times, ${share(failingMoreRule.rate, 1)} of its runs and ${failingMoreRule.times} times as often`

/** What each verdict means, under it. */
const verdictMeaning: Readonly<Record<Verdict, string>> = {
  worse: `An operation's p95 is ${slowerWords} than in the release before, or it fails ${failingWords}, or an error was first seen in it.`,
  better: "Nothing got worse, and an operation got faster or fails less than in the release before.",
  same: "No operation got slower or faster, or fails more or less, than in the release before.",
  tooEarly: `Nothing is worse yet, but it ran under ${duration(judgedAfterMs)}, or no operation ran ${comparedFrom} times in both releases.`,
  first: "There is no release before it to compare with.",
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
  return (
    <Panel
      icon={GitCompareArrowsIcon}
      title={previous === undefined ? "Nothing to compare with" : `Against ${previous}`}
      subtitle={
        previous === undefined
          ? "No release of it was counted before this one"
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
      <PanelStats
        stats={[
          { label: "From", value: moment(DateTime.toEpochMillis(summary.firstSeen)) },
          live
            ? { label: "Until", value: "Live", color: liveColor }
            : { label: "Until", value: moment(DateTime.toEpochMillis(summary.lastSeen)) },
          { label: "Runs", value: count(summary.count) },
          { label: "Error rate", value: share(summary.errors, summary.count) },
        ]}
      />
    </Panel>
  )
}

/**
 * One release full screen, against the release before it: its verdict, when and how much it ran;
 * then what moved, each part shown only when something did: the operations slower and failing
 * more, the errors first seen in it, the incidents that opened while it ran, the operations faster
 * and failing less, and the operations new in it. Each opens its own page.
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
  const components = useComponentKeys(project)
  const answer = useAtomValue(releaseAtom(key))
  const back: Route = { page: "releases", project }
  const where = environment === undefined ? component : `${component}, ${environment}`
  const notFound =
    AsyncResult.isFailure(answer) &&
    Option.exists(Cause.findErrorOption(answer.cause), (error) => error._tag === "ReleaseNotFound")
  const operationOf = (operation: EnvelopeName): Route => ({ page: "operation", project, component, operation })
  const compared = (rows: ReadonlyArray<ComparedOperation>, moved: Moved) => (
    <ComparedTable rows={rows} moved={moved} linkOf={(row) => operationOf(row.operation)} />
  )

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
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="size-2 shrink-0" style={{ backgroundColor: colorOf(component, components) }} />
            {where}
          </p>
        </div>
      </header>

      {notFound ? (
        <Panel icon={SearchXIcon} title="There is no such release" subtitle={where}>
          <div className="flex flex-col gap-4 px-5 py-6">
            <p className="max-w-2xl text-[15px]">
              No operation of {component} was counted in release <span className="font-mono">{release}</span>
              {environment === undefined ? "" : ` in ${environment}`}. The link may be mistyped, or from another
              project.
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
            return (
              <div className="flex flex-col gap-4">
                <VerdictPanel project={project} detail={detail} live={live} />
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
    </div>
  )
}
