import { ComponentKey, EnvelopeName, EnvironmentKey, Instant, ReleaseVersion } from "@cluenori/foundation"
import { AppSignalId, AppUserId, CountryCode } from "@cluenori/signals"
import { Schema } from "effect"

import { FeedId, FeedLevel, FeedName, FeedSource } from "./feed.ts"

/** An owner made a feed, or changed one: its name, level and sources now. */
export const FeedSaved = Schema.TaggedStruct("feed.saved", {
  feed: FeedId,
  name: FeedName,
  level: FeedLevel,
  sources: Schema.Array(FeedSource),
})

/** An owner deleted a feed, and its entries with it. */
export const FeedRemoved = Schema.TaggedStruct("feed.removed", { feed: FeedId })

/** The event names a project's object forwards to feeds changed. */
export const FeedWatchChanged = Schema.TaggedStruct("feed_watch.changed", { events: Schema.Array(EnvelopeName) })

/**
 * An event a feed watches arrived in a project's production environment, once for each signal: the
 * workspace's object makes it an entry of every feed that watches it. In the project's activity,
 * its component, environment and release are the envelope's.
 */
export const FeedEventSeen = Schema.TaggedStruct("feed_event.seen", {
  signal: AppSignalId,
  event: EnvelopeName,
  at: Instant,
  component: ComponentKey,
  environment: EnvironmentKey,
  release: ReleaseVersion,
  country: Schema.optionalKey(CountryCode),
  user: Schema.optionalKey(AppUserId),
})
export type FeedEventSeen = typeof FeedEventSeen.Type
