import { Schema } from "effect"

import { WorkflowFile } from "./workflow-file.ts"

/**
 * GitHub refused: the token is wrong or expired (401), lacks access (403), or the repository isn't
 * visible to it (404, for the repository); a GitHub App isn't installed where asked (404); or, with
 * status 0 and nothing sent, the app's private key can't sign (`reason` "InvalidSigningKey").
 * `reason` is GitHub's message, or says what was refused. Sending again won't help.
 */
export class GitHubRefused extends Schema.TaggedError<GitHubRefused>()("GitHubRefused", {
  status: Schema.Int,
  reason: Schema.String,
}) {}

/**
 * GitHub didn't answer in 15 s, rate-limited the token (403 or 429), or failed (5xx): asking again
 * later may work. For a rate limit, `retryAfter` is when GitHub says to ask again, or a minute from
 * now when it doesn't say, as its documentation asks.
 */
export class GitHubUnavailable extends Schema.TaggedError<GitHubUnavailable>()("GitHubUnavailable", {
  reason: Schema.String,
  retryAfter: Schema.optionalKey(Schema.DateTimeUtc),
}) {}

/**
 * The repository, which the token sees, has no workflow by that file name in `.github/workflows`
 * (GitHub's 404).
 */
export class WorkflowNotFound extends Schema.TaggedError<WorkflowNotFound>()("WorkflowNotFound", {
  workflow: WorkflowFile,
}) {}

/**
 * GitHub wouldn't start the workflow (422): it has no `workflow_dispatch` trigger, an input isn't
 * one it declares, there are more than 25, or the ref doesn't exist. `reason` is GitHub's message,
 * such as "Unexpected inputs provided: [\"version\"]". Sending the same again won't help.
 */
export class WorkflowRejected extends Schema.TaggedError<WorkflowRejected>()("WorkflowRejected", {
  reason: Schema.String,
}) {}
