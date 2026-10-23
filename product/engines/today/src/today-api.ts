import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"

import { TodayList } from "./today-item.ts"

/** Today, across the workspace's projects: the public API's part for this engine. */
export class TodayGroup extends HttpApiGroup.make("today").add(
  HttpApiEndpoint.get("today", "/today", { success: TodayList }).annotate(
    OpenApi.Description,
    "What needs attention now across every project, the most urgent first: open incidents not acknowledged, errors happening now (seen in the last 15 minutes), acknowledged incidents, new errors (first seen in the last day), operations whose p95 over the last day is at least 1.5 times and 100 ms more than over the 7 days before, promotions that need a member (approved in App Store review and waiting to be released, waiting for someone to approve their environment on GitHub, or ended without their release getting there, as failed, rejected in App Store review, or lost, until a release reaches that environment), and projects with components that sent nothing in the last day; all in the environments each project calls production. Each item has its evidence and its project; `projects` names every project asked; `pulses` says how each project that answered is going, in its production environments: its load by the hour over the current hour and the 23 before it (an hour not listed had nothing reported), and its apps' people on the latest whole UTC day and the same day a week before (absent until its apps sent anything). A project that didn't answer is in `unanswered`, its items and pulse missing.",
  ),
) {}
