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
      "The project's open incidents, newest first, and up to 50 resolved in the last 7 days. Detectors look every minute: a URL monitor down two checks in a row, an operation failing at least 2% and three times its usual over 15 minutes, and each monitor of counts whose condition holds. `checkedAt` says when they last looked. Beside them, never incidents, the operations quiet now: those that usually ran regularly, as guessed from their history, and haven't for twice their usual gap.",
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
      "The project's monitors, oldest first, each a subject, a condition and a level, looked at every minute. A URL's is fetched, and passes with a status below 400 within 10 seconds: with its last check (its status and how long the answer took, absent without an answer, and what was wrong, absent when it passed), since when it has passed or failed as it does now, and its last 90 UTC days with checks. One of counts says what it last measured. Each says whether it has an open incident.",
    ),
  )
  .add(
    HttpApiEndpoint.get("monitor", "/projects/:project/monitors/:monitor", {
      params: { project: ProjectKey, monitor: MonitorId },
      success: MonitorDetail,
      error: [ProjectNotFound.pipe(HttpApiSchema.status(404)), MonitorNotFound.pipe(HttpApiSchema.status(404))],
    }).annotate(
      OpenApi.Description,
      "One monitor, whatever any period: how it is now; for a URL's, its last 90 days, its checks over the last 24 hours, by five minutes, with how many failed and their average and slowest time, and its latest failed checks of the 7 days every check is kept, at most 20, newest first; and its incidents, at most 20, the latest opened first: for a URL's, those of its component and URL.",
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
      "Adds a monitor to one component: a subject, a condition and a level (alarm, timeSensitive or quiet). A URL that doesn't answer two checks in a row (no environment); an operation or app event with nothing for N minutes, first judged N minutes after it is added; an error, log message or event more than N times in a window; an operation's p50, p95 or p99 above X ms (`latencyAbove`, judged of at least 5, 20 or 100 runs), or error rate above X% (of at least 5 runs), over a window. Windows are 1 to 1,440 minutes, nothing-for 1 to 10,080. Looked at from the next check on. A project has at most 30; the same subject, condition and environment twice is refused with the first one's ID. Any member who sees the project may add one.",
    ),
  )
  .add(
    HttpApiEndpoint.delete("removeMonitor", "/projects/:project/monitors/:monitor", {
      params: { project: ProjectKey, monitor: MonitorId },
      success: HttpApiSchema.NoContent,
      error: [ProjectNotFound.pipe(HttpApiSchema.status(404)), MonitorNotFound.pipe(HttpApiSchema.status(404))],
    }).annotate(
      OpenApi.Description,
      "Removes a monitor, and resolves its open incident, if any. Any member who sees the project may remove one.",
    ),
  ) {}
