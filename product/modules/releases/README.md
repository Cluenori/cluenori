# @cluenori/releases

Each component's releases, as its telemetry reports them in `service.version`, each compared with
the release before it, so a deploy that made things slower or failing shows the day it runs.

## Use it

```ts
// Inside the project's Durable Object, with Signals and Incidents there; the host serves these.
const { releases } = yield* releasesModule.queries.list.run({ period: lastMonth })
// [{ release: "2026.10.22-f00ba47", component: "notes-api", environment: "production",
//    previous: "2026.10.21-e91f09c", verdict: "worse", slower: 1, failingMore: 1, newErrors: 0, ... }]

const detail = yield* releasesModule.queries.release.run({ component, release: releases[0].release })
// detail.slower: [{ operation: "GET /api/notes/{id}", p95Ms: 299, previousP95Ms: 33, ... }]

// A release Signals never counted fails with ReleaseNotFound.
```

## Owns

- **Rules:** the release before a release (the latest first seen before it, of the same component
  and environment); when an operation compares (100 runs in both); slower and faster (Today's rule:
  a p95 at least 1.5 times the other's, and 100 ms more); fails more and less (at least 5 failures,
  2%, three times the other's rate); and the verdict, `worse` at once, otherwise `tooEarly` until
  it ran an hour and an operation compares (`src/verdict.ts`).
- **Data:** none of its own: it reads Signals' counts by release and error groups' first release,
  and the project's incidents.

## Does not own

- **Counting by release, and each release's span:** `@cluenori/signals`.
- **Releases from git tags, store builds, rollouts and notes:** later slices (`concept/Modules.md`,
  "Release page").

## Contract

`src/index.ts`: `releasesModule`, its definition, whose two queries the host serves in each
project's Durable Object; `ReleasesGroup`, their routes, which the host adds to the public API;
and the Schemas both carry.

## Depends on

- `@cluenori/signals`: releases, operations by release, and errors.
- `@cluenori/incidents`: the incidents that opened while a release ran.
- `@cluenori/foundation`: `defineModule`.

## Decisions and constraints

- **Counted from October 2026.** Counts from before have no release, so the first comparison comes
  with a component's second release after that.
- **Incidents** are those the project keeps: the open ones and those resolved in the last 7 days.
- **Not handled:** a release deployed again after a later one stays where it first ran; and a
  component that reports no environment beside one that does counts both under one release.
- **A list compares at most 30 releases,** two operation tables and an error table each, read in
  the project's object.
