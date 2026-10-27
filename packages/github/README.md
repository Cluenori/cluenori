# @cluenori/github

Reaches a repository on GitHub through its REST API, with a token per repository: its tags,
commits, comparisons, pull requests and default branch; its releases, published; its workflows,
started and followed; and its organization's self-hosted runners. A GitHub App's installation
tokens, its manifest flow and its webhooks are `@bagatka/github-app`'s, whose `Repository` this
package exports.

## Use it

Reading with one token:

```ts
import { GitHub, Repository } from "@cluenori/github"
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

Acting as a GitHub App, and starting a workflow:

```ts
import { GitHubApp } from "@bagatka/github-app"
import { GitHub, Repository, WorkflowFile } from "@cluenori/github"
import { DateTime, Effect, Layer, Redacted } from "effect"

// In a host: the app, and GitHub with each repository's installation token.
const AppLive = GitHubApp.layer(
  { appId: 123456, privateKey: Redacted.make(pemText) }, // the PEM GitHub gave, "BEGIN RSA PRIVATE KEY"
  globalThis.crypto.subtle,
)
const GitHubAsApp = Layer.unwrap(
  Effect.gen(function* () {
    const app = yield* GitHubApp
    return GitHub.layerFor((repository) => app.tokenFor(repository).pipe(Effect.map((issued) => issued.token)))
  }),
).pipe(Layer.provide(AppLive))

const promote = Effect.gen(function* () {
  const github = yield* GitHub
  const repository = Repository.make("octo-org/notes")
  const workflow = WorkflowFile.make("promote-to-prod.yml")
  const branch = yield* github.defaultBranch(repository) // "main"
  const run = yield* github.dispatchWorkflow(repository, workflow, branch, { version: "2.4.0" })
  // Option.some({ id: 30433642, url: "https://github.com/octo-org/notes/actions/runs/30433642" })
  // Later: github.workflowRun(repository, 30433642) → Option.some({ status: "completed", conclusion: "success", ... })
})
```

Publishing a release on the repository's Releases page, created or, for a tag that has one,
updated:

```ts
const published = yield* github.publishRelease(repository, {
  tag: "v2.4.0", // made on `commit` when the repository hasn't it
  commit: tags[0].commit,
  name: "2.4.0",
  body: "Notes open twice as fast.", // Markdown
  latest: true,
})
// { url: "https://github.com/octo-org/notes/releases/tag/v2.4.0" }
```

A token GitHub doesn't take, a repository it doesn't show to the token, or a repository the app
isn't installed on fails with `GitHubRefused`, which asking again won't change. A rate limit, a
5xx, or no answer in 15 s fails with `GitHubUnavailable`, with `retryAfter` when GitHub says when
to ask again. A dispatch fails with `WorkflowNotFound` for a workflow file the repository doesn't
have, and `WorkflowRejected`, with GitHub's message, for one GitHub won't start, such as an input
the workflow doesn't declare. Publishing a release without Contents: write, or one GitHub rejects,
fails with `GitHubRefused`, saying which.

## Contract

`src/index.ts`. Callers build `GitHub` with a token, or with a function giving each repository's
token, and ask about one repository at a time. Each answer is plain data of our own, with GitHub's JSON decoded and left inside the
package.

## Does not own

Tokens: the host's function gives each request's, such as a GitHub App's installation token from
`@bagatka/github-app`, which also owns the app's manifest flow and webhooks.

## Depends on

`@bagatka/github-app`, for `Repository`; `effect`; and an `HttpClient` the host provides.

## Settings

With a token: a fine-grained personal access token, read-only, with Contents, Metadata and Pull
requests on the repositories it reads. As an app, its installation tokens need Actions: write to
start workflows and Actions: read to follow them, Contents: write to publish releases, and
Self-hosted runners: read for an organization's runners, and Secrets: write to set Actions secrets. They differ per deployment.

## Decisions and constraints

- **One request per question, or two.** A 404 for a commit, a comparison, a pull request, a run or
  a workflow may mean it isn't there or that the token can't see the repository; GitHub answers
  404 for both, so the package then asks for the repository and fails with `GitHubRefused` only
  when that is 404 too.
- **A token per call.** `GitHub.layerFor` asks its function for every request, with the request's
  repository, so the function decides what to keep; `GitHub.layer` is it with one fixed token.
- **Dispatch names its run.** The dispatch is sent with `return_run_details`, which GitHub added in
  February 2026; it then answers 200 with the run's ID and page instead of 204. A 204 is still
  taken, as none. A dispatch isn't idempotent: after `GitHubUnavailable`, look with
  `workflowRuns` before sending it again.
- **A release is found by its tag, then created or updated:** two requests, so publishing again
  edits the one release rather than adding another. Creating it makes its tag on the commit when
  the repository hasn't it; an existing tag is kept, whatever commit it names.
- **Runs: one page of 20,** created since a time GitHub's search syntax takes to the second, and
  sorted newest first, as GitHub lists them though it doesn't document its order.
- **Secrets stay out of errors and logs.** Tokens are `Redacted`; Effect's headers redact
  `authorization` when shown.
- **Tags come from `/tags`, one page of 100.** It names each tag's commit, an annotated tag's
  followed, in one request; `git/matching-refs` needs one more per annotated tag and matches only
  names' beginnings. Matches are kept in version order, highest first, as GitHub doesn't document
  its own order. A repository with more than 100 tags is searched in the first 100 GitHub lists.
- **GitHub's limits are the contract's.** A comparison lists at most 250 commits and counts files,
  additions and deletions over at most 300 files; a commit's answer holds its diff, which GitHub
  may fail to produce in time for a very large one (a 5xx, so unavailable). A dispatch takes at
  most 25 inputs.
- **Rate limits** follow GitHub's documentation: `retry-after` first, then `x-ratelimit-reset` when
  `x-ratelimit-remaining` is 0, else a minute from now.
- **Actions secrets are sealed here,** with libsodium's sealed box, as GitHub requires: X25519,
  XSalsa20-Poly1305 and BLAKE2b, from `@noble/curves`, `@noble/ciphers` and `@noble/hashes`
  (audited, no dependencies beyond each other), since Web Crypto has no XSalsa20 or BLAKE2b. Its
  tests open what it seals; libsodium's own `crypto_box_seal_open` opened it too, when it was
  written. The value is never logged or put in an error; a secret is written whole, never read back.
- **Redirects are the host's.** A renamed or moved repository answers 301; `fetch` follows it. A
  client that doesn't makes it a defect.
- **Not handled:** a run whose status is null, and a
  status GitHub hasn't documented die as answers of another shape (`src/answers.ts`).
