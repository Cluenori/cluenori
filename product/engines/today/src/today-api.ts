import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"

import { TodayList } from "./today-item.ts"

/** Today, across the workspace's projects: the public API's part for this engine. */
export class TodayGroup extends HttpApiGroup.make("today").add(
  HttpApiEndpoint.get("today", "/today", { success: TodayList }).annotate(
    OpenApi.Description,
    "What needs attention now across every project, the most urgent first: open incidents not acknowledged, errors happening now (seen in the last 15 minutes), acknowledged incidents, new errors (first seen in the last day), operations whose p95 over the last day is at least 1.5 times and 100 ms more than over the 7 days before, and projects with components that sent nothing in the last day. Each item has its evidence and its project; `projects` names every project asked; a project that didn't answer is in `unanswered`, its items missing.",
  ),
) {}
