import type { ProjectKey } from "@cluenori/foundation"
import type { Incident } from "@cluenori/incidents"
import { useAtomValue } from "@effect/atom-react"
import { DateTime } from "effect"
import { AsyncResult } from "effect/reactivity"
import { HistoryIcon, RadarIcon, SirenIcon } from "lucide-react"

import { clockTime, moment } from "@/lib/format"
import { incidentsAtom, monitorsAtom, useComponentKeys } from "@/project-data"
import { colorOf, incidentActionOf } from "@/project-facts"
import { IncidentRow } from "@/views/incident-row"
import { Loaded } from "@/views/loaded"
import { Panel } from "@/views/panel"

function IncidentList({
  project,
  incidents,
  now,
  none,
}: {
  readonly project: ProjectKey
  readonly incidents: ReadonlyArray<Incident>
  readonly now: number | undefined
  readonly none: string
}) {
  if (incidents.length === 0) {
    return <p className="px-5 py-5 text-sm text-muted-foreground">{none}</p>
  }
  return (
    <ul className="divide-y">
      {incidents.map((incident) => (
        <li key={incident.id}>
          <IncidentRow
            incident={incident}
            now={now ?? DateTime.toEpochMillis(incident.openedAt)}
            to={incidentActionOf(project, incident).to}
          />
        </li>
      ))}
    </ul>
  )
}

/**
 * Every incident of a project the API keeps: the open ones, newest first, and those resolved in the
 * last 7 days, each one click from its evidence; and the monitors the Down detector checks, each with
 * its last check.
 */
export function IncidentsPage({ project }: { readonly project: ProjectKey }) {
  const incidents = useAtomValue(incidentsAtom(project))
  const monitors = useAtomValue(monitorsAtom(project))
  const components = useComponentKeys(project)
  const looked =
    AsyncResult.isSuccess(incidents) && incidents.value.checkedAt !== undefined
      ? DateTime.toEpochMillis(incidents.value.checkedAt)
      : undefined

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-col pb-2">
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">Incidents</h1>
        <p className="min-h-5 text-sm text-muted-foreground">
          {AsyncResult.isSuccess(incidents) &&
            (looked === undefined
              ? "The detectors haven't looked yet"
              : `The detectors look every minute; last at ${moment(looked)}`)}
        </p>
      </header>

      <Panel icon={SirenIcon} title="Open" subtitle="The newest first">
        <Loaded result={incidents}>
          {(list) => <IncidentList project={project} incidents={list.open} now={looked} none="No incident is open." />}
        </Loaded>
      </Panel>

      <Panel icon={HistoryIcon} title="Resolved" subtitle="In the last 7 days, the latest first">
        <Loaded result={incidents}>
          {(list) => (
            <IncidentList
              project={project}
              incidents={list.resolved}
              now={looked}
              none="None resolved in the last 7 days."
            />
          )}
        </Loaded>
      </Panel>

      <Panel
        icon={RadarIcon}
        title="Monitors"
        subtitle="Addresses checked every minute: two failed checks in a row are Down"
      >
        <Loaded result={monitors}>
          {(list) =>
            list.monitors.length === 0 ? (
              <p className="max-w-2xl px-5 py-5 text-[15px]">
                No monitors. Add one for each component, such as its health endpoint:{" "}
                <span className="font-mono text-sm">
                  ./cluenori monitor add {project} {"<component>"} {"<url>"}
                </span>
              </p>
            ) : (
              <ul className="divide-y">
                {list.monitors.map(({ monitor, lastCheck }) => (
                  <li key={monitor.id} className="flex min-w-0 items-center gap-4 px-5 py-3">
                    <span
                      className="size-2 shrink-0"
                      style={{ backgroundColor: colorOf(monitor.component, components) }}
                    />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="font-mono text-sm wrap-anywhere">{monitor.url}</span>
                      <span className="text-sm text-muted-foreground">{monitor.component}</span>
                    </span>
                    <span className="shrink-0 text-right text-sm">
                      {lastCheck === undefined && <span className="text-muted-foreground">Not checked yet</span>}
                      {lastCheck !== undefined && lastCheck.problem === undefined && (
                        <span className="text-mint-ink">
                          Passed at {clockTime(DateTime.toEpochMillis(lastCheck.at))}
                        </span>
                      )}
                      {lastCheck?.problem !== undefined && (
                        <span className="text-failure">
                          Failed at {clockTime(DateTime.toEpochMillis(lastCheck.at))}: {lastCheck.problem}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )
          }
        </Loaded>
      </Panel>
    </div>
  )
}
