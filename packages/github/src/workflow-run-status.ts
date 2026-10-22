import { Schema } from "effect"

/**
 * Where a workflow run stands, as GitHub documents a run's statuses: `requested` (created, not yet
 * queued), `queued`, `pending` (held by a concurrency limit), `waiting` (for a deployment protection
 * rule), `in_progress`, and `completed`, with a conclusion; and the statuses GitHub's checks also
 * document for Actions, `expected`, `failure` and `startup_failure`. A run is over when it is
 * `completed`, `failure` or `startup_failure`.
 */
export const WorkflowRunStatus = Schema.Literals([
  "requested",
  "queued",
  "pending",
  "waiting",
  "expected",
  "in_progress",
  "completed",
  "failure",
  "startup_failure",
]).annotate({ identifier: "WorkflowRunStatus" })
export type WorkflowRunStatus = typeof WorkflowRunStatus.Type
