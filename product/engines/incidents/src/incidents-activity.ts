import { ComponentKey, EnvironmentKey } from "@cluenori/foundation"
import { Schema } from "effect"

import { Detector, IncidentId } from "./incident.ts"
import { AlertLevel, MonitorCondition, MonitorId, MonitorUrl } from "./monitor.ts"

// Where an incident is, and whether its project calls that production: absent on entries from
// before October 2026, which count as production.
const placeFields = {
  environment: Schema.optionalKey(EnvironmentKey),
  production: Schema.optionalKey(Schema.Boolean),
}

// What every change to an incident tells: enough to notify without reading the incident.
const incidentFields = {
  incident: IncidentId,
  detector: Detector,
  component: ComponentKey,
  subject: Schema.String,
  title: Schema.String,
  ...placeFields,
}

// How its alert reaches phones, as the monitor behind it says: present on a monitor's incident
// since November 2026; absent, the detector's own (`alarm` for down and failing).
const level = Schema.optionalKey(AlertLevel)

/** A detector fired, and opened an incident. */
export const IncidentOpened = Schema.TaggedStruct("incident.opened", { ...incidentFields, level })

/** A problem came back within 30 minutes of its incident resolving, and reopened it. */
export const IncidentReopened = Schema.TaggedStruct("incident.reopened", { ...incidentFields, level })

// Whether someone is on it, as an incident that is already open can be: present when they are.
const acknowledged = Schema.optionalKey(Schema.Literal(true))

/** An open incident got worse: a failure rate twice what was last told. */
export const IncidentWorsened = Schema.TaggedStruct("incident.worsened", { ...incidentFields, acknowledged, level })

/** An incident's problem was gone for 10 minutes, or its monitor was removed. */
export const IncidentResolved = Schema.TaggedStruct("incident.resolved", { ...incidentFields, acknowledged })

/**
 * Someone is on it: the incident tells no one more. Its title is absent on entries from before
 * October 2026, its detector on those from before November 2026.
 */
export const IncidentAcknowledged = Schema.TaggedStruct("incident.acknowledged", {
  incident: IncidentId,
  title: Schema.optionalKey(Schema.String),
  /** What opened it; absent on entries from before November 2026. */
  detector: Schema.optionalKey(Detector),
  ...placeFields,
})

/**
 * A monitor was added to a component: with its environment, condition and level since November
 * 2026; with only its URL before.
 */
export const MonitorAdded = Schema.TaggedStruct("monitor.added", {
  monitor: MonitorId,
  component: ComponentKey,
  url: Schema.optionalKey(MonitorUrl),
  environment: Schema.optionalKey(EnvironmentKey),
  condition: Schema.optionalKey(MonitorCondition),
  level: Schema.optionalKey(AlertLevel),
})

/** A monitor was removed. */
export const MonitorRemoved = Schema.TaggedStruct("monitor.removed", { monitor: MonitorId })
