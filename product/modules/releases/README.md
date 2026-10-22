# @cluenori/releases

Each component's releases, from its telemetry, its CI's deploy reports, and App Store Connect, each
compared with the release before it, with its commit and what changed in its repository since: the
hub where a release's version, code, store build, performance and errors meet.

## Use it

```ts
// Inside the project's Durable Object; the host serves these.
const { releases, problems } = yield* releasesModule.queries.list.run({ period: lastMonth })
// [{ release: "2026.10.22-f00ba47", component: "notes-api", environment: "production",
//    previous: "2026.10.21-e91f09c", verdict: "worse", slower: 1, failingMore: 1, newErrors: 0,
//    commit: { sha, tag: "prod-2026.10.22-f00ba47", message, ... }, deployedAt, ... },
//  { release: "2.4.0+313", component: "notes-ios", verdict: "unmeasured",
//    store: { stage: "releasing", phasedRelease: { day: 2 }, ... } }]
// problems: [{ component: "notes-api", source: "github", problem: "GitHub refused: Bad credentials..." }]

const detail = yield* releasesModule.queries.release.run({ component, release: releases[0].release })
// detail.slower: [{ operation: "GET /api/notes/{id}", p95Ms: 299, previousP95Ms: 33, ... }]
// detail.changes: { totalCommits: 4, pullRequests: [{ number: 12, title: "Faster notes", ... }], ... }
// detail.problems: why its component's commits or builds may be missing, as the list's are

// What cluenori-release sends from CI with the component's ingest key, at /ingest/v1/releases/report.
yield* releasesModule.ingest.report.run(component, { release, environment, commit, tag, commits })

// A release the module doesn't know fails with ReleaseNotFound.
```

## Owns

- **Rules** (`src/verdict.ts`, `src/identity.ts`, `src/catalog.ts`):
  - **The release before:** the latest before it, of the same component and environment, known from telemetry, a deploy, or a store build.
  - **When an operation compares:** 100 runs in both releases.
  - **Slower and faster:** Today's rule, a p95 at least 1.5 times the other's, and 100 ms more.
  - **Fails more and less:** at least 5 failures, 2%, three times the other's rate.
  - **The verdict:** `worse` at once; otherwise `tooEarly` until it ran an hour and an operation compares; `unmeasured` without telemetry.
  - **A release's commit:**
    - its reported deploy's;
    - else the tag named the version, or ending with it after a separator, such as `prod-<version>` or `v<version>`;
    - else a SHA inside the version.
  - **A pull request:** the one a commit's first line names.
  - **An app's build:** it is the release `<version>+<build>`, and its stage comes from App Store Connect's states.
- **Data,** in each project's database:
  - releases' commits (`releases_commits`) and lookups that found none, retried hourly (`releases_lookups`);
  - what changed between releases (`releases_changes`);
  - apps' builds (`releases_store_builds`);
  - deploys reported (`releases_deploys`);
  - each source's last read and problem (`releases_syncs`).

## Does not own

- **Counting by release, each release's span, and errors by release:** `@cluenori/signals`.
- **Which repository and App Store app a component has:** `@cluenori/projects`, its links.
- **Triggering a release's workflow, notes, flags and rollouts:** later slices.

## Contract

`src/index.ts`:
- **`releasesModule`:** its queries, its ingest writes (`report`, `last`), and its background work.
- **`releasesLayer`:** its records and clients, from `ReleasesSettings`.
- **`ReleasesGroup`:** its routes.
- **The Schemas** they carry.

## Depends on

- **Engines:**
  - `@cluenori/signals`: releases, operations and errors by release;
  - `@cluenori/incidents`: incidents while a release ran;
  - `@cluenori/projects`: components' links, and their keys for deploy reports.
- **Capabilities:**
  - `@bagatka/github`: tags, commits, comparisons, pull requests;
  - `@bagatka/app-store-connect`: builds and App Store versions;
  - `@bagatka/es256-jwt`: App Store Connect's tokens.
- **Foundation:** `@cluenori/foundation`, for `defineModule`.

## Settings

`releasesLayer({ github, appStoreConnect, signing })`: a read-only GitHub token and an App Store
Connect API key, each absent until `./cluenori github setup` and `./cluenori appstore setup` store
it as Worker secrets; and Web Crypto, which signs App Store Connect's tokens.

## Background work

Each minute, on the project's alarm:
- **Each component linked to a repository:** it looks up at most 5 releases' commits and compares at most 2 pairs.
- **Each linked app:** it reads App Store Connect every 15 minutes, keeping the 50 latest builds and the 20 latest App Store versions.

A source that refuses or fails is noted for the list, and tried again the next minute.

## Decisions and constraints

- **Counted from October 2026.** Telemetry from before has no release.
- **A deploy report is the generic way:** `cluenori-release`, at the repository's root, runs in any CI with `git` and `curl`, and needs no token. GitHub then adds pull requests, files, and links.
- **An app reports `<version>+<build>`** in `service.version`, so its telemetry joins its store build.
- **Incidents** are those the project keeps: the open ones and those resolved in the last 7 days.
- **Not handled:**
  - a release deployed again after a later one stays where it first ran;
  - a component that reports no environment beside one that does counts both under one release;
  - a repository with more than 100 tags matching a version.
- **A list compares at most 30 releases,** two operation tables and an error table each, read in the project's object.
