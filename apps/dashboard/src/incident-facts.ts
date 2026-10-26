// What the incidents and Uptime pages say about incidents and monitors, worked out once from the
// API's answers. Only those pages say these, so they load with them, not with the first load
// (`src/project-facts.ts` has the rules every page says). Every rule is pure: "now" is passed in.

import type { CalendarDay, ProjectKey } from "@cluenori/foundation"
import { calendarDayOf } from "@cluenori/foundation"
import type {
  IncidentDetail,
  MonitorCondition,
  IncidentUpdate,
  Monitor,
  MonitorDay,
  MonitorDetail,
  MonitorState,
} from "@cluenori/incidents"
import { DateTime } from "effect"

import { count, duration, lasting, share, uptime } from "@/lib/format"
import { detectorWords, evidenceWords } from "@/project-facts"

const dayMillis = 86_400_000

// "30 minutes", "12 hours", "1 day", "90 minutes": a monitor's window, as its owner set it.
const minutesWords = (minutes: number) =>
  minutes < 60 || minutes % 60 === 0 ? lasting(minutes * 60_000) : `${count(minutes)} minutes`

/**
 * What a monitor watches, in words: its URL or operation, "event user.registered", "error
 * 3f9c0e2a7b1d4c58", "log message 12".
 */
export const subjectWords = (subject: MonitorCondition["subject"]) => {
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

/**
 * When a monitor fires, in a line: "Doesn't answer two checks in a row", "Nothing for 30 minutes",
 * "More than 10 in 1 hour", "p95 above 500 ms over 15 minutes", "More than 5% failed over 15 minutes".
 */
export const conditionWords = (condition: MonitorCondition) => {
  switch (condition._tag) {
    case "noAnswer":
      return "Doesn't answer two checks in a row"
    case "nothingFor":
      return `Nothing for ${minutesWords(condition.minutes)}`
    case "moreThan":
      return `More than ${count(condition.count)} in ${minutesWords(condition.minutes)}`
    case "p95Above":
      return `p95 above ${duration(condition.ms)} over ${minutesWords(condition.minutes)}`
    case "errorRateAbove":
      return `More than ${share(condition.percent, 100)} failed over ${minutesWords(condition.minutes)}`
  }
}

/** What a monitor of counts measured: "0 in 30 minutes", "p95 820 ms", "12% failed", or too few runs. */
export const measuredWords = (condition: MonitorCondition, value: number | undefined) => {
  if (value === undefined) {
    return "Too few runs to judge"
  }
  switch (condition._tag) {
    case "p95Above":
      return `p95 ${duration(value)}`
    case "errorRateAbove":
      return `${share(value, 100)} failed`
    case "noAnswer":
      return count(value)
    case "nothingFor":
    case "moreThan":
      return `${count(value)} in ${minutesWords(condition.minutes)}`
  }
}

/**
 * A monitor's URL as a brief names it: without its user, password, query or fragment, where tokens
 * go, so a brief handed to an agent carries none; `?…` says a query was left out. The URL fetched is
 * unchanged. Other secrets in a URL's path are not recognized, and stay.
 */
export const briefUrlOf = (url: string) => {
  const parsed = URL.parse(url)
  if (parsed === null) {
    return url
  }
  return `${parsed.protocol}//${parsed.host}${parsed.pathname}${parsed.search === "" && parsed.hash === "" ? "" : "?…"}`
}

// An incident's title as a brief says it: its monitor's URL as `briefUrlOf` names it.
const briefTitleOf = (incident: IncidentDetail["incident"]) =>
  incident.evidence._tag === "down"
    ? incident.title.replaceAll(incident.evidence.url, briefUrlOf(incident.evidence.url))
    : incident.title

// ---- Incidents -------------------------------------------------------------------------------------

/** Each change in an incident's life, in a word or two. */
export const updateWords: Readonly<Record<IncidentUpdate["change"], string>> = {
  opened: "Opened",
  reopened: "Came back",
  worsened: "Got worse",
  acknowledged: "Acknowledged",
  resolved: "Resolved",
}

/**
 * Where an incident stands, in a line: "Open for 12 minutes, no one is on it yet", "Open for 2 hours,
 * acknowledged", "Resolved after 14 minutes".
 */
export const standingOf = (incident: IncidentDetail["incident"], now: number) => {
  const opened = DateTime.toEpochMillis(incident.openedAt)
  if (incident.resolvedAt !== undefined) {
    return `Resolved after ${lasting(DateTime.toEpochMillis(incident.resolvedAt) - opened)}`
  }
  return `Open for ${lasting(now - opened)}, ${incident.acknowledgedAt === undefined ? "no one is on it yet" : "acknowledged"}`
}

/**
 * The incidents list's answer, in a sentence: "2 open, 1 no one is on", "No open incidents; 3
 * resolved in the last 7 days", "No incidents in the last 7 days".
 */
export const incidentsAnswerOf = (open: number, unacknowledged: number, resolved: number) => {
  if (open > 0) {
    return `${count(open)} open${unacknowledged === 0 ? ", someone is on each" : `, ${count(unacknowledged)} no one is on yet`}`
  }
  return resolved === 0
    ? "No incidents in the last 7 days"
    : `No open incidents; ${count(resolved)} resolved in the last 7 days`
}

/**
 * What an agent needs to look into one incident: what it is, where, its life, the release that ran,
 * and how to read the rest.
 */
export const incidentBriefOf = (project: ProjectKey, detail: IncidentDetail) => {
  const { incident } = detail
  const where = `${incident.component}${incident.environment === undefined ? "" : ` (${incident.environment})`}`
  const about =
    incident.evidence._tag === "down" || incident.evidence._tag === "monitor"
      ? `Its monitor: ./cluenori monitor show ${project} ${incident.evidence.monitor}, or GET /api/projects/${project}/monitors/${incident.evidence.monitor}.`
      : `Its operation over time: ./cluenori operation ${project} '${incident.evidence.operation.replaceAll("'", "'\\''")}' --component ${incident.component}${incident.environment === undefined ? "" : ` --environment ${incident.environment}`}.`
  return [
    `Look into this ${detectorWords[incident.evidence._tag].toLowerCase()} incident in Cluenori project ${project}: ${briefTitleOf(incident)}`,
    `Incident ${incident.id}, in ${where}, opened ${DateTime.formatIso(incident.openedAt)}${incident.resolvedAt === undefined ? ", still open" : `, resolved ${DateTime.formatIso(incident.resolvedAt)}`}.`,
    `What its detector saw: ${evidenceWords(incident.evidence, DateTime.toEpochMillis(incident.openedAt))}.`,
    detail.releases.length === 0
      ? "No release of it reported running in the hour before it opened."
      : `Running when it opened: ${detail.releases.map((ran) => `${incident.component} ${ran.release}${ran.environment === undefined ? "" : ` in ${ran.environment}`}`).join(", ")}.`,
    `Its life: ${detail.updates.map((update) => `${updateWords[update.change].toLowerCase()} ${DateTime.formatIso(update.at)}`).join("; ")}.`,
    `Read it with ./cluenori incident ${project} ${incident.id}, or GET /api/projects/${project}/incidents/${incident.id}. ${about}`,
  ].join("\n")
}

// ---- Uptime ----------------------------------------------------------------------------------------

/** A monitor's URL, when it fetches one. */
export const urlOf = (monitor: Monitor) =>
  monitor.condition._tag === "noAnswer" ? monitor.condition.subject.url : undefined

/**
 * A monitor in a line, its subject and condition: "https://notes.app/health", "cleanup.run: nothing
 * for 30 minutes".
 */
export const monitorNameOf = (monitor: Monitor) => {
  const url = urlOf(monitor)
  return url ?? `${subjectWords(monitor.condition.subject)}: ${conditionWords(monitor.condition).toLowerCase()}`
}

/**
 * Whether a monitor is fine now, fires now, or wasn't looked at yet: a URL's by its last check, which
 * is "up" or "down"; one of counts by whether it has an open incident.
 */
export type MonitorStatus = "up" | "down" | "unchecked"

/** How a monitor is now. */
export const statusOf = (state: MonitorState): MonitorStatus => {
  if (urlOf(state.monitor) === undefined) {
    if (state.firing) {
      return "down"
    }
    return state.measured === undefined ? "unchecked" : "up"
  }
  if (state.lastCheck === undefined) {
    return "unchecked"
  }
  return state.lastCheck.problem === undefined ? "up" : "down"
}

/**
 * How a monitor is now, and for how long, said up to its last check: "Up for 3 days", "Down for 4
 * minutes: HTTP 503", "Up" when when it turned isn't known, "Not checked yet".
 */
export const standingWordsOf = (state: MonitorState) => {
  const { lastCheck, since, measured } = state
  if (urlOf(state.monitor) === undefined) {
    if (measured === undefined) {
      return "Not looked at yet"
    }
    return `${state.firing ? "Firing" : "Fine"}: ${measuredWords(state.monitor.condition, measured.value)}`
  }
  if (lastCheck === undefined) {
    return "Not checked yet"
  }
  const lasted =
    since === undefined ? "" : ` for ${lasting(DateTime.toEpochMillis(lastCheck.at) - DateTime.toEpochMillis(since))}`
  return lastCheck.problem === undefined ? `Up${lasted}` : `Down${lasted}: ${lastCheck.problem}`
}

/**
 * Uptime's answer, whether everything is up, in a sentence and a tone: "All 3 monitors are up",
 * "1 of 3 monitors is down", "No monitor has been checked yet", "No monitors".
 */
export const uptimeAnswerOf = (monitors: ReadonlyArray<MonitorState>) => {
  // URLs are up or down; with monitors of counts too, each is fine or firing.
  const urls = monitors.every((state) => urlOf(state.monitor) !== undefined)
  const [upWord, downWord] = urls ? ["up", "down"] : ["fine", "firing"]
  const down = monitors.filter((state) => statusOf(state) === "down").length
  const checked = monitors.filter((state) => statusOf(state) !== "unchecked").length
  if (monitors.length === 0) {
    return { tone: "quiet" as const, words: "No monitors" }
  }
  if (down > 0) {
    return {
      tone: "failure" as const,
      words:
        monitors.length === 1
          ? `The monitor is ${downWord}`
          : `${count(down)} of ${count(monitors.length)} monitors ${down === 1 ? "is" : "are"} ${downWord}`,
    }
  }
  if (checked === 0) {
    return {
      tone: "quiet" as const,
      words: urls ? "No monitor has been checked yet" : "No monitor has been looked at yet",
    }
  }
  const unchecked = monitors.length - checked
  if (unchecked > 0) {
    return {
      tone: "steady" as const,
      words: `${count(checked)} ${checked === 1 ? "monitor is" : "monitors are"} ${upWord}; ${count(unchecked)} not ${urls ? "checked" : "looked at"} yet`,
    }
  }
  return {
    tone: "steady" as const,
    words: monitors.length === 1 ? `The monitor is ${upWord}` : `All ${count(checked)} monitors are ${upWord}`,
  }
}

/** The share of checks that passed over some days, as text; undefined when there were none. */
export const uptimeOf = (days: ReadonlyArray<MonitorDay>) => {
  const checks = days.reduce((sum, day) => sum + day.checks, 0)
  const failed = days.reduce((sum, day) => sum + day.failed, 0)
  return checks === 0 ? undefined : uptime(checks - failed, checks)
}

/**
 * One day of a monitor's strip: its checks, and how it went: every check passed (`up`), some failed
 * (`some`), all failed (`down`), none while it was watched (`unchecked`, unknown, never up), or
 * before it was added (`before`).
 */
export type StripDay = {
  readonly day: CalendarDay
  readonly checks: number
  readonly failed: number
  readonly tone: "up" | "some" | "down" | "unchecked" | "before"
}

const dayOfMillis = (millis: number) => calendarDayOf(DateTime.makeUnsafe(millis))

// How a day with checks went: every check passed, some failed, or all did.
const toneOf = (day: MonitorDay): StripDay["tone"] => {
  if (day.failed === 0) {
    return "up"
  }
  return day.failed === day.checks ? "down" : "some"
}

/** A monitor's last `length` UTC days up to the one `now` falls in, oldest first. */
export const stripOf = (state: MonitorState, now: number, length: number): ReadonlyArray<StripDay> => {
  const byDay = new Map(state.days.map((day) => [day.day, day] as const))
  const added = dayOfMillis(DateTime.toEpochMillis(state.monitor.addedAt))
  const today = Math.floor(now / dayMillis)
  return Array.from({ length }, (_, index) => {
    const day = dayOfMillis((today - length + 1 + index) * dayMillis)
    const counted = byDay.get(day)
    if (counted === undefined || counted.checks === 0) {
      return { day, checks: 0, failed: 0, tone: day < added ? "before" : "unchecked" }
    }
    return { day, checks: counted.checks, failed: counted.failed, tone: toneOf(counted) }
  })
}

/** The days of a monitor within the last `days` UTC days up to `now`'s. */
export const lastDaysOf = (state: MonitorState, now: number, days: number) => {
  const first = dayOfMillis((Math.floor(now / dayMillis) - days + 1) * dayMillis)
  return state.days.filter((day) => day.day >= first)
}

/** What an agent needs to look into one monitor: what it checks, how it is, and how to read the rest. */
export const monitorBriefOf = (project: ProjectKey, detail: MonitorDetail, now: number) => {
  const { monitor } = detail.state
  const url = urlOf(monitor)
  const where = `${monitor.component}${monitor.environment === undefined ? "" : ` (${monitor.environment})`}`
  const read = `Read it with ./cluenori monitor show ${project} ${monitor.id}, or GET /api/projects/${project}/monitors/${monitor.id}; its incidents with ./cluenori incident ${project} <ID>.`
  if (url === undefined) {
    return [
      `Look into this monitor in Cluenori project ${project}: ${monitorNameOf(monitor)}, of ${where}, looked at every minute since ${DateTime.formatIso(monitor.addedAt)}; its alerts come ${monitor.level}.`,
      `Now: ${standingWordsOf(detail.state)}${detail.state.measured === undefined ? "" : `, at ${DateTime.formatIso(detail.state.measured.at)}`}.`,
      ...(detail.incidents.length === 0
        ? ["It never fired."]
        : [
            `Its incidents, the latest first: ${detail.incidents
              .slice(0, 5)
              .map(
                (incident) =>
                  `${incident.id} opened ${DateTime.formatIso(incident.openedAt)}${incident.resolvedAt === undefined ? ", open" : ""}`,
              )
              .join("; ")}.`,
          ]),
      read,
    ].join("\n")
  }
  const failures = detail.failures.slice(0, 5)
  return [
    `Look into this monitor in Cluenori project ${project}: ${briefUrlOf(url)}, of ${monitor.component}, fetched every minute since ${DateTime.formatIso(monitor.addedAt)}; a check passes with a status below 400 within 10 seconds.`,
    `Now: ${standingWordsOf(detail.state)}${detail.state.lastCheck === undefined ? "" : `, last checked ${DateTime.formatIso(detail.state.lastCheck.at)}`}.`,
    `Up ${uptimeOf(lastDaysOf(detail.state, now, 7)) ?? "unknown"} over the last 7 days, ${uptimeOf(detail.state.days) ?? "unknown"} over its last ${count(detail.state.days.length)} days with checks.`,
    ...(failures.length === 0
      ? []
      : [
          `Its latest failed checks: ${failures.map((check) => `${DateTime.formatIso(check.at)} ${check.problem ?? ""}${check.ms === undefined ? "" : ` in ${duration(check.ms)}`}`).join("; ")}.`,
        ]),
    read,
  ].join("\n")
}
