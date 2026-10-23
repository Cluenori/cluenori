import type { Incident } from "@cluenori/incidents"
import { cn } from "cn"
import { DateTime } from "effect"

import { ago, lasting } from "@/lib/format"
import { detectorWords, evidenceWords } from "@/project-facts"
import type { Route } from "@/router"
import { Link } from "@/router"

// Red while open, yellow once someone acknowledged it, gray once resolved.
const dotOf = (incident: Incident) => {
  if (incident.resolvedAt !== undefined) {
    return "bg-muted-foreground/50"
  }
  return incident.acknowledgedAt === undefined ? "bg-failure" : "bg-yellow"
}

/**
 * An incident as a row that opens `to`: what found it and what it is about, then, while it is open,
 * what its detector saw and when it opened; once resolved, when, and how long it lasted. `now` is
 * when the detectors last looked, which "ago" is measured from.
 */
export function IncidentRow({
  incident,
  now,
  to,
}: {
  readonly incident: Incident
  readonly now: number
  readonly to: Route
}) {
  const opened = DateTime.toEpochMillis(incident.openedAt)
  const resolved = incident.resolvedAt === undefined ? undefined : DateTime.toEpochMillis(incident.resolvedAt)
  return (
    <Link
      to={to}
      className="flex min-w-0 items-center gap-4 px-5 py-3 outline-none hover:bg-accent/60 focus-visible:bg-accent/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
    >
      <span className={cn("size-2 shrink-0", dotOf(incident))} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[15px]">
          {detectorWords[incident.evidence._tag]}: {incident.subject}
          {incident.environment !== undefined && (
            <span className="text-muted-foreground"> · {incident.environment}</span>
          )}
        </span>
        <span className="text-sm text-muted-foreground">
          {resolved === undefined
            ? `${evidenceWords(incident.evidence, now)}; opened ${ago(opened, now)}${incident.acknowledgedAt === undefined ? "" : ", acknowledged"}`
            : `Resolved ${ago(resolved, now)}, after ${lasting(resolved - opened)}`}
        </span>
      </span>
    </Link>
  )
}
