import type { Period } from "@cluenori/foundation"
import type { LoadSeries } from "@cluenori/signals"
import { stepMillis } from "@cluenori/signals"
import { useAtomValue } from "@effect/atom-react"
import { DateTime } from "effect"
import { CrosshairIcon, XIcon } from "lucide-react"

import { failureColor } from "@/lib/colors"
import { clockTime, count, dayOf, duration, moment, share } from "@/lib/format"
import type { PeriodKey, Scope } from "@/project-data"
import { momentTracesAtom, periodMillis } from "@/project-data"
import type { Columns } from "@/project-facts"
import { periodCovering, periodWords } from "@/project-facts"
import { Loaded } from "@/views/loaded"
import { Panel, PanelStats } from "@/views/panel"
import { TraceList } from "@/views/trace-list"
import { Button } from "@/views/ui/button"

/**
 * A moment a chart opened, as its columns place it: the column and when its step starts, and the
 * part of the step the counts cover, all of it but at the period's edges, which its requests are
 * asked for.
 */
export type Moment = {
  readonly column: number
  readonly start: number
  readonly from: number
  readonly to: number
}

/**
 * Where `at` falls on a chart's columns: the step that holds it, or undefined when what the counts
 * cover doesn't.
 */
export const momentOf = (columns: Columns, covered: Period | undefined, at: DateTime.Utc): Moment | undefined => {
  const time = DateTime.toEpochMillis(at)
  if (covered === undefined) {
    return undefined
  }
  const first = DateTime.toEpochMillis(covered.from)
  const last = DateTime.toEpochMillis(covered.to)
  if (time < first || time >= last) {
    return undefined
  }
  const column = Math.floor((time - columns.from) / columns.step)
  const start = columns.from + column * columns.step
  return { column, start, from: Math.max(start, first), to: Math.min(start + columns.step, last) }
}

/**
 * Which period holds a moment the chart's doesn't, as of the latest count: the shortest, `older`
 * when the longest is too short, or `later` when it is after the latest count.
 */
export const holdingOf = (at: DateTime.Utc, now: number): PeriodKey | "older" | "later" => {
  const age = now - DateTime.toEpochMillis(at)
  if (age < 0) {
    return "later"
  }
  return age > periodMillis["90d"] ? "older" : periodCovering(at, DateTime.makeUnsafe(now))
}

// Why no period shows a moment.
const beyond = {
  older: "It is further back than the longest period, 90 days.",
  later: "It is after the latest count, so nothing is known of it yet.",
}

/**
 * One moment a chart opened, marked within the rest: how many ran then, how many failed, and how
 * long they took, then the requests kept from it, each one click from its trace. A moment the
 * period doesn't hold says so, with one click to a period that does.
 */
export function MomentPanel({
  scope,
  series,
  at,
  found,
  holding,
  showOperation,
  onShowPeriod,
  onClose,
}: {
  readonly scope: Scope
  readonly series: LoadSeries
  readonly at: DateTime.Utc
  /** Where the chart places it; undefined when its period doesn't hold it. */
  readonly found: Moment | undefined
  /** Which period holds it, from `holdingOf`. */
  readonly holding: PeriodKey | "older" | "later"
  /** Each request names its operation: the moment is of several. */
  readonly showOperation: boolean
  readonly onShowPeriod: (period: PeriodKey) => void
  readonly onClose: () => void
}) {
  const close = (
    <Button variant="outline" size="sm" onClick={onClose}>
      <XIcon data-icon="inline-start" />
      Close
    </Button>
  )
  if (found === undefined) {
    return (
      <Panel
        icon={CrosshairIcon}
        title="The moment opened"
        subtitle={moment(DateTime.toEpochMillis(at))}
        action={close}
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-5">
          <p className="text-[15px]">This period doesn&apos;t hold it.</p>
          {holding === "older" || holding === "later" ? (
            <p className="text-sm text-muted-foreground">{beyond[holding]}</p>
          ) : (
            <Button variant="outline" size="sm" onClick={() => onShowPeriod(holding)}>
              Show the {periodWords[holding].toLowerCase()}
            </Button>
          )}
        </div>
      </Panel>
    )
  }
  const point = series.points.find((entry) => DateTime.toEpochMillis(entry.start) === found.start)
  const width = stepMillis[series.step]
  const title = width >= 86_400_000 ? dayOf(found.from) : `${moment(found.from)}–${clockTime(found.to)}`
  return (
    <Panel icon={CrosshairIcon} title={title} subtitle="The moment opened, marked on the charts" action={close}>
      {point === undefined ? (
        <p className="px-5 py-5 text-[15px]">Nothing was reported then. The sender may have been silent.</p>
      ) : (
        <PanelStats
          stats={[
            { label: "Requests", value: count(point.count) },
            {
              label: "Failed",
              value: point.errors === 0 ? "none" : `${count(point.errors)}, ${share(point.errors, point.count)}`,
              ...(point.errors > 0 ? { color: failureColor } : {}),
            },
            { label: "p50", value: duration(point.p50Ms) },
            { label: "p95", value: duration(point.p95Ms) },
          ]}
        />
      )}
      <MomentRequests scope={scope} moment={found} showOperation={showOperation} />
    </Panel>
  )
}

/** The requests kept from a moment: the failed first, then the slowest, each once. */
function MomentRequests({
  scope,
  moment: shown,
  showOperation,
}: {
  readonly scope: Scope
  readonly moment: Moment
  readonly showOperation: boolean
}) {
  const kept = useAtomValue(momentTracesAtom({ ...scope, from: shown.from, to: shown.to }))
  return (
    <div className="border-t">
      <Loaded result={kept}>
        {(answer) => {
          const seen = new Set<string>()
          const rows = [...answer.failed, ...answer.slowest].filter((row) => {
            const key = `${row.trace} ${row.operation}`
            if (seen.has(key)) {
              return false
            }
            seen.add(key)
            return true
          })
          if (answer.covered === undefined) {
            return (
              <p className="px-5 py-5 text-sm text-muted-foreground">
                Requests are kept 14 days, and this moment is older.
              </p>
            )
          }
          return rows.length === 0 ? (
            <p className="px-5 py-5 text-sm text-muted-foreground">
              No request of this moment is kept. Of each hour, the five slowest and the five slowest failed are kept.
            </p>
          ) : (
            <>
              <p className="px-5 pt-4 pb-1 text-sm text-muted-foreground">
                Requests kept from it, the failed first, then the slowest
              </p>
              <TraceList
                project={scope.project}
                rows={rows}
                showOperation={showOperation}
                traceFilters={{
                  ...(scope.environment === undefined ? {} : { environment: scope.environment }),
                  ...(scope.release === undefined ? {} : { release: scope.release }),
                }}
              />
            </>
          )
        }}
      </Loaded>
    </div>
  )
}
