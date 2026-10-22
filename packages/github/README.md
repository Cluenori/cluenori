# @bagatka/github

Reads a GitHub repository through GitHub's REST API, read-only, with a token: the tags that name a
version, the commit a ref names, what changed between two commits, and a pull request.

## Use it

```ts
import { GitHub, Repository } from "@bagatka/github"
import { Effect, Option, Redacted } from "effect"

// In a host, on the HttpClient it provides (fetch's, in Workers):
const GitHubLive = GitHub.layer({ token: Redacted.make(githubToken) })

const program = Effect.gen(function* () {
  const github = yield* GitHub
  const repository = Repository.make("octocat/Hello-World")

  const tags = yield* github.tagsContaining(repository, "2.4.0")
  // [{ name: "v2.4.0", commit: "6dcb09b5…" }, { name: "ios-v2.4.0", commit: "6dcb09b5…" }]
  const previous = yield* github.commit(repository, "v2.3.0")
  // Option.some({ sha, message, author: "octocat", committedAt, url }), or none for no such ref

  if (tags[0] !== undefined && Option.isSome(previous)) {
    const changes = yield* github.compare(repository, previous.value.sha, tags[0].commit)
    // { status: "ahead", totalCommits: 12, commits: [oldest, …, newest], filesChanged: 34, additions: 560, ... }
  }
})
```

A token GitHub doesn't take, or a repository it doesn't show to the token, fails with
`GitHubRefused`, which asking again won't change. A rate limit, a 5xx, or no answer in 15 s fails
with `GitHubUnavailable`, with `retryAfter` when GitHub says when to ask again.

## Contract

`src/index.ts`. Callers build the layer with a token and ask about one repository at a time: each
answer is plain data of our own, with GitHub's JSON decoded and left inside the package.

## Depends on

`effect`, and an `HttpClient` the host provides.

## Settings

The token: a fine-grained personal access token, read-only, with Contents, Metadata and Pull
requests on the repositories it reads. It differs per deployment.

## Decisions and constraints

- **One request per question, or two.** A 404 for a commit, a comparison or a pull request may mean
  it isn't there or that the token can't see the repository; GitHub answers 404 for both, so the
  package then asks for the repository and fails with `GitHubRefused` only when that is 404 too.
- **Tags come from `/tags`, one page of 100.** It names each tag's commit, an annotated tag's
  followed, in one request; `git/matching-refs` needs one more per annotated tag and matches only
  names' beginnings. Matches are kept in version order, highest first, as GitHub doesn't document
  its own order. A repository with more than 100 tags is searched in the first 100 GitHub lists.
- **GitHub's limits are the contract's.** A comparison lists at most 250 commits and counts files,
  additions and deletions over at most 300 files; a commit's answer holds its diff, which GitHub
  may fail to produce in time for a very large one (a 5xx, so unavailable).
- **Rate limits** follow GitHub's documentation: `retry-after` first, then `x-ratelimit-reset` when
  `x-ratelimit-remaining` is 0, else a minute from now.
- **Redirects are the host's.** A renamed or moved repository answers 301; `fetch` follows it. A
  client that doesn't makes it a defect.
- **The token stays out of errors and logs.** It is `Redacted`, and Effect's headers redact
  `authorization` when shown.
