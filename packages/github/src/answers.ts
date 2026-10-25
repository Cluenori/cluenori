import { Schema } from "effect"

import { CommitSha } from "./commit-sha.ts"
import { WorkflowRunStatus } from "./workflow-run-status.ts"

// The parts of GitHub's JSON this package reads, as its REST API's description defines them
// (github/rest-api-description, `api.github.com.json`, API version 2022-11-28). Fields it doesn't
// read are ignored; a field it reads that is missing or of another type fails the decoding.

/** `GET /repos/{owner}/{repo}/tags`: each tag with the commit it names, an annotated tag's followed. */
export const TagsAnswer = Schema.Array(
  Schema.Struct({
    name: Schema.String,
    commit: Schema.Struct({ sha: CommitSha }),
  }),
)

/** A commit, as `GET /repos/{owner}/{repo}/commits/{ref}` answers it and a comparison lists it. */
export const CommitAnswer = Schema.Struct({
  sha: CommitSha,
  html_url: Schema.String,
  commit: Schema.Struct({
    message: Schema.String,
    author: Schema.Struct({ name: Schema.String }),
    committer: Schema.Struct({ date: Schema.DateTimeUtcFromString }),
  }),
  // The GitHub account of the commit's author: null, or an empty object, when GitHub knows none.
  author: Schema.NullOr(Schema.Struct({ login: Schema.optionalKey(Schema.String) })),
})
export type CommitAnswer = typeof CommitAnswer.Type

/** `GET /repos/{owner}/{repo}/compare/{base}...{head}`, without paging. */
export const ComparisonAnswer = Schema.Struct({
  status: Schema.Literals(["ahead", "behind", "diverged", "identical"]),
  total_commits: Schema.Int,
  commits: Schema.Array(CommitAnswer),
  // GitHub lists at most 300 files, on the first page of a comparison, the only one asked for.
  files: Schema.Array(Schema.Struct({ additions: Schema.Int, deletions: Schema.Int })),
  html_url: Schema.String,
})
export type ComparisonAnswer = typeof ComparisonAnswer.Type

/** `GET /repos/{owner}/{repo}/pulls/{pull_number}`. */
export const PullRequestAnswer = Schema.Struct({
  number: Schema.Int,
  title: Schema.String,
  user: Schema.Struct({ login: Schema.String }),
  html_url: Schema.String,
  merged_at: Schema.NullOr(Schema.DateTimeUtcFromString),
  labels: Schema.Array(Schema.Struct({ name: Schema.String })),
})
export type PullRequestAnswer = typeof PullRequestAnswer.Type

/** `GET /repos/{owner}/{repo}`: the repository, of which its default branch is read. */
export const RepositoryAnswer = Schema.Struct({ default_branch: Schema.String })

/**
 * `POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches` with `return_run_details`,
 * answered 200: the run it started (`workflow-dispatch-response`).
 */
export const DispatchAnswer = Schema.Struct({ workflow_run_id: Schema.Int, html_url: Schema.String })

/**
 * A release, as `GET /repos/{owner}/{repo}/releases/tags/{tag}` finds it and creating or updating
 * one answers it: its ID, to update it, and its page.
 */
export const ReleaseAnswer = Schema.Struct({ id: Schema.Int, html_url: Schema.String })

/** A workflow run, as `GET /repos/{owner}/{repo}/actions/runs/{run_id}` answers it and a list holds it. */
export const WorkflowRunAnswer = Schema.Struct({
  id: Schema.Int,
  // Not handled: a run whose status is null, which GitHub's description allows without saying when;
  // it dies as an answer of another shape. Handling it would take an unknown status of our own.
  status: WorkflowRunStatus,
  conclusion: Schema.NullOr(Schema.String),
  created_at: Schema.DateTimeUtcFromString,
  updated_at: Schema.DateTimeUtcFromString,
  html_url: Schema.String,
  actor: Schema.optionalKey(Schema.Struct({ login: Schema.String })),
  display_title: Schema.String,
})
export type WorkflowRunAnswer = typeof WorkflowRunAnswer.Type

/** `GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs`: one page of runs. */
export const WorkflowRunsAnswer = Schema.Struct({ workflow_runs: Schema.Array(WorkflowRunAnswer) })

/** `GET /orgs/{org}/actions/runners`: one page of an organization's self-hosted runners. */
export const RunnersAnswer = Schema.Struct({
  runners: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      status: Schema.String,
      busy: Schema.Boolean,
      labels: Schema.Array(Schema.Struct({ name: Schema.String })),
    }),
  ),
})

/** What GitHub says when it doesn't answer what was asked: `{ "message": "Bad credentials", ... }`. */
export const ErrorAnswer = Schema.fromJsonString(Schema.Struct({ message: Schema.String }))

/**
 * The headers GitHub says a rate limit with: `retry-after` in seconds; the requests left in the
 * window, and when it resets, in Unix seconds.
 */
export const RateLimitHeaders = Schema.Struct({
  "retry-after": Schema.optionalKey(Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))),
  "x-ratelimit-remaining": Schema.optionalKey(Schema.String),
  "x-ratelimit-reset": Schema.optionalKey(Schema.NumberFromString.check(Schema.isInt())),
})
