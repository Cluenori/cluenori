# @cluenori/analytics

How a project's apps are used and how healthy each release is, from what their SDKs send: daily,
weekly and monthly people, sessions, weekly retention, each release's launches, memory, crashes and
hangs beside the release before it, features, each feature's story, and what one person did.

## Use it

Through the public API, for a member who sees the project:

```ts
const client = yield* HttpApiClient.make(CluenoriApi, { baseUrl })
const lastMonth = { from: DateTime.subtract(now, { days: 30 }), to: now }

const usage = yield* client.analytics.usage({ params: { project }, query: { ...lastMonth, component: ios } })
// days: [{ day: "2026-10-22", people: 812, weekPeople: 2390, monthPeople: 5105, sessions: 2210, ... }]
// sessionsPerPerson: 9.4; releases: [{ release: "0.3.0+20", people: 4980, ... }, ...]
// A day before the app first sent anything isn't listed; a week that reaches before it has no
// weekPeople: unknown, never 0.

const { cohorts } = yield* client.analytics.retention({ params: { project }, query: lastMonth })
// [{ week: "2026-10-12", people: 140, active: [140, 61, 44] }, ...]

const { releases } = yield* client.analytics.appHealth({ params: { project }, query: lastMonth })
// [{ release: { release: "0.3.0+20", previous: "0.2.0+10", ... }, verdict: "worse",
//    worse: ["coldLaunch", "crashes"], crashesPerThousand: 32, previousCrashesPerThousand: 4,
//    health: { cold: { launches: 60, firstFrameP95Ms: 1400, ... }, memory, diagnostics, ... } }]

const { features } = yield* client.analytics.featureUse({ params: { project }, query: lastMonth })
// [{ people: 812, events: 0, screens: 940 }, // "(no feature)"
//  { feature: "cards.flip", people: 410, events: 3022, screens: 980, memory: { peakP95Bytes, ... } }]

const story = yield* client.analytics.feature({ params: { project, feature: share }, query: {} })
// { feature: "notes.share", asOf, use: { days: [{ day, people, events, screens }], people: 61,
//   latestPeople: [{ person, users, days, events, lastDay }], releases, memory },
//   logs: { covered, days: [{ day, warnings, errors }], errors: [ErrorGroup, ...] },
//   operations: [{ day, component: "notes-api", operation: "POST /api/notes/{id}/share", count, errors }] }
// With no period: everything kept of it. A part nothing named the feature in is empty; a feature
// nothing kept names fails with FeatureNotFound (404).

const person = yield* client.analytics.personByUser({ params: { project }, query: { user } })
// { person, users: [user], installations: [...], days: [{ day, sessions }],
//   features: [{ feature: "notes.share", days, events, screens, lastDay }], timeline: [...] }
// A user ID the apps never sent fails with PersonNotFound (404).
```

## Owns

- **Rules:** what makes a release's app health worse or better than the release before it's
  (`src/health-verdict.ts`): a launch kind's p95 to the first frame at least 1.5 times and 100 ms
  more, as an operation's "slower", with 50 launches in both; peak memory's p95 1.25 times and 50 MB
  more, with 50 measurements in both; crashes or hangs at least 5, twice the rate and 2 per 1,000
  sessions more, with 200 sessions and MetricKit's reports in both. Too early until it ran an hour
  and a measure compares; `first` without a release before it.
- **A feature's story** (`src/feature-story.ts`): how the apps used it and what its services sent
  for it, asked together, and when nothing names it.
- **Data:** none. It reads the apps' signals and the services' counts and logs Signals keeps.

## Does not own

- **What is counted, and how:** `@cluenori/signals` (`AppSignals`) counts people, sessions,
  launches, memory and MetricKit's diagnostics, and keeps timelines; `Signals` counts the
  operations, warnings and errors services name a feature in `cluenori.feature`; this module asks
  them.
- **Which release a version must update from:** the Releases module's version policy.

## Contract

`src/index.ts`. The host serves `analyticsModule`'s queries in each project's Durable Object and
`AnalyticsGroup`'s routes in the public API; `ReleaseHealth` and its verdict are this module's
answer, and the rules behind them are exported for clients that explain them.

## Depends on

`@cluenori/signals` for the apps' signals and their Schemas, `@cluenori/projects` for the
`ProjectNotFound` its routes answer, `@cluenori/foundation` for the module contract.

## Decisions and constraints

- **A release is judged over everything kept of it,** as the Releases module judges operations: its
  whole span, not the period asked, beside the release before it of the same component and
  environment, first seen latest before it.
- **Its verdict uses a release's words, not its schema** (`HealthVerdict`, with the same values as
  Releases' `Verdict`): modules don't import each other.
- **A feature joins the apps and the services by its key alone,** exactly: apps mark it on their
  signals, services name it in `cluenori.feature`. A feature only the apps mark is a whole story
  without its services' part, so analytics stand on product events alone.
- **A feature's story has no period:** it covers everything kept of it, 15 months of use and
  operations and 90 days of logs, so its page tells its whole life; deep questions go to agents
  through the API and the CLI (`./cluenori feature`).
- **Unknown stays unknown:** a measure a release didn't send, crashes before MetricKit reported of
  it, and rates without sessions are absent, never zero.
