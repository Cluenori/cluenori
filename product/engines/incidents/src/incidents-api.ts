import { ProjectKey } from "@cluenori/foundation"
import { ComponentNotFound, ProjectNotFound } from "@cluenori/projects"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api"

import { Incident, IncidentId, IncidentList, IncidentNotFound } from "./incident.ts"
import {
  AddMonitor,
  Monitor,
  MonitorExists,
  MonitorId,
  MonitorLimitReached,
  MonitorList,
  MonitorNotFound,
} from "./monitor.ts"

/** A project's incidents and monitors: the public API's part for this engine. */
export class IncidentsGroup extends HttpApiGroup.make("incidents")
  .add(
    HttpApiEndpoint.get("incidents", "/projects/:project/incidents", {
      params: { project: ProjectKey },
      success: IncidentList,
      error: ProjectNotFound.pipe(HttpApiSchema.status(404)),
    }).annotate(
      OpenApi.Description,
      "The project's open incidents, newest first, and up to 50 resolved in the last 7 days. Detectors look every minute: a monitor down two checks in a row, an operation failing at least 2% and three times its usual over 15 minutes, and a scheduled operation that missed twice its usual gap. `checkedAt` says when they last looked.",
    ),
  )
  .add(
    HttpApiEndpoint.post("acknowledge", "/projects/:project/incidents/:incident/acknowledge", {
      params: { project: ProjectKey, incident: IncidentId },
      success: Incident,
      error: [ProjectNotFound.pipe(HttpApiSchema.status(404)), IncidentNotFound.pipe(HttpApiSchema.status(404))],
    }).annotate(
      OpenApi.Description,
      "Marks an incident as being looked at, which stops its notifications, and returns it. Acknowledging it again keeps the first time.",
    ),
  )
  .add(
    HttpApiEndpoint.get("monitors", "/projects/:project/monitors", {
      params: { project: ProjectKey },
      success: MonitorList,
      error: ProjectNotFound.pipe(HttpApiSchema.status(404)),
    }).annotate(
      OpenApi.Description,
      "The project's monitors, oldest first, each with its last check: the URLs fetched every minute, which pass with a status below 400 within 10 seconds.",
    ),
  )
  .add(
    HttpApiEndpoint.post("addMonitor", "/projects/:project/monitors", {
      params: { project: ProjectKey },
      payload: AddMonitor,
      success: Monitor.pipe(HttpApiSchema.status(201)),
      error: [
        ProjectNotFound.pipe(HttpApiSchema.status(404)),
        ComponentNotFound.pipe(HttpApiSchema.status(404)),
        MonitorExists.pipe(HttpApiSchema.status(409)),
        MonitorLimitReached.pipe(HttpApiSchema.status(409)),
      ],
    }).annotate(
      OpenApi.Description,
      "Adds a monitor: a URL of one component, such as its health endpoint, fetched every minute from the next check on. A project has at most 20.",
    ),
  )
  .add(
    HttpApiEndpoint.delete("removeMonitor", "/projects/:project/monitors/:monitor", {
      params: { project: ProjectKey, monitor: MonitorId },
      success: HttpApiSchema.NoContent,
      error: [ProjectNotFound.pipe(HttpApiSchema.status(404)), MonitorNotFound.pipe(HttpApiSchema.status(404))],
    }).annotate(OpenApi.Description, "Removes a monitor, and resolves its open incident, if any."),
  ) {}
