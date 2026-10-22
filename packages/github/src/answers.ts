import { Schema } from "effect"

import { CommitSha } from "./commit-sha.ts"

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
