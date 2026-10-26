import { ComponentKey, ProjectKey } from "@cluenori/foundation"
import type { Incident } from "@cluenori/incidents"
import { IncidentId, MonitorId, MonitorUrl } from "@cluenori/incidents"
import { Console, Effect } from "effect"
import { Argument, Command } from "effect/cli"

import { apiClient, reachFailures, refuse } from "./api-client.ts"
import type { ApiTarget } from "./api-settings.ts"
import { apiTarget } from "./api-settings.ts"
import { local, parsed } from "./question.ts"
import { columns, count, milliseconds, uptime, utcMinute } from "./terminal-text.ts"

const projectArgument = Argument.String("project").pipe(Argument.withDescription("The project's key."))

const noProject = (target: ApiTarget, project: ProjectKey) => () => refuse(`${target.url} has no project ${project}.`)

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
        found.evidence._tag === "down"
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
        `${project} has no monitors. Add one for each component, such as its health endpoint: ./cluenori monitor add ${project} <component> <url>`,
      )
    }
    yield* Console.log(
      columns([
        ["Component", "URL", "Last check", "Result", "ID"],
        ...list.monitors.map(({ monitor, lastCheck }) => [
          monitor.component,
          monitor.url,
          lastCheck === undefined ? "not yet" : utcMinute(lastCheck.at),
          lastCheck === undefined ? "" : (lastCheck.problem ?? "passed"),
          monitor.id,
        ]),
      ]).join("\n"),
    )
  }),
).pipe(Command.withDescription("A project's monitors: the URLs fetched every minute, and how each last answered."))

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
      const { monitor: shown, lastCheck, since, days } = detail.state
      const now =
        lastCheck === undefined
          ? "Not checked yet."
          : `${lastCheck.problem === undefined ? "Up" : `Down: ${lastCheck.problem}`}${since === undefined ? "" : ` since ${utcMinute(since)}`}; last checked ${utcMinute(lastCheck.at)}${lastCheck.ms === undefined ? "" : `, answered in ${milliseconds(lastCheck.ms)}`}.`
      yield* Console.log(`${shown.url}, of ${shown.component}, checked every minute since ${utcMinute(shown.addedAt)}.`)
      yield* Console.log(now)
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

/** `cluenori monitor add <project> <component> <url>`. */
export const monitorAdd = Command.make(
  "add",
  {
    project: projectArgument,
    component: Argument.String("component").pipe(Argument.withDescription("The component's key, such as notes-api.")),
    url: Argument.String("url").pipe(
      Argument.withDescription("What to fetch every minute, such as https://api.notes.app/health."),
    ),
    local,
  },
  (input) =>
    Effect.gen(function* () {
      const project = yield* parsed(ProjectKey, input.project, "a project key")
      const component = yield* parsed(ComponentKey, input.component, "a component key")
      const url = yield* parsed(MonitorUrl, input.url, "a URL to monitor")
      const target = yield* apiTarget(input.local)
      const client = yield* apiClient(target)
      const monitor = yield* client.incidents.addMonitor({ params: { project }, payload: { component, url } }).pipe(
        Effect.catchTags({
          ...reachFailures(target),
          ProjectNotFound: noProject(target, project),
          ComponentNotFound: () => refuse(`${project} has no component ${component}.`),
          MonitorExists: () => refuse(`${component} already has a monitor of ${url}.`),
          MonitorLimitReached: (reached) =>
            refuse(`${project} has ${reached.limit} monitors, as many as it may. Remove one first.`),
        }),
      )
      yield* Console.log(
        `Added a monitor of ${monitor.url} to ${component}. It is fetched every minute; two failed checks in a row open an incident.`,
      )
    }),
).pipe(Command.withDescription("Fetch a component's URL every minute, and open an incident when it is down."))

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
).pipe(Command.withDescription("Stop fetching a monitor's URL."))

/** `cluenori monitor ...`. */
export const monitor = Command.make("monitor").pipe(
  Command.withDescription("See, add and remove monitors."),
  Command.withSubcommands([monitorShow, monitorAdd, monitorRemove]),
)
