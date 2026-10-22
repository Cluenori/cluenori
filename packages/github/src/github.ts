import { Context, DateTime, Effect, Layer, Option, Order } from "effect"
import type { Redacted } from "effect"
import { HttpClient } from "effect/http"

import {
  CommitAnswer,
  ComparisonAnswer,
  DispatchAnswer,
  PullRequestAnswer,
  RepositoryAnswer,
  TagsAnswer,
  WorkflowRunAnswer,
  RunnersAnswer,
  WorkflowRunsAnswer,
} from "./answers.ts"
import type { CommitSha } from "./commit-sha.ts"
import type { GitHubUnavailable } from "./github-errors.ts"
import { GitHubRefused, WorkflowNotFound, WorkflowRejected } from "./github-errors.ts"
import type { Question } from "./github-rest.ts"
import { ask, failure, read, reasonOf } from "./github-rest.ts"
import type { Repository } from "./repository.ts"
import type { WorkflowFile } from "./workflow-file.ts"
import type { WorkflowRunStatus } from "./workflow-run-status.ts"

/**
 * A GitHub token: a fine-grained personal access token, read-only, with Contents, Metadata and
 * Pull requests for the repositories it reads.
 */
export interface GitHubCredentials {
  readonly token: Redacted.Redacted
}

/** A tag and the commit it names; an annotated tag is followed to its commit. */
export interface Tag {
  readonly name: string
  readonly commit: CommitSha
}

/** A commit. */
export interface Commit {
  readonly sha: CommitSha
  /** The whole message, its first line the title. */
  readonly message: string
  /** The author's GitHub login when GitHub knows the account, else the name in the commit. */
  readonly author: string
  /** When it was committed: the committer's date. */
  readonly committedAt: DateTime.Utc
  /** Its page on GitHub. */
  readonly url: string
}

/** What changed from one commit to another. */
export interface Comparison {
  /** Where `head` stands from `base`: `ahead` when it holds commits `base` doesn't. */
  readonly status: "ahead" | "behind" | "diverged" | "identical"
  /** Every commit `head` has that `base` doesn't. */
  readonly totalCommits: number
  /**
   * The commits, oldest first: at most 250, as GitHub lists them; with more, the last is still
   * `head`'s latest, and `totalCommits` counts them all.
   */
  readonly commits: ReadonlyArray<Commit>
  /**
   * The files changed, and the lines added to and deleted from them, over the files GitHub lists:
   * at most 300. A comparison that changes more counts only those 300.
   */
  readonly filesChanged: number
  readonly additions: number
  readonly deletions: number
  /** The comparison's page on GitHub. */
  readonly url: string
}

/** A pull request. */
export interface PullRequest {
  readonly number: number
  readonly title: string
  /** Its author's GitHub login. */
  readonly author: string
  /** Its page on GitHub. */
  readonly url: string
  /** When it was merged; absent while it isn't. */
  readonly mergedAt?: DateTime.Utc
  /** Its labels' names. */
  readonly labels: ReadonlyArray<string>
}

/** The run a dispatch started: its ID, for `workflowRun`, and its page on GitHub. */
export interface DispatchedRun {
  readonly id: number
  readonly url: string
}

/** A self-hosted runner: its name, whether it is online and busy, and its labels. */
export interface SelfHostedRunner {
  readonly name: string
  readonly online: boolean
  readonly busy: boolean
  readonly labels: ReadonlyArray<string>
}

/** A run of a workflow. */
export interface WorkflowRun {
  readonly id: number
  readonly status: WorkflowRunStatus
  /**
   * How it ended, once `completed`, as GitHub names it: `success`, `failure`, `cancelled`,
   * `timed_out`, `action_required`, `neutral`, `skipped`, `stale`, or another GitHub adds. Absent
   * while it runs.
   */
  readonly conclusion?: string
  readonly createdAt: DateTime.Utc
  /** When GitHub last changed it, such as its status. */
  readonly updatedAt: DateTime.Utc
  /** Its page on GitHub. */
  readonly url: string
  /** The login of the account that started it, when GitHub names one. */
  readonly actor?: string
  /** Its title on GitHub: the workflow's `run-name`, or what the event gives, such as a commit's title. */
  readonly displayTitle: string
}

// One page of tags, GitHub's largest, and the matches kept from it.
const tagsRead = 100
const tagsKept = 20
// A workflow's runs, one page of them.
const runsRead = 20

const newestFirst = Order.flip(
  Order.combine(
    Order.mapInput(DateTime.Order, (run: WorkflowRun) => run.createdAt),
    Order.mapInput(Order.Number, (run: WorkflowRun) => run.id),
  ),
)

/**
 * GitHub's REST API for one repository at a time: its tags, commits, comparisons and pull requests,
 * its default branch, and its workflows, started and followed. Each call asks GitHub once, or twice
 * to tell a missing item from a repository the token can't see, with the token for its repository.
 */
export class GitHub extends Context.Service<
  GitHub,
  {
    /**
     * The tags whose names contain `text`, such as a version, each with its commit: at most 20, in
     * version order, the highest first (`v2.10.0` before `v2.9.0`). Reads one page of the
     * repository's tags, the first 100 GitHub lists.
     */
    readonly tagsContaining: (
      repository: Repository,
      text: string,
    ) => Effect.Effect<ReadonlyArray<Tag>, GitHubRefused | GitHubUnavailable>
    /**
     * The commit `ref` names: a SHA or a prefix of at least 7 of it, a tag, or a branch. None when
     * there's no such commit, the repository is empty, or `ref` can't be a git name (an empty part,
     * or one starting with a dot). GitHub's answer holds the commit's diff, so a large one takes long.
     */
    readonly commit: (
      repository: Repository,
      ref: string,
    ) => Effect.Effect<Option.Option<Commit>, GitHubRefused | GitHubUnavailable>
    /** What changed from `base` to `head`; one answer of up to a few MB, as it holds the diff. */
    readonly compare: (
      repository: Repository,
      base: CommitSha,
      head: CommitSha,
    ) => Effect.Effect<Comparison, GitHubRefused | GitHubUnavailable>
    /** The pull request `number` is; none when it isn't one, as for an issue's number. */
    readonly pullRequest: (
      repository: Repository,
      number: number,
    ) => Effect.Effect<Option.Option<PullRequest>, GitHubRefused | GitHubUnavailable>
    /** The repository's default branch, such as `main`. One request. */
    readonly defaultBranch: (repository: Repository) => Effect.Effect<string, GitHubRefused | GitHubUnavailable>
    /**
     * Starts `workflow` on `ref`, a branch or a tag, with `inputs`: one `workflow_dispatch` event,
     * which the workflow must declare, as it must each input. Some of the run it started, which
     * GitHub names when asked with `return_run_details`, as it is; none when GitHub started one
     * without naming it (a 204, as before `return_run_details`), which `workflowRuns` then finds.
     * Needs Actions: write.
     *
     * Not idempotent: each call starts a run. An unavailable answer may come after GitHub started
     * one, so look with `workflowRuns` before asking again.
     */
    readonly dispatchWorkflow: (
      repository: Repository,
      workflow: WorkflowFile,
      ref: string,
      inputs: Readonly<Record<string, string>>,
    ) => Effect.Effect<
      Option.Option<DispatchedRun>,
      GitHubRefused | GitHubUnavailable | WorkflowNotFound | WorkflowRejected
    >
    /**
     * The workflow's runs created at or after `createdSince`, taken to the second, and, with
     * `event`, started by it (such as `workflow_dispatch`): newest first, at most 20, from one page
     * of GitHub's list. Needs Actions: read.
     */
    readonly workflowRuns: (
      repository: Repository,
      workflow: WorkflowFile,
      options: { readonly createdSince: DateTime.Utc; readonly event?: string },
    ) => Effect.Effect<ReadonlyArray<WorkflowRun>, GitHubRefused | GitHubUnavailable | WorkflowNotFound>
    /** The run with this ID; none when the repository has no such run. Needs Actions: read. */
    readonly workflowRun: (
      repository: Repository,
      id: number,
    ) => Effect.Effect<Option.Option<WorkflowRun>, GitHubRefused | GitHubUnavailable>
    /**
     * The self-hosted runners of the organization that owns `repository`, at most 100: whether each
     * is online now. One request; needs the organization permission Self-hosted runners: read.
     * Refused when the owner is a user rather than an organization, or without that permission.
     */
    readonly selfHostedRunners: (
      repository: Repository,
    ) => Effect.Effect<ReadonlyArray<SelfHostedRunner>, GitHubRefused | GitHubUnavailable>
  }
>()("@bagatka/github/github") {
  /**
   * GitHub's API with the token `tokenFor` gives for each call's repository, asked on every call,
   * such as a GitHub App's installation token (`GitHubApp.tokenFor`, mapped to its token). A
   * refusal or unavailability of `tokenFor` is the call's. On the `HttpClient` the host provides,
   * which follows redirects, as `fetch` does, for a repository that was renamed or moved.
   */
  static readonly layerFor = (
    tokenFor: (repository: Repository) => Effect.Effect<Redacted.Redacted, GitHubRefused | GitHubUnavailable>,
  ): Layer.Layer<GitHub, never, HttpClient.HttpClient> =>
    Layer.effect(
      GitHub,
      Effect.gen(function* () {
        const client = yield* HttpClient.HttpClient

        // One request about `repository`, with the token for it.
        const askAbout = (repository: Repository, question: Omit<Question, "token">) =>
          Effect.flatMap(tokenFor(repository), (token) => ask(client, { ...question, token }))

        // Succeeds when the token sees the repository, so a 404 for something in it means that thing
        // isn't there; refused when it doesn't.
        const visible = Effect.fn("GitHub.visible")(function* (repository: Repository) {
          const answer = yield* askAbout(repository, { method: "GET", path: `/repos/${repository}` })
          if (answer.status === 200) {
            return
          }
          if (answer.status === 404) {
            return yield* refusedRepository(repository)
          }
          return yield* failure(answer)
        })

        const tagsContaining = Effect.fn("GitHub.tagsContaining")(function* (repository: Repository, text: string) {
          // `/tags` follows annotated tags to their commits in one request; `git/matching-refs`
          // would take one more for each, and matches only names' beginnings.
          // Not handled: a repository with more than 100 tags, of which only the first page GitHub
          // lists is searched, in an order GitHub doesn't document. Handling it would take following
          // the `link` header's next pages, within a bound, or GraphQL's `refs` with a query.
          const answer = yield* askAbout(repository, {
            method: "GET",
            path: `/repos/${repository}/tags`,
            urlParams: { per_page: tagsRead },
          })
          if (answer.status === 404) {
            return yield* refusedRepository(repository)
          }
          if (answer.status !== 200) {
            return yield* failure(answer)
          }
          const tags = yield* read(TagsAnswer, answer)
          return tags
            .filter((tag) => tag.name.includes(text))
            .toSorted((a, b) => byVersion(b.name, a.name))
            .slice(0, tagsKept)
            .map((tag): Tag => ({ name: tag.name, commit: tag.commit.sha }))
        })

        const commit = Effect.fn("GitHub.commit")(function* (repository: Repository, ref: string) {
          // Git's names have no empty part and none starting with a dot, which also keeps `.` and
          // `..` out of the path. A branch's slashes stay, as GitHub reads the ref's parts.
          const parts = ref.split("/")
          const nameable = parts.every((part) => part !== "" && !part.startsWith("."))
          if (!nameable) {
            return Option.none<Commit>()
          }
          const answer = yield* askAbout(repository, {
            method: "GET",
            path: `/repos/${repository}/commits/${parts.map(encodeURIComponent).join("/")}`,
          })
          if (answer.status === 200) {
            const found = yield* read(CommitAnswer, answer)
            return Option.some(commitOf(found))
          }
          // 422: GitHub has no commit by that name; 409: the repository is empty.
          if (answer.status === 422 || answer.status === 409) {
            return Option.none<Commit>()
          }
          if (answer.status === 404) {
            yield* visible(repository)
            return Option.none<Commit>()
          }
          return yield* failure(answer)
        })

        const compare = Effect.fn("GitHub.compare")(function* (
          repository: Repository,
          base: CommitSha,
          head: CommitSha,
        ) {
          const answer = yield* askAbout(repository, {
            method: "GET",
            path: `/repos/${repository}/compare/${base}...${head}`,
          })
          if (answer.status === 200) {
            const comparison = yield* read(ComparisonAnswer, answer)
            return comparisonOf(comparison)
          }
          if (answer.status === 404) {
            yield* visible(repository)
            // Not handled: `base` or `head` isn't in the repository, or the two share no history.
            // Commits a caller found with `commit` are; handling it would take an error of its own.
            return yield* Effect.die(
              `GitHub has no comparison of ${base}...${head} in ${repository}: a commit isn't in it, or they share no history`,
            )
          }
          return yield* failure(answer)
        })

        const pullRequest = Effect.fn("GitHub.pullRequest")(function* (repository: Repository, number: number) {
          const numbered = Number.isSafeInteger(number) && number > 0
          if (!numbered) {
            return Option.none<PullRequest>()
          }
          const answer = yield* askAbout(repository, { method: "GET", path: `/repos/${repository}/pulls/${number}` })
          if (answer.status === 200) {
            const found = yield* read(PullRequestAnswer, answer)
            return Option.some(pullRequestOf(found))
          }
          if (answer.status === 404) {
            yield* visible(repository)
            return Option.none<PullRequest>()
          }
          return yield* failure(answer)
        })

        const defaultBranch = Effect.fn("GitHub.defaultBranch")(function* (repository: Repository) {
          const answer = yield* askAbout(repository, { method: "GET", path: `/repos/${repository}` })
          if (answer.status === 200) {
            const found = yield* read(RepositoryAnswer, answer)
            return found.default_branch
          }
          if (answer.status === 404) {
            return yield* refusedRepository(repository)
          }
          return yield* failure(answer)
        })

        const dispatchWorkflow = Effect.fn("GitHub.dispatchWorkflow")(function* (
          repository: Repository,
          workflow: WorkflowFile,
          ref: string,
          inputs: Readonly<Record<string, string>>,
        ) {
          const answer = yield* askAbout(repository, {
            method: "POST",
            path: `/repos/${repository}/actions/workflows/${workflow}/dispatches`,
            body: { ref, inputs, return_run_details: true },
          })
          if (answer.status === 200) {
            const started = yield* read(DispatchAnswer, answer)
            return Option.some<DispatchedRun>({ id: started.workflow_run_id, url: started.html_url })
          }
          // 204: started, without saying which run, as GitHub answers without `return_run_details`.
          if (answer.status === 204) {
            return Option.none<DispatchedRun>()
          }
          if (answer.status === 404) {
            yield* visible(repository)
            return yield* new WorkflowNotFound({ workflow })
          }
          if (answer.status === 422) {
            const reason = yield* reasonOf(answer)
            return yield* new WorkflowRejected({ reason })
          }
          return yield* failure(answer)
        })

        const workflowRuns = Effect.fn("GitHub.workflowRuns")(function* (
          repository: Repository,
          workflow: WorkflowFile,
          options: { readonly createdSince: DateTime.Utc; readonly event?: string },
        ) {
          // Not handled: GitHub's order, which its documentation doesn't state; it lists the newest
          // first, and the page read is sorted so. Were it another order, the 20 read could miss newer
          // runs; handling it would take reading every page since `createdSince`.
          const answer = yield* askAbout(repository, {
            method: "GET",
            path: `/repos/${repository}/actions/workflows/${workflow}/runs`,
            urlParams: {
              created: `>=${searchTime(options.createdSince)}`,
              ...(options.event === undefined ? {} : { event: options.event }),
              exclude_pull_requests: "true",
              per_page: runsRead,
            },
          })
          if (answer.status === 200) {
            const page = yield* read(WorkflowRunsAnswer, answer)
            return page.workflow_runs.map(workflowRunOf).toSorted(newestFirst)
          }
          if (answer.status === 404) {
            yield* visible(repository)
            return yield* new WorkflowNotFound({ workflow })
          }
          return yield* failure(answer)
        })

        const workflowRun = Effect.fn("GitHub.workflowRun")(function* (repository: Repository, id: number) {
          const numbered = Number.isSafeInteger(id) && id > 0
          if (!numbered) {
            return Option.none<WorkflowRun>()
          }
          const answer = yield* askAbout(repository, {
            method: "GET",
            path: `/repos/${repository}/actions/runs/${id}`,
            urlParams: { exclude_pull_requests: "true" },
          })
          if (answer.status === 200) {
            const found = yield* read(WorkflowRunAnswer, answer)
            return Option.some(workflowRunOf(found))
          }
          if (answer.status === 404) {
            yield* visible(repository)
            return Option.none<WorkflowRun>()
          }
          return yield* failure(answer)
        })

        const selfHostedRunners = Effect.fn("GitHub.selfHostedRunners")(function* (repository: Repository) {
          const [owner = ""] = repository.split("/")
          const answer = yield* askAbout(repository, {
            method: "GET",
            path: `/orgs/${encodeURIComponent(owner)}/actions/runners`,
            urlParams: { per_page: 100 },
          })
          if (answer.status === 200) {
            const page = yield* read(RunnersAnswer, answer)
            return page.runners.map((runner): SelfHostedRunner => ({
              name: runner.name,
              online: runner.status === "online",
              busy: runner.busy,
              labels: runner.labels.map((label) => label.name),
            }))
          }
          if (answer.status === 403 || answer.status === 404) {
            return yield* new GitHubRefused({
              status: answer.status,
              reason: `${owner}'s self-hosted runners can't be read: it isn't an organization, or the token lacks Self-hosted runners: read`,
            })
          }
          return yield* failure(answer)
        })

        return GitHub.of({
          selfHostedRunners,
          tagsContaining,
          commit,
          compare,
          pullRequest,
          defaultBranch,
          dispatchWorkflow,
          workflowRuns,
          workflowRun,
        })
      }),
    )

  /** GitHub's API with one fixed token for every repository: `layerFor` with `credentials.token`. */
  static readonly layer = (credentials: GitHubCredentials): Layer.Layer<GitHub, never, HttpClient.HttpClient> =>
    GitHub.layerFor(() => Effect.succeed(credentials.token))
}

const refusedRepository = (repository: Repository) =>
  Effect.fail(
    new GitHubRefused({
      status: 404,
      reason: `GitHub shows no repository ${repository} to this token: it doesn't exist, or the token can't read it`,
    }),
  )

// An instant as GitHub's search syntax takes it, to the second: `2026-10-22T10:00:00Z`. Dropping
// the milliseconds rounds down, so a run created in that second is still found.
const searchTime = (instant: DateTime.Utc) => DateTime.formatIso(instant).replace(/\.\d+Z$/, "Z")

const commitOf = (answer: CommitAnswer): Commit => ({
  sha: answer.sha,
  message: answer.commit.message,
  author: answer.author?.login ?? answer.commit.author.name,
  committedAt: answer.commit.committer.date,
  url: answer.html_url,
})

const comparisonOf = (answer: ComparisonAnswer): Comparison => ({
  status: answer.status,
  totalCommits: answer.total_commits,
  commits: answer.commits.map(commitOf),
  filesChanged: answer.files.length,
  additions: answer.files.reduce((total, file) => total + file.additions, 0),
  deletions: answer.files.reduce((total, file) => total + file.deletions, 0),
  url: answer.html_url,
})

const pullRequestOf = (answer: PullRequestAnswer): PullRequest => ({
  number: answer.number,
  title: answer.title,
  author: answer.user.login,
  url: answer.html_url,
  ...(answer.merged_at === null ? {} : { mergedAt: answer.merged_at }),
  labels: answer.labels.map((label) => label.name),
})

const workflowRunOf = (answer: WorkflowRunAnswer): WorkflowRun => ({
  id: answer.id,
  status: answer.status,
  ...(answer.conclusion === null ? {} : { conclusion: answer.conclusion }),
  createdAt: answer.created_at,
  updatedAt: answer.updated_at,
  url: answer.html_url,
  ...(answer.actor === undefined ? {} : { actor: answer.actor.login }),
  displayTitle: answer.display_title,
})

// Names in version order: runs of digits compare as numbers, so `v2.9.0` comes before `v2.10.0`,
// and the rest in code-point order, as machine text sorts; a name before the names it begins.
const byVersion = (a: string, b: string): number => {
  const aParts = a.match(/\d+|\D+/g) ?? []
  const bParts = b.match(/\d+|\D+/g) ?? []
  const differs = aParts.findIndex((part, index) => part !== bParts[index])
  const aPart = aParts[differs]
  const bPart = bParts[differs]
  if (aPart === undefined || bPart === undefined) {
    // One name's parts begin the other's: the shorter first.
    return aParts.length - bParts.length
  }
  const numeric = /^\d/.test(aPart) && /^\d/.test(bPart)
  if (numeric) {
    const difference = BigInt(aPart) - BigInt(bPart)
    if (difference !== 0n) {
      return difference < 0n ? -1 : 1
    }
  }
  return aPart < bPart ? -1 : 1
}
