import { Period } from "@cluenori/foundation"
import { Incidents } from "@cluenori/incidents"
import type { ProjectNotFound } from "@cluenori/projects"
import { Projects } from "@cluenori/projects"
import { Signals } from "@cluenori/signals"
import { Context, DateTime, Effect, Layer } from "effect"

import { itemsOf } from "./detectors.ts"
import type { TodayItem } from "./today-item.ts"

/**
 * What needs attention in one project now. Runs inside the Durable Object that holds the project's
 * database, beside the engines it reads.
 */
export class Today extends Context.Service<
  Today,
  {
    /**
     * The project's items at the clock's time, in no order: its open incidents, its errors new or
     * happening now, its operations slower than over the 7 days before, and the project itself when
     * it has components but sent nothing in the last day. Reads only: the incidents, the errors of
     * the last day, and the operations of the last day and of the 7 days before.
     */
    readonly items: Effect.Effect<ReadonlyArray<TodayItem>, ProjectNotFound>
  }
>()("@cluenori/today/today") {
  /** Builds the engine on the object's Incidents, Signals, and Projects. */
  static readonly layer = Layer.effect(
    Today,
    Effect.gen(function* () {
      const incidents = yield* Incidents
      const signals = yield* Signals
      const projects = yield* Projects

      const items = Effect.gen(function* () {
        const project = yield* projects.project
        const components = yield* projects.components
        const now = yield* DateTime.now
        const dayAgo = DateTime.subtract(now, { days: 1 })
        const lastDay = new Period({ from: dayAgo, to: now })
        const weekBefore = new Period({ from: DateTime.subtract(now, { days: 8 }), to: dayAgo })
        return itemsOf({
          project: project.key,
          incidents: yield* incidents.incidents,
          errors: yield* signals.errors({ period: lastDay }),
          operations: {
            lastDay: yield* signals.operations({ period: lastDay }),
            usual: yield* signals.operations({ period: weekBefore }),
          },
          components: components.length,
          now: DateTime.toEpochMillis(now),
        })
      }).pipe(Effect.withSpan("Today.items"))

      return Today.of({ items })
    }),
  )
}
