# @bagatka/github

Reaches GitHub through its REST API, with a token or as a GitHub App: a repository's tags, commits,
comparisons, pull requests and default branch; its releases, published; its workflows, started and
followed; and the app's
installations, tokens, creation from a manifest, and webhooks' signatures.

## Use it

Reading with one token:

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

Acting as a GitHub App, and starting a workflow:

```ts
import { GitHub, GitHubApp, Repository, WorkflowFile } from "@bagatka/github"
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

An app whose credentials come while the product runs, as from the manifest flow below, is made
with `GitHubApp.make(credentials, crypto.subtle)` instead, once per app, and kept: each client
has its own JWT and token caches.

A token GitHub doesn't take, a repository it doesn't show to the token, or a repository the app
isn't installed on fails with `GitHubRefused`, which asking again won't change. A rate limit, a
5xx, or no answer in 15 s fails with `GitHubUnavailable`, with `retryAfter` when GitHub says when
to ask again. A dispatch fails with `WorkflowNotFound` for a workflow file the repository doesn't
have, and `WorkflowRejected`, with GitHub's message, for one GitHub won't start, such as an input
the workflow doesn't declare. Publishing a release without Contents: write, or one GitHub rejects,
fails with `GitHubRefused`, saying which.

Creating the app (GitHub's manifest flow): a page posts `appManifest`'s form to GitHub, the person
confirms the app there, and GitHub sends them to `redirectUrl` with a `code` and the page's
`state`; `convertManifest(code)` then gives the app's ID, slug, private key and secrets, which
GitHub shows only that once, for the host to store. `installLink(slug)` is where someone installs
it. A webhook delivery is checked with `verifyWebhook(crypto.subtle, secret, body, signature)`.

## Contract

`src/index.ts`. Callers build `GitHub` with a token, or with a function giving each repository's
token, and ask about one repository at a time; `GitHubApp` finds the app's installations and issues
their tokens. Each answer is plain data of our own, with GitHub's JSON decoded and left inside the
package.

## Does not own

Where the app's credentials and secrets are kept, which installation a product's records belong
to, and the page that posts the manifest's form: the product's. Which person installed the app,
too: the `installation_id` GitHub adds to the setup URL can be forged, so a product checks it with
`installations` or `installationOf` before trusting it.

## Depends on

`@bagatka/rs256-jwt`, to sign the app's JWTs; `effect`; an `HttpClient` the host provides; and,
for an app and webhooks, the platform's Web Crypto, which the host passes.

## Settings

With a token: a fine-grained personal access token, read-only, with Contents, Metadata and Pull
requests on the repositories it reads. As an app: its ID (or client ID) and private key, from its
settings or from `convertManifest`; to start workflows, the app needs Actions: write, and to follow
them Actions: read; to publish releases, Contents: write. They differ per deployment.

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
- **The app's JWT** is RS256 through Web Crypto, `iat` 60 s in the past and `exp` 9 minutes ahead,
  inside GitHub's 10 even on a clock a minute fast, and signed again after 8 minutes. GitHub gives
  PKCS #1 keys, which `@bagatka/rs256-jwt` wraps in the PKCS #8 Web Crypto imports.
- **Installation tokens are kept** until 5 minutes before they expire (an hour after issue), one
  per installation, and calls at the same time share one request. Which installation reaches a
  repository is kept a minute, so one task's requests ask once, and a reinstalled app, which has a
  new installation, is found within a minute; not being installed isn't kept, so installing takes
  effect at once. A token GitHub revokes before it expires, as when the app is uninstalled, is
  refused (401) until then.
- **Secrets stay out of errors and logs.** Tokens, the JWT, private keys and client and webhook
  secrets are `Redacted` from the moment they are read; an answer holding secrets that isn't
  shaped as documented dies without saying what differs; Effect's headers redact
  `authorization` when shown.
- **A manifest without a webhook URL has no `hook_attributes`,** since GitHub needs its `url`.
  GitHub's manifest documentation doesn't say what it makes of that; its registration with URL
  parameters has a new app's webhook inactive unless set active. Events reach an app only through
  its webhook.
- **Webhooks are checked as GitHub documents:** HMAC-SHA256 of the delivery's bytes with the
  secret, as `sha256=` and hex, compared byte by byte over the whole MAC whatever differs.
- **Tags come from `/tags`, one page of 100.** It names each tag's commit, an annotated tag's
  followed, in one request; `git/matching-refs` needs one more per annotated tag and matches only
  names' beginnings. Matches are kept in version order, highest first, as GitHub doesn't document
  its own order. A repository with more than 100 tags is searched in the first 100 GitHub lists.
- **GitHub's limits are the contract's.** A comparison lists at most 250 commits and counts files,
  additions and deletions over at most 300 files; a commit's answer holds its diff, which GitHub
  may fail to produce in time for a very large one (a 5xx, so unavailable). A dispatch takes at
  most 25 inputs. `installations` and `repositoriesOf` read one page of 100.
- **Rate limits** follow GitHub's documentation: `retry-after` first, then `x-ratelimit-reset` when
  `x-ratelimit-remaining` is 0, else a minute from now.
- **Redirects are the host's.** A renamed or moved repository answers 301; `fetch` follows it. A
  client that doesn't makes it a defect.
- **Not handled:** an installation on an enterprise account, a run whose status is null, and a
  status GitHub hasn't documented die as answers of another shape (`src/answers.ts`).
