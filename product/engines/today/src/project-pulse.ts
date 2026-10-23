import { Instant, ProjectKey } from "@cluenori/foundation"
import type { LoadSeries } from "@cluenori/signals"
import { UsageDay } from "@cluenori/signals"
import { DateTime, Schema } from "effect"

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

/** One hour of a project's load: how many operations ran in it, and how many failed. */
export const PulseHour = Schema.Struct({ start: Instant, count: Count, errors: Count }).annotate({
  identifier: "PulseHour",
})
export type PulseHour = typeof PulseHour.Type

/** A project's apps' people on the latest whole UTC day, and on the same day a week before. */
export const PulsePeople = Schema.Struct({
  /** The latest whole UTC day: yesterday. */
  latest: UsageDay,
  /** Absent when that day isn't counted: the apps hadn't sent anything yet. */
  weekBefore: Schema.optionalKey(UsageDay),
}).annotate({ identifier: "PulsePeople" })
export type PulsePeople = typeof PulsePeople.Type

/**
 * How a project is going now, beside what needs attention, in the environments it calls production:
 * its load over the last 24 hours by the hour, and its apps' people on the latest whole UTC day and a
 * week before.
 */
export const ProjectPulse = Schema.Struct({
  project: ProjectKey,
  /**
   * Each hour of the last 24 that had an operation, oldest first: the current hour so far and the 23
   * before it, so at most 24. An hour not listed had nothing reported, which isn't the same as
   * nothing done.
   */
  load: Schema.Array(PulseHour),
  /** Absent when its apps sent nothing by the latest whole day. */
  people: Schema.optionalKey(PulsePeople),
}).annotate({ identifier: "ProjectPulse" })
export type ProjectPulse = typeof ProjectPulse.Type

/** What one project's Signals say of its production environments now, which its pulse sums. */
export interface PulseState {
  readonly project: ProjectKey
  /** The load by the hour of each production environment asked. */
  readonly load: ReadonlyArray<LoadSeries>
  /** Each production environment's latest whole UTC day, where its apps' signals count it. */
  readonly latest: ReadonlyArray<UsageDay>
  /** Each production environment's same day a week before, where it is counted. */
  readonly weekBefore: ReadonlyArray<UsageDay>
}

// Several environments' same day, as one: each count summed, and the 7 and 30 days' people only when
// every environment's day has them. None when no environment counts the day.
const summedDay = (days: ReadonlyArray<UsageDay>): UsageDay | undefined => {
  const [first] = days
  if (first === undefined) {
    return undefined
  }
  const total = (count: (day: UsageDay) => number) => days.reduce((sum, day) => sum + count(day), 0)
  const totalOfEvery = (count: (day: UsageDay) => number | undefined) => {
    const counts = days.map(count)
    return counts.every((each): each is number => each !== undefined)
      ? counts.reduce((sum, each) => sum + each, 0)
      : undefined
  }
  const weekPeople = totalOfEvery((day) => day.weekPeople)
  const monthPeople = totalOfEvery((day) => day.monthPeople)
  return {
    day: first.day,
    people: total((day) => day.people),
    installations: total((day) => day.installations),
    ...(weekPeople === undefined ? {} : { weekPeople }),
    ...(monthPeople === undefined ? {} : { monthPeople }),
    sessions: total((day) => day.sessions),
    foregroundMs: total((day) => day.foregroundMs),
  }
}

/**
 * A project's pulse from its production environments' load and usage: the hours' counts and errors
 * summed across environments, oldest first; the people of each day summed across the environments
 * that count it, absent when none counts the latest day, and the week before absent when none counts
 * that one.
 */
export const pulseOf = (state: PulseState): ProjectPulse => {
  const hours = new Map<number, { count: number; errors: number }>()
  for (const point of state.load.flatMap((series) => series.points)) {
    const start = DateTime.toEpochMillis(point.start)
    const earlier = hours.get(start) ?? { count: 0, errors: 0 }
    hours.set(start, { count: earlier.count + point.count, errors: earlier.errors + point.errors })
  }
  const load = [...hours.entries()]
    .toSorted(([left], [right]) => left - right)
    .map(([start, counted]): PulseHour => ({ start: DateTime.makeUnsafe(start), ...counted }))
  const latest = summedDay(state.latest)
  const weekBefore = summedDay(state.weekBefore)
  return {
    project: state.project,
    load,
    ...(latest === undefined ? {} : { people: { latest, ...(weekBefore === undefined ? {} : { weekBefore }) } }),
  }
}
