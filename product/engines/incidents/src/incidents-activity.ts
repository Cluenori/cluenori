import { ComponentKey } from "@cluenori/foundation"
import { Schema } from "effect"

import { Detector, IncidentId } from "./incident.ts"
import { MonitorId, MonitorUrl } from "./monitor.ts"

// What every change to an incident tells: enough to notify without reading the incident.
const incidentFields = {
  incident: IncidentId,
  detector: Detector,
  component: ComponentKey,
  subject: Schema.String,
  title: Schema.String,
}

/** A detector fired, and opened an incident. */
export const IncidentOpened = Schema.TaggedStruct("incident.opened", incidentFields)

/** A problem came back within 30 minutes of its incident resolving, and reopened it. */
export const IncidentReopened = Schema.TaggedStruct("incident.reopened", incidentFields)

/** An open incident got worse: a failure rate twice what was last told. */
export const IncidentWorsened = Schema.TaggedStruct("incident.worsened", incidentFields)

/** An incident's problem was gone for 10 minutes, or its monitor was removed. */
export const IncidentResolved = Schema.TaggedStruct("incident.resolved", incidentFields)

/** Someone is on it: the incident tells no one more. */
export const IncidentAcknowledged = Schema.TaggedStruct("incident.acknowledged", { incident: IncidentId })

/** A monitor was added to a component. */
export const MonitorAdded = Schema.TaggedStruct("monitor.added", {
  monitor: MonitorId,
  component: ComponentKey,
  url: MonitorUrl,
})

/** A monitor was removed. */
export const MonitorRemoved = Schema.TaggedStruct("monitor.removed", { monitor: MonitorId })
