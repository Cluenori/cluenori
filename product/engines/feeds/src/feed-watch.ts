import type { ComponentKey } from "@cluenori/foundation"
import { ActivityLog, EnvelopeName, ProcessName, Source } from "@cluenori/foundation"
import { isProduction, Projects } from "@cluenori/projects"
import type { AppBatch, CountryCode } from "@cluenori/signals"
import { Context, DateTime, Duration, Effect, Layer, Option, Schema } from "effect"
import { SqlClient, SqlSchema } from "effect/sql"

import { FeedEventSeen, FeedWatchChanged } from "./feeds-activity.ts"
import { migrateFeedWatch } from "./feeds-migrations.ts"

const source = Source.make("engine:feeds")
const actor = { _tag: "System" as const, process: ProcessName.make("feeds.watch") }

// A signal is forwarded once within this long, as long as the apps' own duplicate window.
const forwardedKept = Duration.toMillis(Duration.days(14))

// A device clock this far off is corrected by the batch's `sentAt`, as Signals corrects it.
const clockTolerance = Duration.toMillis(Duration.minutes(1))

const EventRow = Schema.Struct({ event: EnvelopeName })
const SignalRow = Schema.Struct({ signal: Schema.String })

/**
 * The project's side of feeds, in its Durable Object: which event names its feeds watch, as the
 * workspace's object says, and forwarding each that arrives in a production environment, once, as
 * `feed_event.seen` activity, which the activity queue takes to the workspace's object.
 */
export class FeedWatch extends Context.Service<
  FeedWatch,
  {
    /** The event names the project's feeds watch, by name. Reads only. */
    readonly events: Effect.Effect<ReadonlyArray<EnvelopeName>>
    /**
     * Watches exactly `events` from now on, in place of those before; nothing, when empty. Records
     * `feed_watch.changed` when that changes anything. Idempotent.
     */
    readonly watch: (events: ReadonlyArray<EnvelopeName>) => Effect.Effect<void>
    /**
     * Forwards the events of `batch` that the project's feeds watch, when its environment is one the
     * project calls production: one `feed_event.seen` for each signal not forwarded within 14 days,
     * so a batch its SDK sends again forwards nothing twice. Call it after the apps' signals took the
     * batch. Returns how many it forwarded.
     */
    readonly forward: (
      component: ComponentKey,
      country: CountryCode | undefined,
      batch: AppBatch,
    ) => Effect.Effect<number>
  }
>()("@cluenori/feeds/feed-watch/FeedWatch") {
  /** Builds the project's side on its database, first creating or updating its tables. */
  static readonly layer = Layer.effect(
    FeedWatch,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const log = yield* ActivityLog
      const projects = yield* Projects
      yield* migrateFeedWatch.pipe(Effect.orDie)
      const encodeSeen = Schema.encodeEffect(FeedEventSeen)

      const findEvents = SqlSchema.findAll({
        Request: Schema.Void,
        Result: EventRow,
        execute: () => sql`SELECT event FROM feed_watch_events ORDER BY event`,
      })
      const events = findEvents(undefined).pipe(
        Effect.orDie,
        Effect.map((rows) => rows.map((row) => row.event)),
        Effect.withSpan("FeedWatch.events"),
      )

      const watch = Effect.fn("FeedWatch.watch")(function* (wanted: ReadonlyArray<EnvelopeName>) {
        const next = [...new Set(wanted)].toSorted()
        const now = yield* events
        if (now.length === next.length && now.every((event, index) => event === next[index])) {
          return
        }
        yield* log.commit({
          source,
          actor,
          write: Effect.gen(function* () {
            yield* sql`DELETE FROM feed_watch_events`
            for (const event of next) {
              yield* sql`INSERT INTO feed_watch_events ${sql.insert({ event })}`
            }
          }).pipe(Effect.orDie),
          activity: () => [{ payload: FeedWatchChanged.make({ events: next }) }],
        })
      })

      const findForwarded = SqlSchema.findAll({
        Request: Schema.Array(Schema.String),
        Result: SignalRow,
        execute: (signals) => sql`SELECT signal FROM feed_watch_forwarded WHERE ${sql.in("signal", signals)}`,
      })

      const forward = Effect.fn("FeedWatch.forward")(function* (
        component: ComponentKey,
        country: CountryCode | undefined,
        batch: AppBatch,
      ) {
        const watched = new Set<string>(yield* events)
        if (watched.size === 0) {
          return 0
        }
        const candidates = batch.signals.flatMap((signal) =>
          signal._tag === "event" && watched.has(signal.name) ? [signal] : [],
        )
        if (candidates.length === 0) {
          return 0
        }
        // A project that doesn't exist has no feeds to forward to.
        const settings = yield* projects.settings.pipe(Effect.option)
        if (Option.isNone(settings) || !isProduction(settings.value, batch.environment)) {
          return 0
        }
        const current = DateTime.toEpochMillis(yield* DateTime.now)
        const offBy = current - DateTime.toEpochMillis(batch.sentAt)
        const skew = Math.abs(offBy) > clockTolerance ? offBy : 0
        const done = new Set(
          (yield* findForwarded(candidates.map((signal) => signal.id)).pipe(Effect.orDie)).map((row) => row.signal),
        )
        const fresh = candidates.filter((signal, index) => {
          const first = !done.has(signal.id) && candidates.findIndex((other) => other.id === signal.id) === index
          return first
        })
        if (fresh.length === 0) {
          return 0
        }
        const payloads = yield* Effect.forEach(fresh, (signal) =>
          encodeSeen(
            FeedEventSeen.make({
              signal: signal.id,
              event: signal.name,
              // Never later than now: a clock ahead can't put an entry in the future.
              at: DateTime.makeUnsafe(Math.min(current, DateTime.toEpochMillis(signal.at) + skew)),
              component,
              environment: batch.environment,
              release: batch.release,
              ...(country === undefined ? {} : { country }),
              ...(signal.user === undefined ? {} : { user: signal.user }),
            }),
          ).pipe(Effect.orDie),
        )
        const [first, ...rest] = payloads.map((payload) => ({
          payload,
          component,
          environment: batch.environment,
          release: batch.release,
        }))
        if (first === undefined) {
          return 0
        }
        yield* log.commit({
          source,
          actor,
          write: Effect.gen(function* () {
            yield* sql`DELETE FROM feed_watch_forwarded WHERE at < ${current - forwardedKept}`
            for (const signal of fresh) {
              yield* sql`INSERT INTO feed_watch_forwarded ${sql.insert({ signal: signal.id, at: current })}`
            }
          }).pipe(Effect.orDie),
          activity: () => [first, ...rest],
        })
        return fresh.length
      })

      return FeedWatch.of({ events, watch, forward })
    }),
  )
}
