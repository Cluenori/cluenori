import { isSecretName } from "@bagatka/scrub"
import type { ComponentKey } from "@cluenori/foundation"
import {
  calendarDayOf,
  ComponentKey as ComponentKeySchema,
  EnvelopeName,
  EnvironmentKey,
  InstallationId,
  Instant,
  PersonId,
  ReleaseVersion,
} from "@cluenori/foundation"
import type { SdkKey } from "@cluenori/projects"
import { Context, Crypto, DateTime, Duration, Effect, Layer, Ref, Schema } from "effect"
import { SqlClient } from "effect/sql"

import { AppBatchStore } from "./app-batch-store.ts"
import type { AppBatch, AppBatchAccepted, AppSignal } from "./app-batch.ts"
import { AppDevice, AppSdk, AppSignal as AppSignalSchema, TooManySignals } from "./app-batch.ts"
import type {
  AppHealth,
  AppPerson,
  AppQuery,
  AppReleaseKey,
  AppReleaseList,
  AppReleaseQuery,
  AppRetention,
  AppUsage,
  EventCountQuery,
  FeatureUseLife,
  FeatureUseTable,
  PersonLookup,
  PersonNotFound,
  RetentionQuery,
} from "./app-queries.ts"
import { CountryCode } from "./app-queries.ts"
import type { AppRateLimits } from "./app-rate-limits.ts"
import { defaultAppRateLimits, emptyWindow, takeBatch } from "./app-rate-limits.ts"
import type { BatchSource, PeoplePlan } from "./app-store.ts"
import { appStore } from "./app-store.ts"
import { keptSignalOf, talliesOf } from "./app-tallies.ts"
import type { ArchiveSettings } from "./archive-index.ts"
import type { ArchiveUnavailable } from "./archive-store.ts"
import type { FeatureQuery } from "./feature-queries.ts"
import { scrubbedText } from "./scrubbed.ts"
import { migrateSignals } from "./signals-migrations.ts"

/** Whose apps' signals these are, and, for tests, the limits on how much they take. */
export interface AppSignalsSettings extends ArchiveSettings {
  readonly limits?: AppRateLimits
}

/** Who sent a batch: the component whose SDK key it carried, the key, and the country it came from. */
export interface AppSender {
  readonly component: ComponentKey
  readonly key: SdkKey
  readonly country?: CountryCode
}

// A device clock this far off is corrected by the batch's `sentAt`; closer, it is taken as it is.
const clockTolerance = Duration.minutes(1)

// Old data is removed while recording, at most this often.
const cleanupInterval = Duration.minutes(10)

/** A batch as the archive keeps it: scrubbed, each signal with its person instead of the app's user ID. */
const ArchivedBatch = Schema.fromJsonString(
  Schema.Struct({
    component: ComponentKeySchema,
    installation: InstallationId,
    environment: EnvironmentKey,
    release: ReleaseVersion,
    device: AppDevice,
    sdk: AppSdk,
    country: Schema.optionalKey(CountryCode),
    receivedAt: Instant,
    signals: Schema.Array(Schema.Struct({ person: PersonId, signal: AppSignalSchema })),
  }),
)

// A name without credentials or personal data; one the scrubbing made no name is replaced.
const scrubbedName = (name: EnvelopeName) => {
  const scrubbed = scrubbedText(name)
  return Schema.is(EnvelopeName)(scrubbed) ? scrubbed : EnvelopeName.make("[scrubbed]")
}

// A property's value without credentials or personal data; one named like a credential is removed.
const scrubbedProperty = (key: string, value: unknown) => {
  if (typeof value !== "string") {
    return value
  }
  return isSecretName(key) ? "[secret]" : scrubbedText(value)
}

// MetricKit's JSON without credentials or personal data in any text, and values named like
// credentials removed whole.
const scrubbedJson = (value: unknown, name: string): unknown => {
  if (typeof value === "string") {
    return isSecretName(name) ? "[secret]" : scrubbedText(value)
  }
  if (Array.isArray(value)) {
    return value.map((item) => scrubbedJson(item, name))
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrubbedJson(item, key)]))
  }
  return value
}

/** A signal without credentials or personal data in its names, its properties, or MetricKit's report. */
const scrubbedSignal = (signal: AppSignal): AppSignal => {
  switch (signal._tag) {
    case "screen":
      return { ...signal, screen: scrubbedName(signal.screen) }
    case "event": {
      const properties = signal.properties
      return {
        ...signal,
        name: scrubbedName(signal.name),
        ...(properties === undefined
          ? {}
          : {
              properties: Object.fromEntries(
                Object.entries(properties).map(([key, value]) => [key, scrubbedProperty(key, value)]),
              ),
            }),
      }
    }
    case "metrickit":
      return { ...signal, payload: scrubbedJson(signal.payload, "payload") }
    case "session.started":
    case "session.ended":
    case "app.launched":
    case "app.memory":
      return signal
  }
}

// A batch from a device whose clock is off: each signal's time moved by how far `sentAt` is from
// `now`, as the device's clock was off by that much when it recorded them.
const correctedSignal = (signal: AppSignal, skew: number): AppSignal =>
  skew === 0 ? signal : { ...signal, at: DateTime.makeUnsafe(DateTime.toEpochMillis(signal.at) + skew) }

/**
 * The signals of a project's apps: what their SDKs send, by installation and person, and the
 * questions asked of it: usage, retention, each release's health, features, and one person. Runs
 * inside the Durable Object that holds the project's database.
 */
export class AppSignals extends Context.Service<
  AppSignals,
  {
    /**
     * Records a batch `sender` sent: each signal whose ID wasn't seen in the last 14 days, the rest
     * counted as duplicates, so a batch sent again counts once. Texts are scrubbed first, and the
     * signals' times corrected when the device's clock is more than a minute off from `sentAt`. The
     * new signals are archived first, with each person instead of the app's user ID, then counted in
     * one transaction. Fails with `TooManySignals` when the key sent 1,200 batches this minute or the
     * installation 20, having read nothing; with `ArchiveUnavailable` when they can't be archived,
     * having counted nothing, so the batch should be sent again.
     */
    readonly record: (
      sender: AppSender,
      batch: AppBatch,
    ) => Effect.Effect<AppBatchAccepted, TooManySignals | ArchiveUnavailable>
    /**
     * Usage over the query's period: by UTC day the people, installations, sessions and foreground
     * time, and the people of the 7 and 30 days ending each day; the period's totals, overall and
     * by release. Days before the apps first sent anything, or older than the 15 months kept, aren't
     * counted. Reads one row per installation and day, and those of the 30 days before each day.
     */
    readonly usage: (query: AppQuery) => Effect.Effect<AppUsage>
    /** Weekly cohorts of the people first seen in the query's period, and how many came back each week. */
    readonly retention: (query: RetentionQuery) => Effect.Effect<AppRetention>
    /** The releases that sent anything in the query's period, each with the release before it. Reads one row per release. */
    readonly releases: (query: AppReleaseQuery) => Effect.Effect<AppReleaseList>
    /** One release's health over everything kept of it: sessions, people, launches, memory and MetricKit's diagnostics. */
    readonly health: (release: AppReleaseKey) => Effect.Effect<AppHealth>
    /** Each feature's people, events, screens and memory in the query's period, and those of no feature. */
    readonly features: (query: AppQuery) => Effect.Effect<FeatureUseTable>
    /**
     * One feature's use over everything kept of it (15 months), that key exactly, optionally in one
     * environment: each day's people, events and screens, everyone who used it, the 20 who used it
     * last, its releases and its memory. Empty when the apps never marked it. Reads the feature's
     * rows by day and person.
     */
    readonly feature: (query: FeatureQuery) => Effect.Effect<FeatureUseLife>
    /**
     * One person, by their ID or a user ID linked to them: their user IDs, installations, the days
     * they were active, the features they used, and their timeline. Fails with `PersonNotFound`.
     */
    readonly person: (lookup: PersonLookup) => Effect.Effect<AppPerson, PersonNotFound>
    /**
     * How many of one event the apps of a component sent since the query's instant, up to every one
     * already arrived, counted up to `atMost`, as the people's timelines keep them: each person's
     * latest 1,000 signals, 15 months, so a person past 1,000 signals since then counts only their
     * latest. Never 0 when one arrived since: when each event last arrived is kept apart from the
     * timelines, for those that arrived from November 2026 on and those the timelines held then. Reads
     * only that event's signals in the period, through an index, and stops at `atMost`. An event
     * arrives when its batch does, which can be later than it happened.
     */
    readonly eventCount: (query: EventCountQuery, atMost: number) => Effect.Effect<number>
  }
>()("@cluenori/signals/app-signals/AppSignals") {
  /** Builds the apps' signals on the object's database and the store of their batches, first creating or updating the tables. */
  static readonly layer = (settings: AppSignalsSettings) =>
    Layer.effect(
      AppSignals,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const crypto = yield* Crypto.Crypto
        const batches = yield* AppBatchStore
        yield* migrateSignals.pipe(Effect.orDie)
        const store = yield* appStore
        const limits = settings.limits ?? defaultAppRateLimits
        const rateWindow = yield* Ref.make(emptyWindow)
        const lastCleanup = yield* Ref.make(0)
        const encodeArchived = Schema.encodeEffect(ArchivedBatch)

        const cleanUp = Effect.fn("AppSignals.cleanUp")(function* (now: number) {
          const last = yield* Ref.get(lastCleanup)
          if (now - last < Duration.toMillis(cleanupInterval)) {
            return
          }
          yield* store.cleanUp(now)
          yield* Ref.set(lastCleanup, now)
        })

        // Where a batch's new signals are archived: by project, the day they arrived, component,
        // installation, and the first of them, so archiving the same signals again replaces the file.
        const archiveKeyOf = (source: BatchSource, plan: PeoplePlan, now: number) =>
          [
            settings.workspace,
            settings.project,
            calendarDayOf(DateTime.makeUnsafe(now)),
            source.component,
            source.batch.installation,
            `${plan.signals[0]?.signal.id ?? "none"}.json`,
          ].join("/")

        const archive = Effect.fn("AppSignals.archive")(function* (source: BatchSource, plan: PeoplePlan, now: number) {
          const { batch } = source
          const json = yield* encodeArchived({
            component: source.component,
            installation: batch.installation,
            environment: batch.environment,
            release: batch.release,
            device: batch.device,
            sdk: batch.sdk,
            ...(source.country === undefined ? {} : { country: source.country }),
            receivedAt: DateTime.makeUnsafe(now),
            signals: plan.signals.map((each) => ({ person: each.person, signal: keptSignalOf(each.signal) })),
          }).pipe(Effect.orDie)
          yield* batches.put(archiveKeyOf(source, plan, now), json)
        })

        // Inside the transaction: checks again for signals that arrived meanwhile, then writes.
        const commit = Effect.fn("AppSignals.commit")(function* (
          source: BatchSource,
          fresh: ReadonlyArray<AppSignal>,
          candidates: ReadonlyArray<PersonId>,
          now: number,
        ) {
          const again = yield* store.seenOf(fresh.map((signal) => signal.id))
          const still = fresh.filter((signal) => !again.has(signal.id))
          if (still.length === 0) {
            return 0
          }
          // Not handled: a person made by a batch that arrived while this one was archived, which
          // this one planned to make too; its archive file then names an ID the database doesn't
          // have. Handling it takes archiving after the commit, with its own retry.
          const plan = yield* store.peopleOf(source.batch.installation, still, candidates)
          yield* store.write(source, plan, talliesOf(plan.signals, source.batch.release))
          yield* cleanUp(now)
          return still.length
        })

        const record = Effect.fn("AppSignals.record")(function* (sender: AppSender, batch: AppBatch) {
          const current = yield* DateTime.now
          const now = DateTime.toEpochMillis(current)
          const decision = yield* Ref.modify(rateWindow, (window) => {
            const decided = takeBatch(window, limits, sender.key, batch.installation, now)
            return [decided, decided._tag === "Taken" ? decided.window : window] as const
          })
          if (decision._tag === "Refused") {
            return yield* new TooManySignals({ retryAfterSeconds: decision.retryAfterSeconds })
          }
          const offBy = now - DateTime.toEpochMillis(batch.sentAt)
          const skew = Math.abs(offBy) > Duration.toMillis(clockTolerance) ? offBy : 0
          // Each signal once, by its ID, scrubbed and with its time corrected.
          const ids = new Set<string>()
          const unique = batch.signals.filter((signal) => {
            const first = !ids.has(signal.id)
            ids.add(signal.id)
            return first
          })
          const received = unique.map((signal) => correctedSignal(scrubbedSignal(signal), skew))
          const seen = yield* store.seenOf(received.map((signal) => signal.id))
          const fresh = received.filter((signal) => !seen.has(signal.id))
          if (fresh.length === 0) {
            const none: AppBatchAccepted = { accepted: 0, duplicates: batch.signals.length }
            return none
          }
          // A batch makes at most one person for its installation and one for each user ID in it.
          const users = new Set(
            fresh.flatMap((signal) => (signal._tag === "metrickit" || signal.user === undefined ? [] : [signal.user])),
          )
          const candidates = yield* Effect.forEach(Array.from({ length: users.size + 1 }), () =>
            crypto.randomUUIDv7().pipe(
              Effect.map((uuid) => PersonId.make(uuid)),
              Effect.orDie,
            ),
          )
          const source: BatchSource = { component: sender.component, country: sender.country, batch }
          const plan = yield* store.peopleOf(batch.installation, fresh, candidates)
          yield* archive(source, plan, now)
          const accepted = yield* sql.withTransaction(commit(source, fresh, candidates, now)).pipe(Effect.orDie)
          const answer: AppBatchAccepted = { accepted, duplicates: batch.signals.length - accepted }
          return answer
        })

        const nowMillis = DateTime.now.pipe(Effect.map(DateTime.toEpochMillis))

        const usage = Effect.fn("AppSignals.usage")(function* (query: AppQuery) {
          const now = yield* nowMillis
          return yield* store.usage(query, now)
        })

        const retention = Effect.fn("AppSignals.retention")(function* (query: RetentionQuery) {
          const now = yield* nowMillis
          return yield* store.retention(query, now)
        })

        const features = Effect.fn("AppSignals.features")(function* (query: AppQuery) {
          const now = yield* nowMillis
          return yield* store.features(query, now)
        })

        const feature = Effect.fn("AppSignals.feature")(function* (query: FeatureQuery) {
          const now = yield* nowMillis
          return yield* store.featureLife(query, now)
        })

        const person = Effect.fn("AppSignals.person")(function* (lookup: PersonLookup) {
          const now = yield* nowMillis
          return yield* store.person(lookup, now)
        })

        return AppSignals.of({
          record,
          usage,
          retention,
          releases: store.releases,
          health: store.health,
          features,
          feature,
          person,
          eventCount: store.eventCount,
        })
      }),
    )
}
