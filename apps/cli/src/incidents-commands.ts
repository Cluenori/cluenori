import { ComponentKey, EnvelopeName, EnvironmentKey, ProjectKey } from "@cluenori/foundation"
import type { Incident, Monitor, MonitorCondition } from "@cluenori/incidents"
import { AddMonitor, IncidentId, MonitorId, MonitorUrl } from "@cluenori/incidents"
import { ErrorGroupId, LogMessageId } from "@cluenori/signals"
import { Console, Effect, Option, Schema } from "effect"
import { Argument, Command, Flag } from "effect/cli"

import { apiClient, reachFailures, refuse } from "./api-client.ts"
import type { ApiTarget } from "./api-settings.ts"
import { apiTarget } from "./api-settings.ts"
import { local, parsed } from "./question.ts"
import { columns, count, milliseconds, minutesWords, span, uptime, utcMinute } from "./terminal-text.ts"

const projectArgument = Argument.String("project").pipe(Argument.withDescription("The project's key."))

const noProject = (target: ApiTarget, project: ProjectKey) => () => refuse(`${target.url} has no project ${project}.`)

// What a monitor watches: a URL, an operation, or an event, error or log message by its name or ID.
const subjectWords = (subject: MonitorCondition["subject"]) => {
  switch (subject._tag) {
    case "url":
      return subject.url
    case "operation":
      return subject.operation
    case "event":
      return `event ${subject.event}`
    case "error":
      return `error ${subject.error}`
    case "message":
      return `log message ${subject.message}`
  }
}

// A monitor's subject and condition, in a line: `cleanup.run: nothing for 30 minutes`.
const conditionWords = (condition: MonitorCondition) => {
  const name = subjectWords(condition.subject)
  switch (condition._tag) {
    case "noAnswer":
      return `${name}: doesn't answer two checks in a row`
    case "nothingFor":
      return `${name}: nothing for ${minutesWords(condition.minutes)}`
    case "moreThan":
      return `${name}: more than ${count(condition.count)} in ${minutesWords(condition.minutes)}`
    case "latencyAbove":
      return `${name}: p${condition.percentile} above ${milliseconds(condition.ms)} over ${minutesWords(condition.minutes)}`
    case "errorRateAbove":
      return `${name}: more than ${condition.percent}% failed over ${minutesWords(condition.minutes)}`
  }
}

const levelWords = { alarm: "alarm", timeSensitive: "time sensitive", quiet: "quiet" } as const

const monitorWhere = (monitor: Monitor) =>
  monitor.environment === undefined ? monitor.component : `${monitor.component} (${monitor.environment})`

const titleOf = (incident: Incident) =>
  incident.acknowledgedAt === undefined ? incident.title : `${incident.title} (acknowledged)`

/** `cluenori incidents <project>`. */
export const incidents = Command.make("incidents", { project: projectArgument, local }, (input) =>
  Effect.gen(function* () {
    const project = yield* parsed(ProjectKey, input.project, "a project key")
    const target = yield* apiTarget(input.local)
    const client = yield* apiClient(target)
    const list = yield* client.incidents
      .incidents({ params: { project } })
      .pipe(Effect.catchTags({ ...reachFailures(target), ProjectNotFound: noProject(target, project) }))
    yield* Console.log(
      list.checkedAt === undefined
        ? `${project} on ${target.url}: the detectors haven't looked yet. They look every minute from the project's first request on.\n`
        : `${project} on ${target.url}: the detectors last looked at ${utcMinute(list.checkedAt)}.\n`,
    )
    if (list.open.length === 0) {
      yield* Console.log("No open incidents.")
    } else {
      yield* Console.log(
        columns([
          ["Since", "Incident", "ID"],
          ...list.open.map((incident) => [utcMinute(incident.openedAt), titleOf(incident), incident.id]),
        ]).join("\n"),
      )
      yield* Console.log(`\nAcknowledge one, which stops its notifications: ./cluenori acknowledge ${project} <ID>`)
    }
    if (list.resolved.length > 0) {
      yield* Console.log("\nResolved in the last 7 days, the latest first:")
      yield* Console.log(
        columns([
          ["Opened", "Resolved", "Incident"],
          ...list.resolved.map((incident) => [
            utcMinute(incident.openedAt),
            incident.resolvedAt === undefined ? "" : utcMinute(incident.resolvedAt),
            titleOf(incident),
          ]),
        ]).join("\n"),
      )
    }
    if (list.quiet.length > 0) {
      yield* Console.log(
        "\nQuiet, a guess: operations that usually run regularly and haven't. Maybe fine; nothing was alerted.",
      )
      for (const quiet of list.quiet) {
        const where = quiet.environment === undefined ? "" : ` --environment ${quiet.environment}`
        yield* Console.log(
          `${quiet.operation}, of ${quiet.component}: usually about every ${span(quiet.usualGapMs)}, none since ${utcMinute(quiet.lastRanAt)}.\n  A job? Monitor it: ./cluenori monitor add ${project} ${quiet.component} --operation '${quiet.operation.replaceAll("'", "'\\''")}' --nothing-for ${Math.max(1, Math.ceil((2 * quiet.usualGapMs) / 60_000))}m${where}`,
        )
      }
    }
  }),
).pipe(
  Command.withDescription(
    "A project's open incidents, and those resolved in 7 days: a monitor down, an operation failing, a job stopped.",
  ),
)

// How each change in an incident's life reads.
const changeWords = {
  opened: "Opened",
  reopened: "Reopened",
  worsened: "Got worse",
  acknowledged: "Acknowledged",
  resolved: "Resolved",
} as const

/** `cluenori incident <project> <incident>`. */
export const incident = Command.make(
  "incident",
  {
    project: projectArgument,
    incident: Argument.String("incident").pipe(
      Argument.withDescription("The incident's ID, from ./cluenori incidents."),
    ),
    local,
  },
  (input) =>
    Effect.gen(function* () {
      const project = yield* parsed(ProjectKey, input.project, "a project key")
      const id = yield* parsed(IncidentId, input.incident, "an incident's ID")
      const target = yield* apiTarget(input.local)
      const client = yield* apiClient(target)
      const detail = yield* client.incidents.incident({ params: { project, incident: id } }).pipe(
        Effect.catchTags({
          ...reachFailures(target),
          ProjectNotFound: noProject(target, project),
          IncidentNotFound: () => refuse(`${project} has no incident ${id}. See them: ./cluenori incidents ${project}`),
        }),
      )
      const { incident: found } = detail
      const where = found.environment === undefined ? found.component : `${found.component} (${found.environment})`
      const about =
        found.evidence._tag === "down" || found.evidence._tag === "monitor"
          ? `monitor ${found.evidence.monitor}: ./cluenori monitor show ${project} ${found.evidence.monitor}`
          : `operation ${found.evidence.operation}: ./cluenori operation ${project} '${found.evidence.operation.replaceAll("'", "'\\''")}' --component ${found.component}${found.environment === undefined ? "" : ` --environment ${found.environment}`}`
      yield* Console.log(`${found.title}\n${found.resolvedAt === undefined ? "Open" : "Resolved"}, in ${where}.`)
      yield* Console.log(`About ${about}`)
      yield* Console.log(
        detail.releases.length === 0
          ? "No release of it ran in the hour before it opened."
          : `Running when it opened: ${detail.releases.map((ran) => (ran.environment === undefined ? ran.release : `${ran.release} in ${ran.environment}`)).join(", ")}.`,
      )
      yield* Console.log(
        `\n${columns([
          ["When", "What", "Said"],
          ...detail.updates.map((update) => [utcMinute(update.at), changeWords[update.change], update.title ?? ""]),
        ]).join("\n")}`,
      )
    }),
).pipe(Command.withDescription("One incident: what it is about, the release that ran, and its whole life."))

/** `cluenori acknowledge <project> <incident>`. */
export const acknowledge = Command.make(
  "acknowledge",
  {
    project: projectArgument,
    incident: Argument.String("incident").pipe(
      Argument.withDescription("The incident's ID, from ./cluenori incidents."),
    ),
    local,
  },
  (input) =>
    Effect.gen(function* () {
      const project = yield* parsed(ProjectKey, input.project, "a project key")
      const id = yield* parsed(IncidentId, input.incident, "an incident's ID")
      const target = yield* apiTarget(input.local)
      const client = yield* apiClient(target)
      const acknowledged = yield* client.incidents.acknowledge({ params: { project, incident: id } }).pipe(
        Effect.catchTags({
          ...reachFailures(target),
          ProjectNotFound: noProject(target, project),
          IncidentNotFound: () => refuse(`${project} has no incident ${id}. See them: ./cluenori incidents ${project}`),
        }),
      )
      yield* Console.log(`Acknowledged: ${acknowledged.title}. It tells no one more.`)
    }),
).pipe(Command.withDescription("Say you are on an incident, which stops its notifications."))

/** `cluenori monitors <project>`. */
export const monitors = Command.make("monitors", { project: projectArgument, local }, (input) =>
  Effect.gen(function* () {
    const project = yield* parsed(ProjectKey, input.project, "a project key")
    const target = yield* apiTarget(input.local)
    const client = yield* apiClient(target)
    const list = yield* client.incidents
      .monitors({ params: { project } })
      .pipe(Effect.catchTags({ ...reachFailures(target), ProjectNotFound: noProject(target, project) }))
    if (list.monitors.length === 0) {
      return yield* Console.log(
        `${project} has no monitors. Add one, such as a component's health endpoint: ./cluenori monitor add ${project} <component> --url <url>`,
      )
    }
    yield* Console.log(
      columns([
        ["Component", "Watches", "Level", "Now", "ID"],
        ...list.monitors.map(({ monitor, lastCheck, measured, firing }) => [
          monitorWhere(monitor),
          conditionWords(monitor.condition),
          levelWords[monitor.level],
          firing ? "firing" : nowWords(lastCheck, measured),
          monitor.id,
        ]),
      ]).join("\n"),
    )
  }),
).pipe(Command.withDescription("A project's monitors: what each watches, how its alerts come, and how it is now."))

// How a monitor that isn't firing is now: a URL's last check, or when one of counts last looked.
const nowWords = (
  lastCheck: { readonly problem?: string } | undefined,
  measured: { readonly at: unknown } | undefined,
) => {
  if (lastCheck !== undefined) {
    return lastCheck.problem ?? "passed"
  }
  return measured === undefined ? "not looked at yet" : "fine"
}

/** `cluenori monitor show <project> <monitor>`. */
export const monitorShow = Command.make(
  "show",
  {
    project: projectArgument,
    monitor: Argument.String("monitor").pipe(Argument.withDescription("The monitor's ID, from ./cluenori monitors.")),
    local,
  },
  (input) =>
    Effect.gen(function* () {
      const project = yield* parsed(ProjectKey, input.project, "a project key")
      const id = yield* parsed(MonitorId, input.monitor, "a monitor's ID")
      const target = yield* apiTarget(input.local)
      const client = yield* apiClient(target)
      const detail = yield* client.incidents.monitor({ params: { project, monitor: id } }).pipe(
        Effect.catchTags({
          ...reachFailures(target),
          ProjectNotFound: noProject(target, project),
          MonitorNotFound: () => refuse(`${project} has no monitor ${id}. See them: ./cluenori monitors ${project}`),
        }),
      )
      const { monitor: shown, lastCheck, since, days, measured, firing } = detail.state
      yield* Console.log(
        `${conditionWords(shown.condition)}, of ${monitorWhere(shown)}; alerts ${levelWords[shown.level]}; looked at every minute since ${utcMinute(shown.addedAt)}.`,
      )
      if (shown.condition._tag === "noAnswer") {
        yield* Console.log(
          lastCheck === undefined
            ? "Not checked yet."
            : `${lastCheck.problem === undefined ? "Up" : `Down: ${lastCheck.problem}`}${since === undefined ? "" : ` since ${utcMinute(since)}`}; last checked ${utcMinute(lastCheck.at)}${lastCheck.ms === undefined ? "" : `, answered in ${milliseconds(lastCheck.ms)}`}.`,
        )
      } else {
        yield* Console.log(
          measured === undefined
            ? "Not looked at yet."
            : `${firing ? "Firing" : "Fine"}: ${measuredWords(shown.condition, measured.value)}, at ${utcMinute(measured.at)}.`,
        )
      }
      const checks = days.reduce((sum, day) => sum + day.checks, 0)
      const failed = days.reduce((sum, day) => sum + day.failed, 0)
      if (checks > 0) {
        yield* Console.log(
          `\nUp ${uptime(checks - failed, checks)} of ${count(checks)} checks over its last ${count(days.length)} days with checks:`,
        )
        yield* Console.log(
          columns([
            ["Day (UTC)", "Checks", "Failed", "Average"],
            ...days.map((day) => [
              day.day,
              count(day.checks),
              count(day.failed),
              day.averageMs === undefined ? "" : milliseconds(day.averageMs),
            ]),
          ]).join("\n"),
        )
      }
      if (detail.failures.length > 0) {
        yield* Console.log("\nIts latest failed checks, in the 7 days every check is kept:")
        yield* Console.log(
          columns(detail.failures.map((check) => [utcMinute(check.at), check.problem ?? ""])).join("\n"),
        )
      }
      if (detail.incidents.length > 0) {
        yield* Console.log("\nIts incidents, the latest first:")
        yield* Console.log(
          columns(
            detail.incidents.map((found) => [
              utcMinute(found.openedAt),
              found.resolvedAt === undefined ? "open" : `resolved ${utcMinute(found.resolvedAt)}`,
              found.id,
            ]),
          ).join("\n"),
        )
      }
    }),
).pipe(Command.withDescription("One monitor: how it is now, each day's checks, its failed checks and its incidents."))

// What a monitor of counts measured, in words: `0 runs`, `p99 820ms`, `12% failed`.
const measuredWords = (condition: MonitorCondition, value: number | undefined) => {
  if (value === undefined) {
    return "too few runs to judge"
  }
  switch (condition._tag) {
    case "latencyAbove":
      return `p${condition.percentile} ${milliseconds(value)}`
    case "errorRateAbove":
      return `${value.toFixed(1)}% failed`
    case "noAnswer":
    case "nothingFor":
    case "moreThan":
      return `${count(value)} in its window`
  }
}

const unitMinutes = { m: 1, h: 60, d: 1440 }

// `30m`, `12h`, `2d`: a span in whole minutes.
const minutesOf = (value: string) => {
  const found = /^(\d{1,6})([mhd])$/.exec(value)
  if (found === null) {
    return refuse(`"${value}" isn't a span such as 30m, 12h or 2d.`)
  }
  return Effect.succeed(Number(found[1]) * unitMinutes[found[2] === "d" || found[2] === "h" ? found[2] : "m"])
}

const optionalString = (name: string, description: string) =>
  Flag.String(name).pipe(Flag.optional, Flag.withDescription(description))

// The one subject a monitor is given, from its flags.
const subjectOf = Effect.fn("subjectOf")(function* (input: {
  readonly url: Option.Option<string>
  readonly operation: Option.Option<string>
  readonly event: Option.Option<string>
  readonly error: Option.Option<string>
  readonly message: Option.Option<string>
}) {
  const given = [input.url, input.operation, input.event, input.error, input.message].filter(Option.isSome)
  if (given.length !== 1) {
    return yield* refuse("Give exactly one of --url, --operation, --event, --error or --message.")
  }
  if (Option.isSome(input.url)) {
    return { _tag: "url" as const, url: yield* parsed(MonitorUrl, input.url.value, "a URL to monitor") }
  }
  if (Option.isSome(input.operation)) {
    return {
      _tag: "operation" as const,
      operation: yield* parsed(EnvelopeName, input.operation.value, "an operation's name"),
    }
  }
  if (Option.isSome(input.event)) {
    return { _tag: "event" as const, event: yield* parsed(EnvelopeName, input.event.value, "an event's name") }
  }
  if (Option.isSome(input.error)) {
    return { _tag: "error" as const, error: yield* parsed(ErrorGroupId, input.error.value, "an error's ID") }
  }
  const message = Option.getOrElse(input.message, () => "")
  return {
    _tag: "message" as const,
    message: yield* parsed(Schema.FiniteFromString.pipe(Schema.decodeTo(LogMessageId)), message, "a log message's ID"),
  }
})

// The condition its flags give, for the schema to check.
const conditionOf = Effect.fn("conditionOf")(function* (
  subject: Effect.Success<ReturnType<typeof subjectOf>>,
  input: {
    readonly nothingFor: Option.Option<string>
    readonly moreThan: Option.Option<number>
    readonly p50Above: Option.Option<number>
    readonly p95Above: Option.Option<number>
    readonly p99Above: Option.Option<number>
    readonly errorRateAbove: Option.Option<number>
  },
  within: number,
) {
  if (subject._tag === "url") {
    return { _tag: "noAnswer", subject }
  }
  if (Option.isSome(input.nothingFor)) {
    return { _tag: "nothingFor", subject, minutes: yield* minutesOf(input.nothingFor.value) }
  }
  if (Option.isSome(input.moreThan)) {
    return { _tag: "moreThan", subject, count: input.moreThan.value, minutes: within }
  }
  for (const [percentile, ms] of [
    [50, input.p50Above],
    [95, input.p95Above],
    [99, input.p99Above],
  ] as const) {
    if (Option.isSome(ms)) {
      return { _tag: "latencyAbove", subject, percentile, ms: ms.value, minutes: within }
    }
  }
  return { _tag: "errorRateAbove", subject, percent: Option.getOrElse(input.errorRateAbove, () => 0), minutes: within }
})

/** `cluenori monitor add <project> <component> --<subject> <name> [--<condition> <number>]`. */
export const monitorAdd = Command.make(
  "add",
  {
    project: projectArgument,
    component: Argument.String("component").pipe(Argument.withDescription("The component's key, such as notes-api.")),
    url: optionalString("url", "A URL to fetch every minute; it fires when two checks in a row fail."),
    operation: optionalString("operation", "An operation, such as cleanup.run or 'GET /api/card'."),
    event: optionalString("event", "An app's event, such as user.registered."),
    error: optionalString("error", "An error, by its ID from ./cluenori errors."),
    message: optionalString("message", "A log message, by its ID from ./cluenori log-messages."),
    nothingFor: optionalString(
      "nothing-for",
      "Fires when the operation didn't run, or the event didn't come, for this long: 30m, 12h.",
    ),
    moreThan: Flag.Int("more-than").pipe(
      Flag.optional,
      Flag.withDescription("Fires when the error, log message or event came more than this many times in --within."),
    ),
    p50Above: Flag.Int("p50-above").pipe(
      Flag.optional,
      Flag.withDescription("Fires when the operation's p50 over --within is above this many ms, of at least 5 runs."),
    ),
    p95Above: Flag.Int("p95-above").pipe(
      Flag.optional,
      Flag.withDescription("Fires when the operation's p95 over --within is above this many ms, of at least 20 runs."),
    ),
    p99Above: Flag.Int("p99-above").pipe(
      Flag.optional,
      Flag.withDescription("Fires when the operation's p99 over --within is above this many ms, of at least 100 runs."),
    ),
    errorRateAbove: Flag.Finite("error-rate-above").pipe(
      Flag.optional,
      Flag.withDescription(
        "Fires when more than this percent of the operation's runs over --within failed, of at least 5.",
      ),
    ),
    within: Flag.String("within").pipe(
      Flag.withDefault("15m"),
      Flag.withDescription("The window looked back over: 15m, 1h, 1d at most."),
    ),
    environment: optionalString("environment", "Only this environment, such as production; any when absent."),
    level: Flag.Literals("level", ["alarm", "time-sensitive", "quiet"]).pipe(
      Flag.optional,
      Flag.withDescription(
        "How its alerts reach phones: alarm rings through silent mode; time-sensitive by default, alarm for a URL.",
      ),
    ),
    local,
  },
  (input) =>
    Effect.gen(function* () {
      const project = yield* parsed(ProjectKey, input.project, "a project key")
      const component = yield* parsed(ComponentKey, input.component, "a component key")
      const subject = yield* subjectOf(input)
      const conditions = [
        input.nothingFor,
        input.moreThan,
        input.p50Above,
        input.p95Above,
        input.p99Above,
        input.errorRateAbove,
      ].filter((given) => Option.isSome<unknown>(given))
      if (subject._tag === "url" ? conditions.length > 0 : conditions.length !== 1) {
        return yield* refuse(
          subject._tag === "url"
            ? "A URL's monitor takes no condition: it fires when two checks in a row fail."
            : "Give exactly one of --nothing-for, --more-than, --p50-above, --p95-above, --p99-above or --error-rate-above.",
        )
      }
      const within = yield* minutesOf(input.within)
      const candidate = yield* conditionOf(subject, input, within)
      const environment = Option.isSome(input.environment)
        ? yield* parsed(EnvironmentKey, input.environment.value, "an environment's key")
        : undefined
      const level = Option.match(input.level, {
        onNone: () => (subject._tag === "url" ? "alarm" : "timeSensitive"),
        onSome: (chosen) => (chosen === "time-sensitive" ? "timeSensitive" : chosen),
      })
      const payload = yield* Schema.decodeUnknownEffect(AddMonitor)({
        component,
        ...(environment === undefined ? {} : { environment }),
        condition: candidate,
        level,
      }).pipe(
        Effect.catchTag("SchemaError", (error) => refuse(`That monitor isn't one Cluenori takes: ${error.message}`)),
      )
      const target = yield* apiTarget(input.local)
      const client = yield* apiClient(target)
      const monitor = yield* client.incidents.addMonitor({ params: { project }, payload }).pipe(
        Effect.catchTags({
          ...reachFailures(target),
          ProjectNotFound: noProject(target, project),
          ComponentNotFound: () => refuse(`${project} has no component ${component}.`),
          MonitorExists: (exists) =>
            refuse(`${component} already has this monitor: ./cluenori monitor show ${project} ${exists.monitor}`),
          MonitorLimitReached: (reached) =>
            refuse(`${project} has ${reached.limit} monitors, as many as it may. Remove one first.`),
        }),
      )
      yield* Console.log(
        `Added a monitor to ${monitorWhere(monitor)}: ${conditionWords(monitor.condition)}; alerts ${levelWords[monitor.level]}. It is looked at every minute from the next check on. Its ID: ${monitor.id}`,
      )
    }),
).pipe(
  Command.withDescription(
    "Watch something every minute and open an incident when it holds: a URL that doesn't answer, an operation or event with nothing for a while, an error, log message or event more than N times, an operation's p50, p95 or p99 or its error rate above a number.",
  ),
)

/** `cluenori monitor remove <project> <monitor>`. */
export const monitorRemove = Command.make(
  "remove",
  {
    project: projectArgument,
    monitor: Argument.String("monitor").pipe(Argument.withDescription("The monitor's ID, from ./cluenori monitors.")),
    local,
  },
  (input) =>
    Effect.gen(function* () {
      const project = yield* parsed(ProjectKey, input.project, "a project key")
      const id = yield* parsed(MonitorId, input.monitor, "a monitor's ID")
      const target = yield* apiTarget(input.local)
      const client = yield* apiClient(target)
      yield* client.incidents.removeMonitor({ params: { project, monitor: id } }).pipe(
        Effect.catchTags({
          ...reachFailures(target),
          ProjectNotFound: noProject(target, project),
          MonitorNotFound: () => refuse(`${project} has no monitor ${id}. See them: ./cluenori monitors ${project}`),
        }),
      )
      yield* Console.log("Removed the monitor, and resolved its open incident, if it had one.")
    }),
).pipe(Command.withDescription("Remove a monitor, and resolve its open incident."))

/** `cluenori monitor ...`. */
export const monitor = Command.make("monitor").pipe(
  Command.withDescription("See, add and remove monitors."),
  Command.withSubcommands([monitorShow, monitorAdd, monitorRemove]),
)
