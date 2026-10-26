import { EnvironmentKey, FeatureKey, PersonId, ProjectKey } from "@cluenori/foundation"
import type { TimelineEntry } from "@cluenori/signals"
import { AppUserId } from "@cluenori/signals"
import { Console, Effect, Option } from "effect"
import { Argument, Command, Flag } from "effect/cli"

import { apiClient, reachFailures, refuse } from "./api-client.ts"
import { apiTarget } from "./api-settings.ts"
import { local, optionalKey, parsed } from "./question.ts"
import { columns, count, utcMinute, utcSecond } from "./terminal-text.ts"

const project = Argument.String("project").pipe(Argument.withDescription("The project's key."))

// What one signal of a person's timeline says, in a line.
const timelineLine = (entry: TimelineEntry) => {
  const signal = entry.signal
  const what = (() => {
    switch (signal._tag) {
      case "session.started":
        return "Session started"
      case "session.ended":
        return `Session ended, ${count(Math.round(signal.foregroundMs / 1000))} s in the foreground`
      case "app.launched":
        return `Launched ${signal.start}, first frame ${count(signal.firstFrameMs)} ms`
      case "screen":
        return `Screen ${signal.screen}`
      case "event":
        return signal.name
      case "metrickit":
        return signal.report === "diagnostics"
          ? `MetricKit diagnostics: ${count(signal.crashes)} crashes, ${count(signal.hangs)} hangs`
          : "MetricKit metrics"
    }
  })()
  const feature = "feature" in signal && signal.feature !== undefined ? `  [${signal.feature}]` : ""
  return `${utcSecond(signal.at)}  ${entry.release}  ${what}${feature}`
}

/** `cluenori feature <project> <feature>`. */
export const feature = Command.make(
  "feature",
  {
    project,
    feature: Argument.String("feature").pipe(Argument.withDescription("The feature's key, such as notes.share.")),
    environment: Flag.String("environment").pipe(
      Flag.optional,
      Flag.withDescription("Only this environment, such as production."),
    ),
    local,
  },
  (input) =>
    Effect.gen(function* () {
      const key = yield* parsed(ProjectKey, input.project, "a project key")
      const featureKey = yield* parsed(FeatureKey, input.feature, "a feature's key")
      const environment = yield* optionalKey(EnvironmentKey, input.environment, "an environment's key")
      const target = yield* apiTarget(input.local)
      const client = yield* apiClient(target)
      const story = yield* client.analytics
        .feature({
          params: { project: key, feature: featureKey },
          query: Option.match(environment, { onNone: () => ({}), onSome: (value) => ({ environment: value }) }),
        })
        .pipe(
          Effect.catchTags({
            ...reachFailures(target),
            ProjectNotFound: () => refuse(`${target.url} has no project ${key}.`),
            FeatureNotFound: () =>
              refuse(
                `Nothing kept in ${key} names ${featureKey}: no app marked it in 15 months, and no service named it in cluenori.feature.`,
              ),
          }),
        )
      const { use, logs, operations } = story
      yield* Console.log(`Feature ${featureKey} of ${key}, as of ${utcMinute(story.asOf)}\n`)
      if (use.days.length === 0) {
        yield* Console.log("Apps: no app marked it in the 15 months kept.")
      } else {
        yield* Console.log(
          `Apps: ${count(use.people)} people used it, from ${use.days[0]?.day} to ${use.days.at(-1)?.day}.`,
        )
        yield* Console.log(
          columns([
            ["Day", "People", "Events", "Screens"],
            ...use.days.slice(-14).map((day) => [day.day, count(day.people), count(day.events), count(day.screens)]),
          ]).join("\n"),
        )
        yield* Console.log("\nWho used it last:")
        yield* Console.log(
          columns(
            use.latestPeople.map((person) => [
              person.users[0] ?? "(no user ID)",
              `${count(person.days)} days, ${count(person.events)} events`,
              `last on ${person.lastDay}`,
              person.person,
            ]),
          ).join("\n"),
        )
      }
      if (operations.length === 0 && logs.days.length === 0) {
        return yield* Console.log("\nServices: none named it in cluenori.feature.")
      }
      const byOperation = new Map<string, { count: number; errors: number }>()
      for (const day of operations) {
        const name = `${day.component}  ${day.operation}`
        const total = byOperation.get(name) ?? { count: 0, errors: 0 }
        byOperation.set(name, { count: total.count + day.count, errors: total.errors + day.errors })
      }
      yield* Console.log("\nOperations that ran for it, every day kept:")
      yield* Console.log(
        columns([
          ["Operation", "Count", "Failed"],
          ...[...byOperation]
            .toSorted(([, a], [, b]) => b.count - a.count)
            .map(([name, total]) => [name, count(total.count), count(total.errors)]),
        ]).join("\n"),
      )
      yield* Console.log("\nIts warnings and errors each day, 90 days kept:")
      yield* Console.log(
        logs.days.length === 0
          ? "None."
          : columns([
              ["Day", "Warnings", "Errors"],
              ...logs.days.map((day) => [day.day, count(day.warnings), count(day.errors)]),
            ]).join("\n"),
      )
      if (logs.errors.length > 0) {
        yield* Console.log("\nIts errors, the most frequent first:")
        yield* Console.log(
          columns(logs.errors.map((error) => [error.title, count(error.occurrences), error.id])).join("\n"),
        )
        yield* Console.log(`See one: ./cluenori error ${key} <ID> --last 90d`)
      }
    }),
).pipe(
  Command.withDescription(
    "One feature's story: who uses it each day, and the operations, warnings and errors its services sent for it.",
  ),
)

/** `cluenori person <project> <person ID>`, or `--user <project> <user ID>`. */
export const person = Command.make(
  "person",
  {
    project,
    who: Argument.String("who").pipe(
      Argument.withDescription("Cluenori's ID for the person; with --user, the app's user ID for them."),
    ),
    // An app's user ID may look like a person's ID, such as a UUID, so which one it is is said.
    user: Flag.Boolean("user").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Find them by the app's user ID, as the app gave it to Cluenori.identify."),
    ),
    local,
  },
  (input) =>
    Effect.gen(function* () {
      const key = yield* parsed(ProjectKey, input.project, "a project key")
      const target = yield* apiTarget(input.local)
      const client = yield* apiClient(target)
      const asked = input.user
        ? Effect.flatMap(parsed(AppUserId, input.who, "an app's user ID"), (user) =>
            client.analytics.personByUser({ params: { project: key }, query: { user } }),
          )
        : Effect.flatMap(
            parsed(PersonId, input.who, "a person's ID; to find them by the app's user ID, add --user"),
            (id) => client.analytics.person({ params: { project: key, person: id } }),
          )
      const found = yield* asked.pipe(
        Effect.catchTags({
          ...reachFailures(target),
          ProjectNotFound: () => refuse(`${target.url} has no project ${key}.`),
          PersonNotFound: () =>
            refuse(
              `No person of ${key} has the ${input.user ? "user ID" : "ID"} ${input.who}: the apps never sent it.`,
            ),
        }),
      )
      yield* Console.log(`Person ${found.person} of ${key}`)
      yield* Console.log(`  user IDs: ${found.users.length === 0 ? "none" : found.users.join(", ")}`)
      yield* Console.log(`  first seen ${utcMinute(found.firstSeen)}, last seen ${utcMinute(found.lastSeen)}\n`)
      yield* Console.log("Features they use, the last used first:")
      yield* Console.log(
        found.features.length === 0
          ? "None marked."
          : columns(
              found.features.map((each) => [
                each.feature ?? "(no feature)",
                `${count(each.days)} days, ${count(each.events)} events, ${count(each.screens)} screens`,
                `last on ${each.lastDay}`,
              ]),
            ).join("\n"),
      )
      yield* Console.log("\nInstallations:")
      yield* Console.log(
        columns(
          found.installations.map((each) => [
            `${each.component} ${each.environment} ${each.release}`,
            `${each.device.model}, ${each.device.platform} ${each.device.osVersion}`,
            `last seen ${utcMinute(each.lastSeen)}`,
          ]),
        ).join("\n"),
      )
      yield* Console.log("\nDays active, the latest first:")
      yield* Console.log(
        found.days
          .slice(0, 14)
          .map((day) => `${day.day}  ${count(day.sessions)} sessions`)
          .join("\n"),
      )
      yield* Console.log(
        `\nTimeline, newest first (${count(Math.min(found.timeline.length, 50))} of ${count(found.timeline.length)}):`,
      )
      yield* Console.log(found.timeline.slice(0, 50).map(timelineLine).join("\n"))
    }),
).pipe(
  Command.withDescription(
    "One person: their user IDs, the features they use, their installations, days active, and timeline.",
  ),
)
