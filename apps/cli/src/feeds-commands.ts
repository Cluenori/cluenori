import type { FeedEntry, FeedSummary } from "@cluenori/feeds"
import { FeedId } from "@cluenori/feeds"
import { Console, Effect, Option } from "effect"
import { Argument, Command, Flag } from "effect/cli"

import { apiClient, reachFailures, refuse } from "./api-client.ts"
import { apiTarget } from "./api-settings.ts"
import { local, parsed } from "./question.ts"
import { columns, count, utcMinute, utcSecond } from "./terminal-text.ts"

// What a feed watches, each project with its own name for the event: `notes user.registered`.
const sourcesOf = (summary: FeedSummary) =>
  summary.feed.sources.map((source) => `${source.project} ${source.event}`).join(", ")

const levels = { none: "no alerts", quiet: "quiet alerts", timeSensitive: "time-sensitive alerts" } as const

const entryOf = (entry: FeedEntry) => [
  utcSecond(entry.at),
  entry.project,
  entry.event,
  entry.user ?? "not signed in",
  entry.country ?? "",
  `${entry.component} ${entry.release}`,
]

/** `cluenori feeds`. */
export const feeds = Command.make("feeds", { local }, (input) =>
  Effect.gen(function* () {
    const target = yield* apiTarget(input.local)
    const client = yield* apiClient(target)
    const list = yield* client.feeds.feeds().pipe(Effect.catchTags(reachFailures(target)))
    if (list.feeds.length === 0) {
      return yield* Console.log(
        `${target.url} has no feeds you see. An owner makes one on the web, under Feeds: events chosen across projects, such as each project's registrations.`,
      )
    }
    yield* Console.log(
      columns([
        ["Feed", "24 h", "7 days", "Newest", "Alerts", "Watches", "ID"],
        ...list.feeds.map((summary) => [
          summary.feed.name,
          count(summary.lastDay),
          count(summary.lastWeek),
          summary.latest === undefined ? "none yet" : utcMinute(summary.latest),
          levels[summary.feed.level],
          sourcesOf(summary),
          summary.feed.id,
        ]),
      ]).join("\n"),
    )
    yield* Console.log("\nOne feed's entries: ./cluenori feed <ID>")
  }),
).pipe(
  Command.withDescription(
    "The feeds you see: the events each watches across projects, how many arrived in 24 hours and 7 days, and the newest.",
  ),
)

/** `cluenori feed <feed>`. */
export const feed = Command.make(
  "feed",
  {
    feed: Argument.String("feed").pipe(Argument.withDescription("The feed's ID, from ./cluenori feeds.")),
    before: Flag.Int("before").pipe(
      Flag.optional,
      Flag.withDescription("Continue with older entries, from the last answer."),
    ),
    local,
  },
  (input) =>
    Effect.gen(function* () {
      const id = yield* parsed(FeedId, input.feed, "a feed's ID")
      const target = yield* apiTarget(input.local)
      const client = yield* apiClient(target)
      const page = yield* client.feeds
        .feed({
          params: { feed: id },
          query: Option.match(input.before, { onNone: () => ({}), onSome: (before) => ({ before }) }),
        })
        .pipe(
          Effect.catchTags({
            ...reachFailures(target),
            FeedNotFound: () => refuse(`${target.url} has no feed ${id} you see. See them: ./cluenori feeds`),
          }),
        )
      const { summary } = page
      yield* Console.log(
        `${summary.feed.name} on ${target.url}: ${count(summary.lastDay)} in 24 hours, ${count(summary.lastWeek)} in 7 days, from production. Watches ${sourcesOf(summary)}.\n`,
      )
      if (page.entries.length === 0) {
        return yield* Console.log("No entries yet, or none older.")
      }
      yield* Console.log(
        columns([["When", "Project", "Event", "Person", "Country", "Release"], ...page.entries.map(entryOf)]).join(
          "\n",
        ),
      )
      if (page.next !== undefined) {
        yield* Console.log(`\nOlder ones: add --before ${page.next}`)
      }
    }),
).pipe(
  Command.withDescription(
    "One feed's entries, newest first, 100 at a time: when, the project and its event, the person, the country, and the release. Kept 90 days.",
  ),
)
