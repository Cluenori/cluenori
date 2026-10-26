import type { ProjectKey } from "@cluenori/foundation"
import type { Incident, IncidentDetail, IncidentId } from "@cluenori/incidents"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { cn } from "cn"
import { DateTime, Exit } from "effect"
import { AsyncResult } from "effect/reactivity"
import { ArrowLeftIcon, HistoryIcon, PackageIcon, RadarIcon, SearchIcon, SirenIcon } from "lucide-react"
import type { ReactNode } from "react"
import { useState } from "react"

import { incidentBriefOf, incidentsAnswerOf, standingOf, updateWords, uptimeAnswerOf } from "@/incident-facts"
import { moment } from "@/lib/format"
import { acknowledgeAtom, incidentAtom, incidentsAtom, monitorsAtom, useComponentKeys } from "@/project-data"
import { colorOf, detectorWords, evidenceWords, incidentActionOf } from "@/project-facts"
import type { Route } from "@/router"
import { Link } from "@/router"
import { CopyButton } from "@/views/copy-button"
import { IncidentRow } from "@/views/incident-row"
import { failureText, Loaded } from "@/views/loaded"
import { Panel } from "@/views/panel"
import { Button, buttonVariants } from "@/views/ui/button"

const clockNow = () => DateTime.toEpochMillis(DateTime.nowUnsafe())

function IncidentList({
  project,
  incidents,
  now,
  none,
}: {
  readonly project: ProjectKey
  readonly incidents: ReadonlyArray<Incident>
  readonly now: number
  readonly none: string
}) {
  if (incidents.length === 0) {
    return <p className="px-5 py-5 text-sm text-muted-foreground">{none}</p>
  }
  return (
    <ul className="divide-y">
      {incidents.map((incident) => (
        <li key={incident.id}>
          <IncidentRow incident={incident} now={now} to={incidentActionOf(project, incident).to} />
        </li>
      ))}
    </ul>
  )
}

// Each tone's dot: red for what fails, mint for all up, gray for nothing to say.
const toneDot = { failure: "bg-failure", steady: "bg-mint", quiet: "bg-muted-foreground/50" } as const

/** Uptime in a line, under the incidents' answer: whether every monitor is up, one click from them. */
function UptimeLine({ project }: { readonly project: ProjectKey }) {
  const monitors = useAtomValue(monitorsAtom(project))
  if (!AsyncResult.isSuccess(monitors)) {
    return null
  }
  const answer = uptimeAnswerOf(monitors.value.monitors)
  return (
    <Link
      to={{ page: "uptime", project }}
      className="flex items-center gap-3 border bg-card px-5 py-3.5 text-[15px] outline-none hover:bg-accent/60 focus-visible:outline-2 focus-visible:outline-ring"
    >
      <RadarIcon className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
      <span className="text-muted-foreground">Uptime:</span>
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span className={cn("size-2 shrink-0", toneDot[answer.tone])} />
        <span className="truncate">{answer.words}</span>
      </span>
      <span className="shrink-0 text-sm text-muted-foreground">Every monitor</span>
    </Link>
  )
}

/**
 * Every incident of a project the API keeps, a list (`concept/Experience.md`): its answer first, how
 * many are open and whether someone is on each, and whether every monitor is up; then the open ones,
 * newest first, and those resolved in the last 7 days, each opening its own page.
 */
export function IncidentsPage({ project }: { readonly project: ProjectKey }) {
  const incidents = useAtomValue(incidentsAtom(project))
  const [now] = useState(clockNow)
  const looked =
    AsyncResult.isSuccess(incidents) && incidents.value.checkedAt !== undefined
      ? DateTime.toEpochMillis(incidents.value.checkedAt)
      : undefined

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-col gap-1 pb-2">
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">Incidents</h1>
        {AsyncResult.isSuccess(incidents) && (
          <>
            <p className="text-[17px]">
              {incidentsAnswerOf(
                incidents.value.open.length,
                incidents.value.open.filter((incident) => incident.acknowledgedAt === undefined).length,
                incidents.value.resolved.length,
              )}
            </p>
            <p className="text-sm text-muted-foreground">
              {looked === undefined
                ? "The detectors haven't looked yet"
                : `The detectors look every minute; last at ${moment(looked)}`}
            </p>
          </>
        )}
      </header>

      <UptimeLine project={project} />

      <Panel icon={SirenIcon} title="Open" subtitle="The newest first">
        <Loaded result={incidents}>
          {(list) => (
            <IncidentList project={project} incidents={list.open} now={looked ?? now} none="No incident is open." />
          )}
        </Loaded>
      </Panel>

      <Panel icon={HistoryIcon} title="Resolved" subtitle="In the last 7 days, the latest first">
        <Loaded result={incidents}>
          {(list) => (
            <IncidentList
              project={project}
              incidents={list.resolved}
              now={looked ?? now}
              none="None resolved in the last 7 days."
            />
          )}
        </Loaded>
      </Panel>
    </div>
  )
}

// An incident's color: red while open, yellow once someone is on it, mint once resolved.
const standingColor = (incident: Incident) => {
  if (incident.resolvedAt !== undefined) {
    return "text-mint-ink"
  }
  return incident.acknowledgedAt === undefined ? "text-failure" : "text-yellow-ink"
}

// Where what an incident is about is: its monitor's page, or its operation's at the moment it opened.
const subjectRouteOf = (project: ProjectKey, incident: Incident): { readonly label: string; readonly to: Route } =>
  incident.evidence._tag === "down"
    ? { label: "Its monitor", to: { page: "monitor", project, monitor: incident.evidence.monitor } }
    : {
        label: "Its operation",
        to: {
          page: "operation",
          project,
          operation: incident.evidence.operation,
          component: incident.component,
          ...(incident.environment === undefined ? {} : { environment: incident.environment }),
          at: incident.openedAt,
        },
      }

/** One fact about an incident: what it is on the left, its value on the right. */
function Fact({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1 px-5 py-3.5">
      <dt className="w-32 shrink-0 text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-[15px] break-words">{children}</dd>
    </div>
  )
}

/** What an incident is about: its monitor or its operation, and what its detector saw. */
function AboutPanel({ project, incident }: { readonly project: ProjectKey; readonly incident: Incident }) {
  const subject = subjectRouteOf(project, incident)
  const { evidence } = incident
  return (
    <Panel
      icon={SearchIcon}
      title="What it is about"
      subtitle="What its detector saw when it opened, or last got worse"
    >
      <dl className="divide-y">
        <Fact label={evidence._tag === "down" ? "Monitor" : "Operation"}>
          <Link to={subject.to} className="font-mono text-sm underline-offset-4 hover:underline">
            {evidence._tag === "down" ? evidence.url : evidence.operation}
          </Link>
        </Fact>
        <Fact label="Saw">{evidenceWords(evidence, DateTime.toEpochMillis(incident.openedAt))}</Fact>
        <Fact label="Where">
          {incident.component}
          {incident.environment === undefined ? "" : `, ${incident.environment}`}
        </Fact>
      </dl>
    </Panel>
  )
}

/** An incident's life, the oldest first: each change, when, and what it said then. */
function LifePanel({ detail }: { readonly detail: IncidentDetail }) {
  return (
    <Panel icon={HistoryIcon} title="Its life" subtitle="Every change, the oldest first">
      <ol className="divide-y">
        {detail.updates.map((update, index) => (
          <li
            key={index}
            className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-x-4 px-5 py-3 sm:grid-cols-[11rem_9rem_minmax(0,1fr)]"
          >
            <span className="w-32 shrink-0 font-mono text-sm text-muted-foreground">
              {moment(DateTime.toEpochMillis(update.at))}
            </span>
            <span className="w-32 shrink-0 text-[15px]">{updateWords[update.change]}</span>
            {update.title !== undefined && (
              <span className="min-w-0 text-sm break-words text-muted-foreground">{update.title}</span>
            )}
          </li>
        ))}
        {detail.incident.resolvedAt === undefined && (
          <li className="flex flex-wrap items-baseline gap-x-4 px-5 py-3">
            <span className="w-32 shrink-0 font-mono text-sm text-muted-foreground">Now</span>
            <span className="text-[15px] text-muted-foreground">Still open</span>
          </li>
        )}
      </ol>
    </Panel>
  )
}

/** The releases of an incident's component that ran when it opened, each opening its page. */
function ReleasesPanel({ project, detail }: { readonly project: ProjectKey; readonly detail: IncidentDetail }) {
  const { incident } = detail
  return (
    <Panel icon={PackageIcon} title="Running when it opened" subtitle={`${incident.component}'s release then`}>
      {detail.releases.length === 0 ? (
        <p className="px-5 py-5 text-sm text-muted-foreground">
          {incident.component} reported no release running in the hour before it opened.
        </p>
      ) : (
        <ul className="divide-y">
          {detail.releases.map((ran) => (
            <li key={`${ran.environment ?? ""} ${ran.release}`}>
              <Link
                to={{
                  page: "release",
                  project,
                  component: incident.component,
                  release: ran.release,
                  ...(ran.environment === undefined ? {} : { environment: ran.environment }),
                }}
                className="flex items-center gap-4 px-5 py-3 outline-none hover:bg-accent/60 focus-visible:bg-accent/60"
              >
                <span className="font-mono text-[15px]">{ran.release}</span>
                <span className="text-sm text-muted-foreground">
                  {incident.component}
                  {ran.environment === undefined ? "" : `, ${ran.environment}`}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

/** Acknowledge: says the member is on the incident, which stops its alerts; why it didn't, beside it. */
function Acknowledge({ project, incident }: { readonly project: ProjectKey; readonly incident: IncidentId }) {
  const acknowledge = useAtomSet(acknowledgeAtom, { mode: "promiseExit" })
  const [state, setState] = useState<{ readonly sending: boolean; readonly problem?: string }>({ sending: false })
  return (
    <>
      <Button
        size="sm"
        disabled={state.sending}
        onClick={() => {
          setState({ sending: true })
          void acknowledge({ project, incident }).then((exit) =>
            setState(Exit.isSuccess(exit) ? { sending: false } : { sending: false, problem: failureText(exit.cause) }),
          )
        }}
      >
        {state.sending ? "Acknowledging…" : "Acknowledge"}
      </Button>
      {state.problem !== undefined && (
        <p role="alert" className="text-sm text-failure">
          {state.problem}
        </p>
      )}
    </>
  )
}

/**
 * One incident, by its ID, an item (`concept/Experience.md`): no period, its whole life. Where it
 * stands first, then what it is about, one click from its monitor or operation, its life from opening
 * to now, and the release that ran when it opened; Acknowledge while it is open and no one is on it,
 * and a brief to copy for an agent.
 */
export function IncidentPage({
  project,
  incident: id,
}: {
  readonly project: ProjectKey
  readonly incident: IncidentId
}) {
  const result = useAtomValue(incidentAtom({ project, incident: id }))
  const components = useComponentKeys(project)
  const [now] = useState(clockNow)
  const detail = AsyncResult.isSuccess(result) ? result.value : undefined
  const incident = detail?.incident
  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-wrap items-start gap-x-4 gap-y-3 pb-2">
        <Link
          to={{ page: "incidents", project }}
          aria-label="Back to the incidents"
          className={buttonVariants({ variant: "outline", size: "icon" })}
        >
          <ArrowLeftIcon />
        </Link>
        <div className="flex min-w-0 flex-[1_1_20rem] flex-col gap-1">
          {incident === undefined ? (
            <h1 className="text-2xl font-semibold tracking-[-0.02em]">Incident</h1>
          ) : (
            <>
              <p className={cn("text-sm font-medium", standingColor(incident))}>
                {detectorWords[incident.evidence._tag]} · {standingOf(incident, now)}
              </p>
              <h1 className="text-2xl font-semibold tracking-[-0.02em] break-words">{incident.title}</h1>
              <p className="flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
                <span className="flex items-center gap-2">
                  <span
                    className="size-2 shrink-0"
                    style={{ backgroundColor: colorOf(incident.component, components) }}
                  />
                  {incident.component}
                  {incident.environment === undefined ? "" : `, ${incident.environment}`}
                </span>
                <span>Opened {moment(DateTime.toEpochMillis(incident.openedAt))}</span>
                {incident.resolvedAt !== undefined && (
                  <span>Resolved {moment(DateTime.toEpochMillis(incident.resolvedAt))}</span>
                )}
              </p>
            </>
          )}
        </div>
        {detail !== undefined && incident !== undefined && (
          <div className="flex max-w-full min-w-0 flex-wrap items-center gap-3">
            {incident.resolvedAt === undefined && incident.acknowledgedAt === undefined && (
              <Acknowledge project={project} incident={incident.id} />
            )}
            <Link
              to={subjectRouteOf(project, incident).to}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              {subjectRouteOf(project, incident).label}
            </Link>
            <CopyButton text={incidentBriefOf(project, detail)} label="Copy for an agent" />
          </div>
        )}
      </header>
      <Loaded result={result}>
        {(shown) => (
          <div className="grid gap-4 xl:grid-cols-2">
            <AboutPanel project={project} incident={shown.incident} />
            <ReleasesPanel project={project} detail={shown} />
            <div className="min-w-0 xl:col-span-2">
              <LifePanel detail={shown} />
            </div>
          </div>
        )}
      </Loaded>
    </div>
  )
}
