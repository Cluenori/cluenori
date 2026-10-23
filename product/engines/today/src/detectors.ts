import type { ProjectKey } from "@cluenori/foundation"
import type { IncidentList } from "@cluenori/incidents"
import type { Compared, ErrorTable } from "@cluenori/signals"
import { errorStatusOf, operationKeyOf, slowerOperations } from "@cluenori/signals"
import { DateTime } from "effect"

import type { TodayItem } from "./today-item.ts"

/** What one project's engines say now, which Today's detectors read. */
export interface ProjectState {
  readonly project: ProjectKey
  readonly incidents: IncidentList
  /** The errors of the last day. */
  readonly errors: ErrorTable
  /** The operations of the last day, and of the 7 days before. */
  readonly operations: Compared
  readonly components: number
  /** The time Today looks at (Unix ms). */
  readonly now: number
}

/** The detectors: what needs attention in one project, in no order (`sortToday` orders them). */
export const itemsOf = (state: ProjectState): ReadonlyArray<TodayItem> => {
  const { project } = state
  const slower = slowerOperations(state.operations)
  // Not handled: a component that sends only logs or metrics looks silent; telling it apart needs
  // the last time each signal arrived, which Signals doesn't keep yet.
  const silent = state.components > 0 && state.operations.lastDay.count === 0
  return [
    ...state.incidents.open.map((incident): TodayItem => ({ _tag: "incident", project, incident })),
    ...state.errors.groups.flatMap((error): ReadonlyArray<TodayItem> => {
      const { isNew, ongoing } = errorStatusOf(error, state.now)
      return isNew || ongoing ? [{ _tag: "error", project, error, isNew, ongoing }] : []
    }),
    ...state.operations.lastDay.rows.flatMap((row): ReadonlyArray<TodayItem> => {
      const found = slower.get(operationKeyOf(row))
      return found === undefined
        ? []
        : [
            {
              _tag: "slower",
              project,
              component: row.component,
              ...(row.environment === undefined ? {} : { environment: row.environment }),
              operation: row.operation,
              ...found,
            },
          ]
    }),
    ...(silent
      ? [
          {
            _tag: "silent" as const,
            project,
            ...(state.operations.usual.dataUntil === undefined ? {} : { lastDataAt: state.operations.usual.dataUntil }),
          },
        ]
      : []),
  ]
}

// How urgent each kind is, most first.
const rankOf = (item: TodayItem) => {
  switch (item._tag) {
    case "incident":
      return item.incident.acknowledgedAt === undefined ? 0 : 2
    case "error":
      return item.ongoing ? 1 : 3
    case "slower":
      return 4
    case "promotion":
      return 5
    case "silent":
      return 6
  }
}

// Within a kind, the more urgent first: the latest incident or error, the most slowed operation, the
// promotion that ended latest or, while it hasn't, started latest.
const weightOf = (item: TodayItem) => {
  switch (item._tag) {
    case "incident":
      return -DateTime.toEpochMillis(item.incident.openedAt)
    case "error":
      return -DateTime.toEpochMillis(item.error.lastSeen)
    case "slower":
      return -item.p95Ms / item.usualP95Ms
    case "promotion":
      return -DateTime.toEpochMillis(item.endedAt ?? item.startedAt)
    case "silent":
      return 0
  }
}

/** Items in Today's order, the most urgent first; equals by project, as code points order keys. */
export const sortToday = (items: ReadonlyArray<TodayItem>): ReadonlyArray<TodayItem> =>
  items.toSorted(
    (left, right) =>
      rankOf(left) - rankOf(right) ||
      weightOf(left) - weightOf(right) ||
      (left.project < right.project ? -1 : Number(left.project > right.project)),
  )
