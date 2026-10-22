import { Context, DateTime, Duration, Effect, Layer, Option, Schema } from "effect"
import type { Redacted } from "effect"
import type { Headers } from "effect/http"
import { HttpClient, HttpClientRequest } from "effect/http"

import {
  CommitAnswer,
  ComparisonAnswer,
  ErrorAnswer,
  PullRequestAnswer,
  RateLimitHeaders,
  TagsAnswer,
} from "./answers.ts"
import type { CommitSha } from "./commit-sha.ts"
import type { Repository } from "./repository.ts"

/**
 * A GitHub token: a fine-grained personal access token, read-only, with Contents, Metadata and
 * Pull requests for the repositories it reads.
 */
export interface GitHubCredentials {
  readonly token: Redacted.Redacted
}

/**
 * GitHub refused: the token is wrong or expired (401), lacks access (403), or the repository isn't
 * visible to it (404, for the repository). `reason` is GitHub's message, or says which repository.
 * Sending again won't help.
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

const api = "https://api.github.com"
const apiVersion = "2022-11-28"
// GitHub refuses a request without a User-Agent, and asks for the application's name in it.
const userAgent = "@bagatka/github"
const answerTimeout = Duration.seconds(15)
// One page of tags, GitHub's largest, and the matches kept from it.
const tagsRead = 100
const tagsKept = 20

// What GitHub answered one GET: the path asked, its status, headers, and body as text.
interface Answer {
  readonly path: string
  readonly status: number
  readonly headers: Headers.Headers
  readonly body: string
}

/**
 * GitHub's REST API, read-only: tags, commits, comparisons, and pull requests of a repository. Each
 * call asks GitHub once, or twice to tell a missing item from a repository the token can't see.
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
  }
>()("@bagatka/github/github") {
  /**
   * GitHub's API with `credentials`, on the `HttpClient` the host provides, which follows
   * redirects, as `fetch` does, for a repository that was renamed or moved.
   */
  static readonly layer = (credentials: GitHubCredentials) =>
    Layer.effect(
      GitHub,
      Effect.gen(function* () {
        const client = yield* HttpClient.HttpClient

        // One GET of GitHub's API with its body read: unavailable when that takes more than 15 s.
        const ask = Effect.fn("GitHub.ask")(function* (path: string, urlParams: Readonly<Record<string, number>> = {}) {
          const request = HttpClientRequest.get(`${api}${path}`).pipe(
            HttpClientRequest.setUrlParams(urlParams),
            HttpClientRequest.bearerToken(credentials.token),
            HttpClientRequest.setHeaders({
              accept: "application/vnd.github+json",
              "x-github-api-version": apiVersion,
              "user-agent": userAgent,
            }),
          )
          return yield* client.execute(request).pipe(
            Effect.flatMap((response) =>
              Effect.map(response.text, (body): Answer => ({
                path,
                status: response.status,
                headers: response.headers,
                body,
              })),
            ),
            Effect.timeout(answerTimeout),
            Effect.catchTags({
              TimeoutError: () => Effect.fail(new GitHubUnavailable({ reason: "GitHub didn't answer in 15 s" })),
              HttpClientError: () => Effect.fail(new GitHubUnavailable({ reason: "GitHub didn't answer" })),
            }),
          )
        })

        // What an answer means when the method asking doesn't read its status: refused, unavailable,
        // or, for a status GitHub doesn't document there, a defect.
        const failure = Effect.fn("GitHub.failure")(function* (answer: Answer) {
          const reason = yield* reasonOf(answer)
          if (answer.status === 401) {
            return yield* new GitHubRefused({ status: answer.status, reason })
          }
          if (answer.status === 403 || answer.status === 429) {
            const limited = yield* rateLimitedUntil(answer, reason)
            if (Option.isSome(limited)) {
              return yield* new GitHubUnavailable({ reason, retryAfter: limited.value })
            }
            return yield* new GitHubRefused({ status: answer.status, reason })
          }
          if (answer.status >= 500) {
            return yield* new GitHubUnavailable({ reason })
          }
          return yield* Effect.die(`GitHub answered GET ${answer.path} with ${answer.status}: ${reason}`)
        })

        // Succeeds when the token sees the repository, so a 404 for something in it means that thing
        // isn't there; refused when it doesn't.
        const visible = Effect.fn("GitHub.visible")(function* (repository: Repository) {
          const answer = yield* ask(`/repos/${repository}`)
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
          const answer = yield* ask(`/repos/${repository}/tags`, { per_page: tagsRead })
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
          const answer = yield* ask(`/repos/${repository}/commits/${parts.map(encodeURIComponent).join("/")}`)
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
          const answer = yield* ask(`/repos/${repository}/compare/${base}...${head}`)
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
          const answer = yield* ask(`/repos/${repository}/pulls/${number}`)
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

        return GitHub.of({ tagsContaining, commit, compare, pullRequest })
      }),
    )
}

const refusedRepository = (repository: Repository) =>
  Effect.fail(
    new GitHubRefused({
      status: 404,
      reason: `GitHub shows no repository ${repository} to this token: it doesn't exist, or the token can't read it`,
    }),
  )

// GitHub's JSON answer decoded with `schema`. An answer of another shape is a defect that says what
// differs, never a default.
const read = <S extends Schema.Decoder<unknown>>(schema: S, answer: Answer) =>
  Schema.decodeEffect(Schema.fromJsonString(schema))(answer.body).pipe(
    Effect.catchTag("SchemaError", (error) =>
      Effect.die(`GitHub's answer to GET ${answer.path} isn't shaped as its documentation says: ${error.message}`),
    ),
  )

// GitHub's message in an answer it didn't answer the question with, or the status alone when it sent
// none, as a 5xx from in front of the API may not.
const reasonOf = (answer: Answer) =>
  Schema.decodeEffect(ErrorAnswer)(answer.body).pipe(
    Effect.map((error) => error.message),
    Effect.orElseSucceed(() => `HTTP ${answer.status}`),
  )

// When a 403 or 429 is a rate limit, when to ask again: after `retry-after`, at the limit's reset
// when none are left, else a minute from now, as GitHub's documentation asks. None for a refusal.
const rateLimitedUntil = Effect.fn("GitHub.rateLimitedUntil")(function* (answer: Answer, reason: string) {
  const headers = yield* Schema.decodeUnknownEffect(RateLimitHeaders)(answer.headers).pipe(
    Effect.catchTag("SchemaError", (error) =>
      Effect.die(`GitHub's rate-limit headers aren't numbers: ${error.message}`),
    ),
  )
  const now = yield* DateTime.now
  const retryAfter = headers["retry-after"]
  if (retryAfter !== undefined) {
    return Option.some(DateTime.add(now, { seconds: retryAfter }))
  }
  const exhausted = headers["x-ratelimit-remaining"] === "0"
  const resetsAt = headers["x-ratelimit-reset"]
  if (exhausted && resetsAt !== undefined) {
    return Option.some(DateTime.fromEpochSeconds(resetsAt))
  }
  const limited = exhausted || answer.status === 429 || /rate limit/i.test(reason)
  return limited ? Option.some(DateTime.add(now, { minutes: 1 })) : Option.none<DateTime.Utc>()
})

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
