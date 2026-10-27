# @cluenori/watcher

The outside watcher's secrets: the repository an owner names, where Cluenori writes, as the
workspace's GitHub App, the APNs key its alerts are sent with and every owner's push tokens, so the
watcher (Cluenori/cluenori-watch, a GitHub Actions schedule) can ring their phones while Cluenori
itself is down.

## Use it

```ts
const watcher = yield* Watcher

// An owner names the repository, on the web or with `./cluenori watcher set octo-org/cluenori-watch`:
const status = yield* watcher.setRepository(owner, access, Repository.make("octo-org/cluenori-watch"))
// { repository: "octo-org/cluenori-watch", phones: 1, writtenAt }
// Without Secrets: write there: { repository, problem: "octo-org/cluenori-watch's Actions secrets can't be written: …" }

// The host, after every call that can change owners' phones:
yield* watcher.sync // writes only what changed; never fails
```

## Owns

- **Data:** the watcher's repository, the SHA-256 digests of what each secret was last written
  with, and how the last write went (`watcher`).
- **Rules:**
  - Only an owner names the repository or sees its status.
  - The phones written are those with a push token whose member is an owner; members' phones and
    removed members' never are.
  - A secret is written only when its content changed; after a failed write, not again for 5
    minutes, unless an owner names the repository again.
- **Integrations:** GitHub's Actions secrets, through `@cluenori/github`'s `setActionsSecret`.

## Does not own

- **The watcher itself,** its checks, outages and channels: Cluenori/cluenori-watch.
- **Push tokens:** Phones; **who is an owner:** Members; **the app's tokens:** `@cluenori/github-app`.
- **APNs's key:** the Worker's settings, from `./cluenori push setup`.

## Contract

`src/index.ts`. The host serves `WatcherGroup` and calls `sync` after each workspace call that can
change owners' push tokens.

## Depends on

`@cluenori/phones` for push targets, `@cluenori/members` for who is an owner, `@cluenori/github`'s
`GitHub` client, which the host builds on the workspace's app, Foundation's `ActivityLog`, and
`Crypto` for digests.

## Activity

`watcher.repository_set` by the owner who names it. Writing secrets emits none: it isn't a change to
a record, and the status says when it last happened.

## Settings

`Watcher.layer({ push })`: the deployment's APNs key, its IDs and the app's bundle ID, the same the
notifications engine sends with; without them nothing is written, and the status says push isn't set
up.

## Decisions and constraints

- **Trusts** its caller, the deployment's settings, and GitHub's API. **Doesn't trust** a phone's
  member: only an owner's phones go into a public repository's secrets.
- **The key goes to the watcher too,** in `CLUENORI_APNS_KEY`: APNs's tokens last an hour at most,
  so the watcher must sign its own. Cluenori writes it rather than the founder, so the `.p8` is
  handled once and a key set again with `./cluenori push setup` reaches the watcher on the next
  sync. It is a second place that can push to the team's apps; a topic-specific APNs key, limited to
  Cluenori's bundle ID, limits what that copy can do.
- **Secrets: write is the app's on every repository it is installed on,** as GitHub grants an
  app's permissions per installation. Only this engine writes secrets, only to the one repository an
  owner named, with a token limited to it. Installing the app only on the repositories components
  link and the watcher's keeps the rest out of reach.
- **Two secrets,** so a change of phones never rewrites the key. Each is sealed by GitHub's
  repository key (`@cluenori/github`) and never logged; the status holds counts and GitHub's words.
- **Written in the call that changed it,** so the secret holds the current owners' tokens a moment
  after a phone registers or is removed; a write that failed is tried on the next call after 5
  minutes. Not handled: a change with no later call for days stays unwritten until one comes; any
  push, pairing or sign-in makes one.
