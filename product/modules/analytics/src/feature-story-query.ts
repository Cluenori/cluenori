import { CalendarDay, calendarDayOf, Period } from "@cluenori/foundation"
import type { FeatureQuery } from "@cluenori/signals"
import { AppSignals, logRetention, Signals } from "@cluenori/signals"
import { DateTime, Duration, Effect } from "effect"

import type { FeatureStory } from "./feature-story.ts"
import { FeatureNotFound } from "./feature-story.ts"

// How many of a feature's errors the story lists, the most frequent first.
const errorsListed = 10

/**
 * One feature's story, its parts asked together. Fails with `FeatureNotFound` when nothing kept
 * names it; narrowed to a component, its parts may all be empty instead, as other clients may use it.
 */
export const featureStoryOf = Effect.fn("Analytics.featureStory")(function* (query: FeatureQuery) {
  const apps = yield* AppSignals
  const signals = yield* Signals
  const now = yield* DateTime.now
  const kept = new Period({ from: DateTime.subtract(now, { days: Duration.toDays(logRetention) }), to: now })
  const scope = {
    feature: query.feature,
    ...(query.environment === undefined ? {} : { environment: query.environment }),
    ...(query.component === undefined ? {} : { component: query.component }),
  }
  const [use, counted, errors, operations] = yield* Effect.all(
    [
      apps.feature(query),
      signals.logCounts({ period: kept, step: "1d", by: "level", ...scope }),
      signals.errors({ period: kept, ...scope }),
      signals.featureOperations(query),
    ],
    { concurrency: "unbounded" },
  )
  if (
    query.component === undefined &&
    use.days.length === 0 &&
    counted.series.length === 0 &&
    operations.length === 0
  ) {
    return yield* new FeatureNotFound({ feature: query.feature })
  }
  const byDay = new Map<string, { warnings: number; errors: number }>()
  for (const series of counted.series) {
    for (const point of series.points) {
      const day = calendarDayOf(point.start)
      const counts = byDay.get(day) ?? { warnings: 0, errors: 0 }
      if (series.key === "warn") {
        counts.warnings += point.count
      } else {
        counts.errors += point.count
      }
      byDay.set(day, counts)
    }
  }
  const story: FeatureStory = {
    feature: query.feature,
    asOf: now,
    use,
    logs: {
      ...(counted.covered === undefined ? {} : { covered: counted.covered }),
      days: [...byDay]
        .toSorted(([left], [right]) => (left < right ? -1 : 1))
        .map(([day, counts]) => ({ day: CalendarDay.make(day), ...counts })),
      errors: errors.groups.slice(0, errorsListed),
    },
    operations,
  }
  return story
})
