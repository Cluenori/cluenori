import { calendarDayOf, Period } from "@cluenori/foundation"
import type { AppRelease } from "@cluenori/signals"
import { AppSignals, Signals } from "@cluenori/signals"
import { DateTime, Effect } from "effect"

import type { KnownRelease } from "./catalog.ts"
import type { LifePoint, LifeTotals, ReleaseLife } from "./release.ts"

const fiveMinutes = 5 * 60_000
const hour = 3_600_000
const day = 24 * hour

// The step a life of `ms` is shown in: 5 minutes under 6 hours, an hour under 3 days, else a UTC
// day; from 6 to 72 steps but for the longest.
const stepOf = (ms: number) => {
  if (ms < 6 * hour) {
    return { step: "5m", width: fiveMinutes } as const
  }
  return ms < 3 * day ? ({ step: "1h", width: hour } as const) : ({ step: "1d", width: day } as const)
}

// When a release did anything, from its operations' first minute and its app's first signal to the
// end of the last of either, exclusive: an operation's `lastSeen` already ends its minute, and an
// app's is the instant of its last signal, so it ends a millisecond later. Never empty, so a release
// with one signal still has a life. None for a release with neither.
const spanOf = (release: KnownRelease, sent: AppRelease | undefined) => {
  const starts = [release.ran?.firstSeen, sent?.firstSeen].flatMap((time) =>
    time === undefined ? [] : [DateTime.toEpochMillis(time)],
  )
  const ends = [
    ...(release.ran === undefined ? [] : [DateTime.toEpochMillis(release.ran.lastSeen)]),
    ...(sent === undefined ? [] : [DateTime.toEpochMillis(sent.lastSeen) + 1]),
  ]
  if (starts.length === 0) {
    return undefined
  }
  const from = Math.min(...starts)
  return { from, to: Math.max(from + 1, ...ends) }
}

/**
 * The app release `release` is in the app's signals, kept 15 months: of its component and
 * environment, else, for a release that names no environment, of any. None for a component whose
 * app sends nothing, such as a service.
 */
export const sentOf = Effect.fn("Releases.sentOf")(function* (release: KnownRelease) {
  const apps = yield* AppSignals
  const now = DateTime.toEpochMillis(yield* DateTime.now)
  const { releases } = yield* apps.releases({
    period: new Period({ from: DateTime.makeUnsafe(now - 456 * day), to: DateTime.makeUnsafe(now + 1) }),
    component: release.component,
    ...(release.environment === undefined ? {} : { environment: release.environment }),
  })
  return releases.find((each) => each.release === release.release)
})

/**
 * A release's whole life, step by step, and its totals: its requests and their failures and p95,
 * as its operations were counted; the warnings and errors it logged; and its app's people by UTC
 * day. 5 minutes a step while it ran under 6 hours, an hour under 3 days, else a UTC day. What its telemetry didn't say is
 * absent, never 0: requests in a step nothing was counted in, warnings older than the 90 days they
 * are kept, people of an app that sent nothing. None for a release that neither ran nor sent.
 * Reads a load series, warnings and errors counts, and, of an app, its usage.
 */
export const lifeOf = Effect.fn("Releases.lifeOf")(function* (release: KnownRelease, sent: AppRelease | undefined) {
  const span = spanOf(release, sent)
  if (span === undefined) {
    return undefined
  }
  const { step, width } = stepOf(span.to - span.from)
  const from = span.from - (span.from % width)
  // The end of the step its last minute is in.
  const to = Math.max(span.to - (span.to % width) + (span.to % width === 0 ? 0 : width), from + width)
  const period = new Period({ from: DateTime.makeUnsafe(from), to: DateTime.makeUnsafe(to) })
  const scope = {
    component: release.component,
    ...(release.environment === undefined ? {} : { environment: release.environment }),
    release: release.release,
  }
  const signals = yield* Signals
  const ran = release.ran !== undefined
  const load = ran ? yield* signals.loadOverTime({ period, ...scope }, step) : undefined
  const logs = ran ? yield* signals.logCounts({ period, step, by: "level", ...scope }) : undefined
  const usage = sent === undefined ? undefined : yield* (yield* AppSignals).usage({ period, ...scope })

  const requests = new Map((load?.points ?? []).map((point) => [DateTime.toEpochMillis(point.start), point]))
  const levels = new Map<string, Map<number, number>>(
    (logs?.series ?? []).map((series) => [
      series.key,
      new Map(series.points.map((point) => [DateTime.toEpochMillis(point.start), point.count])),
    ]),
  )
  const logsFrom = logs?.covered === undefined ? undefined : DateTime.toEpochMillis(logs.covered.from)
  // Usage fills the days nobody was active with 0; a day the app sent nothing is unknown, not 0.
  const people = new Map((usage?.days ?? []).flatMap((each) => (each.people > 0 ? [[each.day, each.people]] : [])))
  const countOf = (level: string, start: number) => levels.get(level)?.get(start) ?? 0

  const points = Array.from({ length: Math.round((to - from) / width) }, (_, index): LifePoint => {
    const start = from + index * width
    const counted = requests.get(start)
    // Warnings and errors are known for a release that ran, in the steps whose logs are still kept.
    const logged = logsFrom !== undefined && start + width > logsFrom
    const onDay = step === "1d" ? people.get(calendarDayOf(DateTime.makeUnsafe(start))) : undefined
    return {
      start: DateTime.makeUnsafe(start),
      ...(counted === undefined ? {} : { requests: counted.count, failed: counted.errors, p95Ms: counted.p95Ms }),
      ...(logged
        ? { warnings: countOf("warn", start), errors: countOf("error", start) + countOf("fatal", start) }
        : {}),
      ...(onDay === undefined ? {} : { people: onDay }),
    }
  })
  const sum = (of: (point: LifePoint) => number | undefined) =>
    points.reduce((total, point) => total + (of(point) ?? 0), 0)
  const totals: LifeTotals = {
    from: DateTime.makeUnsafe(span.from),
    to: DateTime.makeUnsafe(span.to),
    // Known only when the counts cover its whole life: minute counts, which a life under two days
    // is read from, are kept 14 days, so an older short life's requests are unknown, not 0.
    ...(load?.covered !== undefined && DateTime.toEpochMillis(load.covered.from) <= from
      ? { requests: sum((point) => point.requests), failed: sum((point) => point.failed) }
      : {}),
    ...(logsFrom === undefined
      ? {}
      : {
          warnings: sum((point) => point.warnings),
          errors: sum((point) => point.errors),
          ...(logsFrom > from ? { logsFrom: DateTime.makeUnsafe(logsFrom) } : {}),
        }),
    ...(usage?.covered === undefined ? {} : { people: usage.people }),
  }
  const life: Omit<ReleaseLife, "previous"> = { step, points, totals }
  return life
})
