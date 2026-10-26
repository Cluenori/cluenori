import type { ProjectPulse, PromotionItem, TodayItem } from "@cluenori/today"
import { Console, Effect } from "effect"
import { Command } from "effect/cli"

import { apiClient, reachFailures } from "./api-client.ts"
import { apiTarget } from "./api-settings.ts"
import { local } from "./question.ts"
import { count, milliseconds, span, utcMinute } from "./terminal-text.ts"

// What kind of error item it is: new, happening now, or both.
const errorKind = (item: { readonly isNew: boolean; readonly ongoing: boolean }) => {
  if (item.isNew && item.ongoing) {
    return "New error, now"
  }
  return item.ongoing ? "Error, now" : "New error"
}

// What a promotion needs, in a sentence.
const promotionText = (item: PromotionItem) => {
  const what = `${item.release} of ${item.component}`
  const at = utcMinute(item.endedAt ?? item.startedAt)
  switch (item.state) {
    case "approved":
      return `${what}, approved in App Store review, to release in ${item.environment}`
    case "waiting":
      return `${what}, waiting on GitHub for someone to approve ${item.environment}`
    case "failed":
      return `${what}, failed to reach ${item.environment} at ${at}`
    case "rejected":
      return `${what}, rejected in App Store review for ${item.environment} at ${at}`
    case "lost":
      return `${what}, lost on its way to ${item.environment} at ${at}; GitHub or App Store Connect has the rest`
  }
}

// `1 person`, `310 people`.
const people = (value: number) => (value === 1 ? "1 person" : `${count(value)} people`)

// How a project is going: its load over the last 24 hours, and its apps' people when it has any.
const pulseText = (pulse: ProjectPulse) => {
  const ran = pulse.load.reduce((total, hour) => total + hour.count, 0)
  const failed = pulse.load.reduce((total, hour) => total + hour.errors, 0)
  const load =
    pulse.load.length === 0
      ? "nothing reported in the last 24 hours"
      : `${count(ran)} operations in the last 24 hours, ${count(failed)} failed`
  if (pulse.people === undefined) {
    return load
  }
  const { latest, weekBefore } = pulse.people
  const before = weekBefore === undefined ? "" : `, ${count(weekBefore.people)} a week before`
  return `${load}; ${people(latest.people)} on ${latest.day}${before}`
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
    case "quiet":
      return [
        "Quiet, a guess",
        `${item.operation}: usually runs about every ${span(item.usualGapMs)}, none since ${utcMinute(item.lastRanAt)}; maybe fine`,
      ]
    case "promotion":
      return [
        item.state === "approved" || item.state === "waiting" ? "Release waits" : "Release failed",
        promotionText(item),
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
    // Each project's pulse, from a deployment that sends them.
    const pulses = (list.pulses ?? []).map(
      (pulse) => [names.get(pulse.project) ?? pulse.project, pulseText(pulse)] as const,
    )
    if (pulses.length > 0) {
      const nameWidth = Math.max(0, ...pulses.map(([name]) => name.length))
      yield* Console.log("\nHow each project is going, in production:")
      for (const [name, text] of pulses) {
        yield* Console.log(`${name.padEnd(nameWidth)}  ${text}`)
      }
    }
    if (list.unanswered.length > 0) {
      yield* Console.log(
        `\nThese projects didn't answer, so what they would show is missing: ${list.unanswered.join(", ")}.`,
      )
    }
  }),
).pipe(
  Command.withDescription(
    "What needs you now across every project: incidents, errors, slower operations, releases waiting or failed, silence; and how each project is going.",
  ),
)
