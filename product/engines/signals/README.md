# @cluenori/signals

Signals from a project's services and apps. Services' OpenTelemetry exports are read where they
arrive, every export kept in the archive for 90 days, and, in the project's Durable Object, their
operations counted by environment and release, the traces of the slowest and failed kept to open,
their warnings and errors kept and grouped, and any trace and its logs read back from the archive by
its ID (`Signals`). Apps' batches from their SDKs are archived 5 years and counted by person,
installation, day and release, with sessions and each person's timeline (`AppSignals`).

## Use it

```ts
// Where an export arrives (the Worker): remove secrets, write the archive file, pick out what is indexed.
const { export: logs, rejected } = yield* readLogs(body) // also readTraces, readMetrics
// rejected: { count, problem }, for the exporter's answer

// In the project's Durable Object: archive it, then record it, once.
const signals = yield* Signals
yield* signals.recordLogs(component, logs) // "recorded", or "duplicate" for an exporter's retry

const table = yield* signals.errors({ period })
// [{ id: "159dae307f199986", title: "TimeoutException: Notification service did not answer",
//    culprit: "Program.<>c.<<<Main>$>b__0_5>d.MoveNext()", occurrences: 3, ... }]
const detail = yield* signals.error(table.groups[0].id, { period }) // latest occurrences, with stacks
// Found whatever the period: a period without it answers occurrences: 0 and latest: [].
const line = yield* signals.logLine(detail.latest[0].id) // one occurrence by its ID, no period
const view = yield* signals.trace(detail.latest[0].trace, detail.latest[0].time) // the time is optional
// view.spans: the trace's spans as a tree; view.logs: its logs at every level, from the archive

// When it last ran, whatever the period, in any environment and release: a period without it says so.
const quiet = yield* signals.operations({ period, operation: EnvelopeName.make("POST /api/import") })
// rows: [], lastSeen: 2026-10-23T14:06:00Z

// Traces worth opening, though they logged nothing: one operation's slowest, and its failed.
const kept = yield* signals.keptTraces({ period, operation: EnvelopeName.make("GET /api/feed") })
// slowest: [{ trace: "26f47ed8…", start, durationMs: 1712, status: 200, failed: false, ... }, ...]

// One operation's load over time, with its percentiles in each step.
const series = yield* signals.loadOverTime({ period, operation: EnvelopeName.make("GET /api/feed") }, "1h")
// points: [{ start, count: 940, errors: 3, p50Ms: 85, p80Ms: 160, p95Ms: 420, p99Ms: 1210 }, ...]

// The releases that ran in a period, each with its whole span; and one release's operations.
const { rows } = yield* signals.releases({ period })
// [{ component: "notes-api", environment: "production", release: "2026.10.21-e91f09c", firstSeen, lastSeen }]
const before = yield* signals.operations({ period, release: rows[1].release })

// When each sparse operation ran, the minutes it ran in: a job's schedule shows in them.
const ran = yield* signals.minutesRan({ period }, 200) // busier operations are left out
// [{ operation: "cleanup.run", minutes: [10:00, 11:00, 12:00, ...] }]

// Warnings and errors as log messages: lines that are the same message, the most lines first.
const { messages } = yield* signals.logMessages({ period, search: "export" })
// [{ id: 12, level: "warn", title: "Export {ExportId} retried", category: "Notes.Exports", lines: 41, ... }]
const message = yield* signals.logMessage(messages[0].id, { period }) // whatever the period, with its errors
const its = yield* signals.logs({ period, message: messages[0].id }) // its lines, newest first

// Warnings and errors over time, a series per level, component, error group, or log message.
const counts = yield* signals.logCounts({ period, step: "1h", by: "error" })
// series: [{ key: "159dae307f199986", total: 41, points: [{ start, count: 3 }, ...] }, ...]
```

Apps' signals, in the project's Durable Object, for the component whose SDK key sent them:

```ts
const apps = yield* AppSignals
yield* apps.record({ component, key, country }, batch)
// { accepted: 312, duplicates: 0 }; the same batch again: { accepted: 0, duplicates: 312 }
// Past 20 batches a minute from one installation, or 1,200 from one key: TooManySignals { retryAfterSeconds: 45 }

const usage = yield* apps.usage({ period, component: ComponentKey.make("notes-ios") })
// days: [{ day: "2026-10-22", people: 812, weekPeople: 2390, monthPeople: 5105, sessions: 2210, ... }]
// A day before the app first sent anything isn't listed; a week reaching before it has no weekPeople.
const cohorts = yield* apps.retention({ period }) // [{ week: "2026-10-12", people: 140, active: [140, 61, 44] }]
const { releases } = yield* apps.releases({ period }) // each with `previous`, the release before it
const health = yield* apps.health(releases[0]) // launches cold and warm, memory, MetricKit's crashes and hangs
const { features } = yield* apps.features({ period }) // people, events, screens and memory by feature key
const share = yield* apps.feature({ feature: FeatureKey.make("notes.share") })
// one feature over everything kept: each day's people, events and screens, everyone, the 20 last
const served = yield* signals.featureOperations({ feature: FeatureKey.make("notes.share") })
// each day's operations its services named it in `cluenori.feature` for: [{ day, component, operation, count, errors }]
const person = yield* apps.person({ _tag: "ByUser", user: AppUserId.make("8c1f…") })
// How many `user.registered` arrived since an instant, every one so far, read through an index and
// stopped at 11.
const registered = yield* apps.eventCount({ since, component, event: EnvelopeName.make("user.registered") }, 11)
// installations, the days they were active, the features they used, and their latest 1,000
// signals; PersonNotFound otherwise
```

An export that isn't one fails with `OtlpInvalid`. When the archive can't take an export,
`record*` fails with `ArchiveUnavailable`, having stored nothing, and the exporter is told to send it
again. An error ID the project never had, or forgot 15 months after it was last seen, fails with
`ErrorGroupNotFound`; a log message, with `LogMessageNotFound`; a line older than 90 days, or one it
never had, with `LogLineNotFound`.

## Owns

- **Rules:** which spans an operation is counted from (a server or consumer span, or an internal
  span that starts its trace: a job the service started itself, such as a scheduled one), its
  name, whether it failed, its HTTP status, and its release (`service.version`, when it is a release
  version); which traces are kept to open (of each operation,
  environment and hour, the five slowest and the five slowest failed); a log record's level; which records are indexed
  (warnings and up); which errors are the same error (exception type and the top five frames of
  the app's own code in its stack, those with a source location, and, when it was thrown outside
  that code, its message without numbers and IDs; or logger and message template); which warnings
  and errors are the same log message (warning or error, logger, and template, or message without
  numbers, IDs and quoted text); and how each
  question's period is cut to what is kept.
- **Data,** in each project's database:
  - operations counted by name, environment and release (`''` unknown, as for every count from
    before October 2026), by the minute (`signals_minute_counts`, 14 days) and by the hour
    (`signals_hour_counts`, 15 months), each component's operations, at most 500, each with the
    end of the last minute it ran in (`signals_operations`). A question reads minutes for two
    days or less and hours beyond, unless its `buckets` chooses (`OperationQuery`);
  - each release's span, from the first minute it ran in to the end of the last
    (`signals_releases`, 15 months after last seen);
  - the traces kept to open from their operations (`signals_kept_traces`, 14 days);
  - operations by the feature their spans name in `cluenori.feature`, UTC day, component and
    environment (`signals_feature_days`, 15 months), at most 500 operations of a component, the
    rest as `(other operations)`;
  - warnings and errors, each with its release and the feature it names in `cluenori.feature`
    (`signals_logs`, 90 days), and error groups
    (`signals_error_groups`, 15 months after last seen), each with the release it was first and
    last seen in; and log messages, each line naming its own (`signals_log_messages`, 15 months
    after last seen);
  - which archive file holds each export, by time (`signals_archive`), and the last hour's export
    digests (`signals_batches`).
- **The archive's layout:** `<workspace>/<project>/<signal>/<day>/<component>/<digest>.otlp`, OTLP
  protobuf with secrets removed.
- **Apps' signals,** in each project's database (`signals_people`, `signals_person_users`,
  `signals_installations` and `signals_app_*`):
  - each person, Cluenori's ID for them, and the app's user IDs linked to them; each installation,
    with its person, release, device, SDK, country and when it was last seen;
  - by UTC day, release and feature, kept 15 months: who was active on which installation, with
    their sessions and foreground time; who used each feature, with its events and screens; launch
    times (cold and warm, to the first frame and to `appReady()`) and memory (peak and footprint)
    as quantile sketches, prewarmed launches only counted; MetricKit's diagnostics by kind and the
    release each names;
  - each person's first day in each component and environment, for retention; each release's span;
  - sessions, started and ended, with their foreground time (90 days);
  - each person's timeline, their latest 1,000 signals but memory (15 months);
    events in it are counted by name through a partial index (`eventCount`, for monitors), so a
    person past 1,000 signals counts only their latest; when each event last arrived is kept
    apart, so one trimmed still counts;
  - the IDs of the signals of the last 14 days, by their own time, so a batch sent again counts once.
- **Rules about people:** a user ID seen for the first time is linked to its installation's person
  when that person has none, so what they did before signing in stays theirs, or else to a new
  person; a signal without one is its installation's person's. The app's user ID is kept only in
  the link, never in a timeline or the archive.
- **The layout of apps' batches:** `<workspace>/<project>/<day>/<component>/<installation>/<first
  signal>.json`, the new signals of one batch, scrubbed, each with its person.

## Does not own

- **Which component sent an export:** `@cluenori/projects` checks its ingest key.
- **Where the archive's files live:** the host provides an `ArchiveStore`; in the Worker, an R2
  bucket whose lifecycle rule removes files after 90 days. Apps' batches likewise go to an
  `AppBatchStore`: in the Worker, a bucket of their own, kept 5 years.
- **Which component an app's batch is of:** `@cluenori/projects` checks its SDK key.
- **What a release's app health means** (better, worse): the Analytics module, which compares
  releases with these measures.
- **What people decide about an error** (resolved, ignored): the Errors module, when it comes.

## Contract

`src/index.ts`. `readTraces`, `readLogs` and `readMetrics` run where exports arrive; `Signals` and
`AppSignals` run in the project's object; `SignalsGroup` is the API's part, and `AppIngestGroup`
the ingest API's, which apps' SDKs call with an SDK key (`AppBatch` is its wire contract).

## Depends on

- `@bagatka/otlp-protobuf`, to read and write exports of traces and logs; metrics exports are
  checked only by their framing, here (`src/metrics-framing.ts`), until Cluenori reads them; `@bagatka/quantile-sketch`, for percentiles, every sketch at its default accuracy, 2%;
  `@bagatka/scrub`, to remove secrets and personal data, Cluenori's own keys by their prefix,
  `cluenori.`.
- `@cluenori/foundation`, for the scope keys and `Period`; `@cluenori/projects`, for the
  `ProjectNotFound` its API answers.

## Decisions and constraints

- **Receiving telemetry is never traced.** A request to a route that takes telemetry
  (`telemetryRouteOf`: `/otlp/v1/*`, `/ingest/v1/app/batch`) is handled untraced, whoever sent it
  (`telemetryUntraced`, `telemetryUntracedServer`, which the host installs), so N signals in never
  make N out: the only telemetry receiving makes is a count per route and status, sent at most once
  a minute (`SelfTelemetry.countIngest`). `SelfTelemetry` records the deployment's own real work,
  bounded (`selfTelemetryLimits`: 2,000 spans and 500 log records wait at most; past it, new ones
  are dropped and counted), and the host flushes it at the end of each request, alarm or batch with
  `cluenori-telemetry: self` and `cluenori.self = true` on its resource, so the archive says so too
  (`docs/self-telemetry.md`).
- **A trace's origin is the client that asked.** Requests whose baggage names
  `cluenori.origin.component` (Cluenori's SDKs add it) are counted by that origin, operation,
  environment and hour (`signals_origin_hours`, 15 months), and `origins` splits an operation's
  runs by it. Baggage is the caller's word, so an origin counts only when it is a component that
  reported to the project itself (as a service or an app, with a key); any other, invented or not
  reported yet, is with the requests that named none, the rest of the operation's count.
- **Apps' newer kinds are kept where a view needs them:** `screen.ready`, `screen.left`, `app.hang`
  and `timing` are tallied by screen or timing name, UTC day and release
  (`signals_app_subject_measures`, 15 months), which `screens` reads: each screen's visits, its
  readiness from the device's copy and from the network, its CPU, hitches and hangs, and each
  timing's spread. An `error` is also a log line and an error group of its component, `error` when
  handled and `fatal` when not, with its feature and screen, so the errors pages show apps' errors
  beside services'; one nothing handled is also a crash of its batch's release, in app health
  beside MetricKit's.
- **Everything is archived; views are derived.** Every export is kept 90 days, so a new view can be
  built from data that arrived before it. Records below warning are only in the archive.
- **Every archive can be read back.** The OTLP reader allows one span, record or value for each 16
  bytes, and scrubbing shortens text, so `readTraces` and `readLogs` read the scrubbed archive once
  more and refuse an export whose archive fails (`OtlpInvalid`), rather than keep one no view can
  open.
- **Archived before recorded:** the archive file is written first, outside the transaction, then
  everything else in one transaction that checks again for a retry. A failure leaves at most a
  file no index points to, which the bucket's lifecycle removes.
- **Scrubbed before stored,** in the archive too (PATTERNS.md, "Credentials and personal data").
  Metrics are archived as received until Cluenori reads them.
- **Counts over time come from what is kept, in one indexed read.** A series of the load merges the
  stored percentiles of each step's buckets; counts of warnings and errors group the 90-day index
  by step and by level, component, or error group, at most 100 series, the largest first.
- **A trace is read from its own files:** the archive's index keeps which files hold each trace's
  records, by the first 52 bits of its ID, so a trace is found by its ID alone and read from up to
  60 of its files, the nearest to the time asked about first, or the newest, however many other
  exports arrived then. A service that exports every few seconds would crowd a lookup by time.
  `trace` says how many of its files it read, and how many it didn't. Exports archived before the
  index (October 2026) aren't in it.
- **Counted once.** An export's SHA-256 digest is kept an hour, so an exporter's retry is skipped.
- **Kept traces are bounded where they arrive and where they are kept.** Ingest picks each
  export's five slowest and five slowest failed of each operation, environment and hour; the object
  keeps them against those it kept before, so each holds at most ten rows however busy it is. The
  slowest of a period are the slowest of these, so a period's list is exact unless one hour had more
  than five of its slowest twenty. Their traces stay in the archive 90 days, beyond the 14 days.
- **Percentiles are within 2% of the true value,** by nearest rank.
- **An answer's schemas live apart from the code that makes them** (`trace-view.ts` from
  `read-archived-trace.ts`, `operation-queries.ts` from `operation-store.ts`), and the package is
  side-effect free, so a client of the API, such as the dashboard, bundles the schemas alone.
- **Apps' batches are archived 5 years, apart from exports** (October 2026). They are the product
  events, which `concept/Platform.md` keeps 5 years, while exports are diagnostic evidence kept 90
  days; a bucket of their own lets each keep its rule. Only a batch's new signals are archived,
  before they are counted, as exports are; what is counted by day is kept 15 months, as hourly
  counts are, and older questions will read the lake built from the batches.
- **Exact counts of people, bounded by kept rows.** Daily, weekly and monthly people are counted
  exactly from one row per installation, person, release and day, and each day's week and month are
  counted over those rows in SQL: about 30 days of rows read per day asked. A project with 10,000
  people a day keeps about 4 million such rows a year.
- **Timelines are bounded per person:** the latest 1,000 signals each, about 150 KB; a project with
  10,000 people keeps up to 1.5 GB of them.
- **Limits are kept in the object's memory:** fixed minutes, only the current one, so they cost
  nothing to store and reset when the object restarts. 1,200 batches a minute from one key, about
  20 a second, is what one object writes comfortably; an installation's SDK sends every 30 seconds
  or so, far below 20 a minute.
- **A device's clock is corrected by the batch's `sentAt`** when it is more than a minute off;
  signals recorded offline keep their order and spacing.
- **Not handled:** a signal sent again more than 14 days after its own time counts again; an
  anonymous person's history before they signed in on a second installation stays a person of its
  own; and sending a batch while another of the same new person is being archived may archive it
  under a person ID the database doesn't have.
- **A service names a feature** in the `cluenori.feature` attribute of a span or log record, as
  the Cluenori helpers copy it from the app's baggage; a key that isn't a feature key is ignored.
  It is matched exactly, as apps mark it.
- **Not handled:** a project whose services name thousands of features keeps a row a day for each
  of their operations; nothing bounds how many features there are.
- **Not yet:** errors from failed spans of services that send no logs, and the release of each
  operation's feature count.
