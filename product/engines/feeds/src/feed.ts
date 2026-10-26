import {
  ComponentKey,
  EnvelopeName,
  EnvironmentKey,
  Instant,
  ProjectKey,
  ReleaseVersion,
  Uuidv7,
} from "@cluenori/foundation"
import { AppUserId, CountryCode } from "@cluenori/signals"
import { Schema } from "effect"

/** A feed's ID. */
export const FeedId = Uuidv7.pipe(Schema.brand("FeedId")).annotate({ identifier: "FeedId" })
export type FeedId = typeof FeedId.Type

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

/** What a feed is called, as its page and its alerts say it: `Registrations`. 1 to 60 characters. */
export const FeedName = Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1), Schema.isMaxLength(60)).annotate(
  { identifier: "FeedName" },
)

/**
 * How a feed's entries reach members' phones: `none`, only on its page; `quiet`, without a sound;
 * `timeSensitive`, with a sound, through a Focus that allows it. Never an alarm: alarms are for what
 * is broken.
 */
export const FeedLevel = Schema.Literals(["none", "quiet", "timeSensitive"]).annotate({ identifier: "FeedLevel" })
export type FeedLevel = typeof FeedLevel.Type

/** One event a feed watches: the name a project's apps track it by there, `user.registered`. */
export const FeedSource = Schema.Struct({ project: ProjectKey, event: EnvelopeName }).annotate({
  identifier: "FeedSource",
})
export type FeedSource = typeof FeedSource.Type

/** At most this many sources in one feed. */
export const sourcesPerFeed = 50

/** A feed as its owner writes it: its name, its level, and 1 to 50 sources, each once. */
export const FeedInput = Schema.Struct({
  name: FeedName,
  level: FeedLevel,
  sources: Schema.Array(FeedSource).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(sourcesPerFeed),
    Schema.makeFilter(
      (sources) => new Set(sources.map((source) => `${source.project} ${source.event}`)).size === sources.length,
      { expected: "each source once" },
    ),
  ),
}).annotate({ identifier: "FeedInput" })
export type FeedInput = typeof FeedInput.Type

/** A feed: the events it watches across projects, and how its entries reach phones. */
export const Feed = Schema.Struct({
  id: FeedId,
  ...FeedInput.fields,
}).annotate({ identifier: "Feed" })
export type Feed = typeof Feed.Type

/** How many of a feed's entries came from one project in the last 7 days. */
export const FeedProjectCount = Schema.Struct({ project: ProjectKey, lastWeek: Count }).annotate({
  identifier: "FeedProjectCount",
})

/**
 * A feed as a list shows it, with how many entries arrived in the last 24 hours and the last 7 days,
 * and the last 7 days' by project, the most first; and when the newest arrived, absent before any.
 */
export const FeedSummary = Schema.Struct({
  feed: Feed,
  lastDay: Count,
  lastWeek: Count,
  byProject: Schema.Array(FeedProjectCount),
  latest: Schema.optionalKey(Instant),
}).annotate({ identifier: "FeedSummary" })
export type FeedSummary = typeof FeedSummary.Type

/** The workspace's feeds, by name. */
export const FeedList = Schema.Struct({ feeds: Schema.Array(FeedSummary) }).annotate({ identifier: "FeedList" })
export type FeedList = typeof FeedList.Type

/**
 * One event a feed watched arriving: the project and the event, when it happened, the component,
 * environment and release that sent it, the country it came from, and the app's ID for the person,
 * when the app had identified them. `id` orders entries as they were recorded.
 */
export const FeedEntry = Schema.Struct({
  id: Schema.Int,
  project: ProjectKey,
  event: EnvelopeName,
  at: Instant,
  component: ComponentKey,
  environment: EnvironmentKey,
  release: ReleaseVersion,
  country: Schema.optionalKey(CountryCode),
  user: Schema.optionalKey(AppUserId),
}).annotate({ identifier: "FeedEntry" })
export type FeedEntry = typeof FeedEntry.Type

/**
 * A page of a feed's entries, newest first, 100 at a time: `next` continues with older ones, when
 * there are more. Entries are kept 90 days.
 */
export const FeedEntries = Schema.Struct({
  summary: FeedSummary,
  entries: Schema.Array(FeedEntry),
  next: Schema.optionalKey(Schema.Int),
}).annotate({ identifier: "FeedEntries" })
export type FeedEntries = typeof FeedEntries.Type

/** The workspace has no feed with this ID, or none whose sources the member sees. */
export class FeedNotFound extends Schema.TaggedError<FeedNotFound>()("FeedNotFound", { feed: FeedId }) {}
