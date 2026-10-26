import { ProjectKey } from "@cluenori/foundation"
import { ComponentNotFound, ProjectNotFound } from "@cluenori/projects"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api"

import { Incident, IncidentDetail, IncidentId, IncidentList, IncidentNotFound } from "./incident.ts"
import { MonitorDetail } from "./monitor-detail.ts"
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
      "The project's open incidents, newest first, and up to 50 resolved in the last 7 days. Detectors look every minute: a monitor down two checks in a row, and an operation failing at least 2% and three times its usual over 15 minutes. `checkedAt` says when they last looked. Beside them, never incidents, the operations quiet now: those that usually ran regularly, as guessed from their history, and haven't for twice their usual gap.",
    ),
  )
  .add(
    HttpApiEndpoint.get("incident", "/projects/:project/incidents/:incident", {
      params: { project: ProjectKey, incident: IncidentId },
      success: IncidentDetail,
      error: [ProjectNotFound.pipe(HttpApiSchema.status(404)), IncidentNotFound.pipe(HttpApiSchema.status(404))],
    }).annotate(
      OpenApi.Description,
      "One incident, whatever any period: the incident; its life, oldest first (when it opened, reopened, got worse, was acknowledged and resolved, with the title it said when it opened, reopened or got worse), its latest 500 updates; and the releases of its component that ran in the hour before it opened, the latest of each environment: in its environment, or, for a monitor's, in each.",
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
      "The project's monitors, oldest first: the URLs fetched every minute, which pass with a status below 400 within 10 seconds. Each with its last check (its status and how long the answer took, absent without an answer, and what was wrong, absent when it passed), since when it has passed or failed as it does now, and its last 90 UTC days with checks: how many, how many failed, and their average time.",
    ),
  )
  .add(
    HttpApiEndpoint.get("monitor", "/projects/:project/monitors/:monitor", {
      params: { project: ProjectKey, monitor: MonitorId },
      success: MonitorDetail,
      error: [ProjectNotFound.pipe(HttpApiSchema.status(404)), MonitorNotFound.pipe(HttpApiSchema.status(404))],
    }).annotate(
      OpenApi.Description,
      "One monitor, whatever any period: how it is now and its last 90 days; its checks over the last 24 hours, by five minutes, with how many failed and their average and slowest time; its latest failed checks of the 7 days every check is kept, at most 20, newest first; and the incidents of its component and URL, at most 20, the latest opened first.",
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
