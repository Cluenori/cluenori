import type { TodayItem } from "@cluenori/today"
import { Console, Effect } from "effect"
import { Command } from "effect/cli"

import { apiClient, reachFailures } from "./api-client.ts"
import { apiTarget } from "./api-settings.ts"
import { local } from "./question.ts"
import { count, milliseconds, utcMinute } from "./terminal-text.ts"

// What kind of error item it is: new, happening now, or both.
const errorKind = (item: { readonly isNew: boolean; readonly ongoing: boolean }) => {
  if (item.isNew && item.ongoing) {
    return "New error, now"
  }
  return item.ongoing ? "Error, now" : "New error"
}

// What an item is, and its evidence, in two columns.
const describe = (item: TodayItem): readonly [string, string] => {
  switch (item._tag) {
    case "incident":
      return [
        item.incident.acknowledgedAt === undefined ? "Incident" : "Incident, acknowledged",
        `${item.incident.title}, since ${utcMinute(item.incident.openedAt)}`,
      ]
    case "error":
      return [errorKind(item), `${item.error.title}, ${count(item.error.occurrences)} in the last day`]
    case "slower":
      return [
        "Slower",
        `${item.operation}: p95 ${milliseconds(item.p95Ms)} over the last day, usually ${milliseconds(item.usualP95Ms)}`,
      ]
    case "silent":
      return [
        "No data",
        item.lastDataAt === undefined
          ? "nothing in the last 8 days"
          : `nothing in the last day; last at ${utcMinute(item.lastDataAt)}`,
      ]
  }
}

/** `cluenori today`. */
export const today = Command.make("today", { local }, (input) =>
  Effect.gen(function* () {
    const target = yield* apiTarget(input.local)
    const client = yield* apiClient(target)
    const list = yield* client.today.today().pipe(Effect.catchTags(reachFailures(target)))
    const names = new Map(list.projects.map((project) => [project.key, project.name]))
    const looked = `looked at ${utcMinute(list.at)}`
    yield* Console.log(
      list.items.length === 0
        ? `Nothing needs you on ${target.url}, ${looked}.`
        : `${list.items.length === 1 ? "1 thing needs" : `${list.items.length} things need`} you on ${target.url}, ${looked}:\n`,
    )
    // Kind and project in columns; the evidence, a sentence, after them.
    const rows = list.items.map((item) => [...describe(item), names.get(item.project) ?? item.project] as const)
    const kindWidth = Math.max(0, ...rows.map(([kind]) => kind.length))
    const projectWidth = Math.max(0, ...rows.map(([, , project]) => project.length))
    for (const [kind, evidence, project] of rows) {
      yield* Console.log(`${kind.padEnd(kindWidth)}  ${project.padEnd(projectWidth)}  ${evidence}`)
    }
    if (list.unanswered.length > 0) {
      yield* Console.log(
        `\nThese projects didn't answer, so what they would show is missing: ${list.unanswered.join(", ")}.`,
      )
    }
  }),
).pipe(
  Command.withDescription("What needs you now across every project: incidents, errors, slower operations, silence."),
)
