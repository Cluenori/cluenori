import type { SketchValue } from "@bagatka/quantile-sketch"
import { SketchValue as SketchValueSchema } from "@bagatka/quantile-sketch"
import type { FeatureKey, PersonId, ReleaseVersion, SessionId } from "@cluenori/foundation"
import { dayNumberOf } from "@cluenori/foundation"
import { DateTime } from "effect"

import type { AppSignal, AppUserId } from "./app-batch.ts"
import type { TimelineSignal } from "./app-queries.ts"
import type { DiagnosticKind } from "./metrickit.ts"
import { diagnosticsOf } from "./metrickit.ts"

// A batch's new signals added up into what the tables by day keep, so each row is written once per
// batch: activity, feature use, measures and diagnostics by day; sessions; timeline entries; and
// when each person was first and last seen. Pure: the store writes it.

/** What a measure measures: a launch's time by kind and stage, a prewarmed launch, or memory. */
export type Measure =
  | "launch.cold.first_frame"
  | "launch.cold.ready"
  | "launch.warm.first_frame"
  | "launch.warm.ready"
  | "launch.prewarmed"
  | "memory.peak"
  | "memory.footprint"

/** One signal of the batch with the person it is of. */
export interface PersonSignal {
  readonly person: PersonId
  readonly signal: AppSignal
}

export interface DayTally {
  readonly day: number
  readonly person: PersonId
  sessions: number
  foregroundMs: number
}

export interface FeatureTally {
  readonly day: number
  /** '' for none. */
  readonly feature: string
  readonly person: PersonId
  events: number
  screens: number
}

export interface MeasureTally {
  readonly day: number
  readonly feature: string
  readonly measure: Measure
  /** Empty for a measure only counted, such as a prewarmed launch. */
  readonly values: Array<SketchValue>
  count: number
}

export interface DiagnosticTally {
  readonly day: number
  readonly release: ReleaseVersion
  readonly kind: DiagnosticKind
  count: number
}

export interface SessionTally {
  readonly session: SessionId
  readonly person: PersonId
  startedAt: number | undefined
  endedAt: number | undefined
  foregroundMs: number | undefined
  /** The earliest signal of it in the batch: how long the session is kept is counted from it. */
  seenAt: number
}

export interface TimelineTally {
  readonly person: PersonId
  readonly at: number
  readonly signal: TimelineSignal
}

export interface Seen {
  first: number
  last: number
}

export interface Tallies {
  readonly days: ReadonlyArray<DayTally>
  readonly features: ReadonlyArray<FeatureTally>
  readonly measures: ReadonlyArray<MeasureTally>
  readonly diagnostics: ReadonlyArray<DiagnosticTally>
  readonly sessions: ReadonlyArray<SessionTally>
  readonly timeline: ReadonlyArray<TimelineTally>
  /** When each person was first and last seen in the batch. */
  readonly people: ReadonlyMap<PersonId, Seen>
  /** When the batch's release was first and last seen in it. */
  readonly span: Seen
}

const millisOf = (signal: AppSignal) => DateTime.toEpochMillis(signal.at)

const featureOf = (feature: FeatureKey | undefined) => feature ?? ""

// Keys of maps whose parts hold no NUL, so it separates them unambiguously.
const keyOf = (...parts: ReadonlyArray<string | number>) => parts.join("\u0000")

const measureValue = (value: number) => SketchValueSchema.make(value)

// A signal as kept by person: the app's own user ID stays out, as the person stands for it.
const withoutUser = <S extends { readonly user?: AppUserId }>(signal: S): Omit<S, "user"> => {
  const { user: _user, ...rest } = signal
  return rest
}

/** A signal as the archive keeps it: without the app's user ID, which the person beside it stands for. */
export const keptSignalOf = (signal: AppSignal): AppSignal => {
  switch (signal._tag) {
    case "metrickit":
      return signal
    case "session.started":
      return withoutUser(signal)
    case "session.ended":
      return withoutUser(signal)
    case "app.launched":
      return withoutUser(signal)
    case "app.memory":
      return withoutUser(signal)
    case "screen":
      return withoutUser(signal)
    case "event":
      return withoutUser(signal)
  }
}

/**
 * Adds up `signals`, the batch's new ones with their people, of release `release`: every signal makes
 * its person active that day, and in its feature ("" for none), except MetricKit's reports, which
 * aren't of a session; a session counts the day it starts; launches are measured by kind, prewarmed
 * ones only counted; memory by its peak and footprint; MetricKit's diagnostics by kind and the
 * release each is of. Memory isn't in the timeline.
 */
export const talliesOf = (signals: ReadonlyArray<PersonSignal>, release: ReleaseVersion): Tallies => {
  const days = new Map<string, DayTally>()
  const features = new Map<string, FeatureTally>()
  const measures = new Map<string, MeasureTally>()
  const diagnostics = new Map<string, DiagnosticTally>()
  const sessions = new Map<string, SessionTally>()
  const timeline: Array<TimelineTally> = []
  const people = new Map<PersonId, Seen>()
  const span: Seen = { first: Number.POSITIVE_INFINITY, last: Number.NEGATIVE_INFINITY }

  const dayOf = (person: PersonId, day: number) => {
    const key = keyOf(day, person)
    const existing = days.get(key)
    if (existing !== undefined) {
      return existing
    }
    const added: DayTally = { day, person, sessions: 0, foregroundMs: 0 }
    days.set(key, added)
    return added
  }
  const featureDayOf = (person: PersonId, day: number, feature: string) => {
    const key = keyOf(day, feature, person)
    const existing = features.get(key)
    if (existing !== undefined) {
      return existing
    }
    const added: FeatureTally = { day, feature, person, events: 0, screens: 0 }
    features.set(key, added)
    return added
  }
  const measure = (day: number, feature: string, measured: Measure, value: number | undefined) => {
    const key = keyOf(day, feature, measured)
    const tally = measures.get(key) ?? { day, feature, measure: measured, values: [], count: 0 }
    measures.set(key, tally)
    tally.count += 1
    if (value !== undefined) {
      tally.values.push(measureValue(value))
    }
  }
  const sessionOf = (person: PersonId, session: SessionId, at: number) => {
    const existing = sessions.get(session)
    if (existing !== undefined) {
      existing.seenAt = Math.min(existing.seenAt, at)
      return existing
    }
    const added: SessionTally = {
      session,
      person,
      startedAt: undefined,
      endedAt: undefined,
      foregroundMs: undefined,
      seenAt: at,
    }
    sessions.set(session, added)
    return added
  }

  for (const { person, signal } of signals) {
    const at = millisOf(signal)
    const day = dayNumberOf(at)
    const seen = people.get(person)
    people.set(person, { first: Math.min(seen?.first ?? at, at), last: Math.max(seen?.last ?? at, at) })
    span.first = Math.min(span.first, at)
    span.last = Math.max(span.last, at)
    if (signal._tag === "metrickit") {
      const counted = diagnosticsOf(signal, release)
      for (const { release: of, kind, count } of counted) {
        const key = keyOf(day, of, kind)
        const tally = diagnostics.get(key) ?? { day, release: of, kind, count: 0 }
        diagnostics.set(key, tally)
        tally.count += count
      }
      const crashes = counted.filter((each) => each.kind === "crash").reduce((sum, each) => sum + each.count, 0)
      const hangs = counted.filter((each) => each.kind === "hang").reduce((sum, each) => sum + each.count, 0)
      timeline.push({
        person,
        at,
        signal: { _tag: "metrickit", id: signal.id, at: signal.at, report: signal.report, crashes, hangs },
      })
      continue
    }
    const feature = featureOf(signal.feature)
    const active = dayOf(person, day)
    const inFeature = featureDayOf(person, day, feature)
    switch (signal._tag) {
      case "session.started": {
        active.sessions += 1
        sessionOf(person, signal.session, at).startedAt = at
        timeline.push({ person, at, signal: withoutUser(signal) })
        break
      }
      case "session.ended": {
        active.foregroundMs += signal.foregroundMs
        const ended = sessionOf(person, signal.session, at)
        ended.endedAt = at
        ended.foregroundMs = signal.foregroundMs
        timeline.push({ person, at, signal: withoutUser(signal) })
        break
      }
      case "app.launched": {
        if (signal.prewarmed) {
          measure(day, feature, "launch.prewarmed", undefined)
        } else {
          measure(day, feature, `launch.${signal.start}.first_frame`, signal.firstFrameMs)
          if (signal.readyMs !== undefined) {
            measure(day, feature, `launch.${signal.start}.ready`, signal.readyMs)
          }
        }
        timeline.push({ person, at, signal: withoutUser(signal) })
        break
      }
      case "app.memory": {
        measure(day, feature, "memory.peak", signal.peakBytes)
        measure(day, feature, "memory.footprint", signal.footprintBytes)
        break
      }
      case "screen": {
        inFeature.screens += 1
        timeline.push({ person, at, signal: withoutUser(signal) })
        break
      }
      case "event": {
        inFeature.events += 1
        timeline.push({ person, at, signal: withoutUser(signal) })
        break
      }
    }
  }
  return {
    days: [...days.values()],
    features: [...features.values()],
    measures: [...measures.values()],
    diagnostics: [...diagnostics.values()],
    sessions: [...sessions.values()],
    timeline,
    people,
    span,
  }
}
