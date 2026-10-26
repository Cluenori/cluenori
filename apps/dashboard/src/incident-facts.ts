// What the incidents and Uptime pages say about incidents and monitors, worked out once from the
// API's answers. Only those pages say these, so they load with them, not with the first load
// (`src/project-facts.ts` has the rules every page says). Every rule is pure: "now" is passed in.

import type { CalendarDay, ProjectKey } from "@cluenori/foundation"
import { calendarDayOf } from "@cluenori/foundation"
import type { IncidentDetail, IncidentUpdate, MonitorDay, MonitorDetail, MonitorState } from "@cluenori/incidents"
import { DateTime } from "effect"

import { count, duration, lasting, uptime } from "@/lib/format"
import { detectorWords, evidenceWords } from "@/project-facts"

const dayMillis = 86_400_000

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
    incident.evidence._tag === "down"
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

/** Whether a monitor passes now, fails now, or wasn't checked yet. */
export type MonitorStatus = "up" | "down" | "unchecked"

/** How a monitor is now, from its last check. */
export const statusOf = (state: MonitorState): MonitorStatus => {
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
  const { lastCheck, since } = state
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
          ? "The monitor is down"
          : `${count(down)} of ${count(monitors.length)} monitors ${down === 1 ? "is" : "are"} down`,
    }
  }
  if (checked === 0) {
    return { tone: "quiet" as const, words: "No monitor has been checked yet" }
  }
  const unchecked = monitors.length - checked
  if (unchecked > 0) {
    return {
      tone: "steady" as const,
      words: `${count(checked)} ${checked === 1 ? "monitor is" : "monitors are"} up; ${count(unchecked)} not checked yet`,
    }
  }
  return {
    tone: "steady" as const,
    words: monitors.length === 1 ? "The monitor is up" : `All ${count(checked)} monitors are up`,
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
  const failures = detail.failures.slice(0, 5)
  return [
    `Look into this monitor in Cluenori project ${project}: ${briefUrlOf(monitor.url)}, of ${monitor.component}, fetched every minute since ${DateTime.formatIso(monitor.addedAt)}; a check passes with a status below 400 within 10 seconds.`,
    `Now: ${standingWordsOf(detail.state)}${detail.state.lastCheck === undefined ? "" : `, last checked ${DateTime.formatIso(detail.state.lastCheck.at)}`}.`,
    `Up ${uptimeOf(lastDaysOf(detail.state, now, 7)) ?? "unknown"} over the last 7 days, ${uptimeOf(detail.state.days) ?? "unknown"} over its last ${count(detail.state.days.length)} days with checks.`,
    ...(failures.length === 0
      ? []
      : [
          `Its latest failed checks: ${failures.map((check) => `${DateTime.formatIso(check.at)} ${check.problem ?? ""}${check.ms === undefined ? "" : ` in ${duration(check.ms)}`}`).join("; ")}.`,
        ]),
    `Read it with ./cluenori monitor show ${project} ${monitor.id}, or GET /api/projects/${project}/monitors/${monitor.id}; its incidents with ./cluenori incident ${project} <ID>.`,
  ].join("\n")
}
