# @cluenori/signals

Signals from a project's services: OpenTelemetry exports read where they arrive, every export kept
in the archive for 90 days, and, in the project's Durable Object, their requests counted, their
warnings and errors kept and grouped, and any request's trace and logs read back from the archive.

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
const view = yield* signals.trace(detail.latest[0].trace, detail.latest[0].time)
// view.spans: the request's spans as a tree; view.logs: its logs at every level, from the archive

// One endpoint over time, with its percentiles in each step.
const series = yield* signals.requestsOverTime({ period, endpoint: EnvelopeName.make("GET /api/feed") }, "1h")
// points: [{ start, requests: 940, errors: 3, p50Ms: 85, p80Ms: 160, p95Ms: 420, p99Ms: 1210 }, ...]

// Warnings and errors over time, a series per level, component, or error group.
const counts = yield* signals.logCounts({ period, step: "1h", by: "error" })
// series: [{ key: "159dae307f199986", total: 41, points: [{ start, count: 3 }, ...] }, ...]
```

An export that isn't one fails with `OtlpInvalid`. When the archive can't take an export,
`record*` fails with `ArchiveUnavailable`, having stored nothing, and the exporter is told to send it
again. An unknown error ID fails with `ErrorGroupNotFound`.

## Owns

- **Rules:** what a request is (a server or consumer span), its endpoint and whether it failed; a
  log record's level; which records are indexed (warnings and up); which errors are the same error
  (exception type and the top five frames of the app's own code in its stack, those with a source
  location, and, when it was thrown outside that code, its message without numbers and IDs; or
  logger and message template); and how each question's period is cut to what is kept.
- **Data,** in each project's database:
  - requests counted by endpoint and environment, by the minute (`signals_minute_counts`, 14 days)
    and by the hour (`signals_hour_counts`, 15 months), each component's endpoints, at most 500
    (`signals_endpoints`);
  - warnings and errors (`signals_logs`, 90 days) and error groups (`signals_error_groups`, 15
    months after last seen);
  - which archive file holds each export, by time (`signals_archive`), and the last hour's export
    digests (`signals_batches`).
- **The archive's layout:** `<workspace>/<project>/<signal>/<day>/<component>/<digest>.otlp`, OTLP
  protobuf with secrets removed.

## Does not own

- **Which component sent an export:** `@cluenori/projects` checks its ingest key.
- **Where the archive's files live:** the host provides an `ArchiveStore`; in the Worker, an R2
  bucket whose lifecycle rule removes files after 90 days.
- **What people decide about an error** (resolved, ignored): the Errors module, when it comes.

## Contract

`src/index.ts`. `readTraces`, `readLogs` and `readMetrics` run where exports arrive; `Signals` runs
in the project's object; `SignalsGroup` is the API's part.

## Depends on

- `@bagatka/otlp`, to read and write exports; `@bagatka/quantile-sketch`, for percentiles;
  `@bagatka/scrub`, to remove secrets and personal data.
- `@cluenori/foundation`, for the scope keys and `Period`; `@cluenori/projects`, for the
  `ProjectNotFound` its API answers.

## Decisions and constraints

- **Everything is archived; views are derived.** Every export is kept 90 days, so a new view can be
  built from data that arrived before it. Records below warning are only in the archive.
- **Archived before recorded:** the archive file is written first, outside the transaction, then
  everything else in one transaction that checks again for a retry. A failure leaves at most a
  file no index points to, which the bucket's lifecycle removes.
- **Scrubbed before stored,** in the archive too (PATTERNS.md, "Credentials and personal data").
  Metrics are archived as received until Cluenori reads them.
- **Counts over time come from what is kept, in one indexed read.** A requests series merges the
  stored percentiles of each step's buckets; counts of warnings and errors group the 90-day index
  by step and by level, component, or error group, at most 100 series, the largest first.
- **A trace is read from its own files:** the archive's index keeps which files hold each trace's
  records, by the first 52 bits of its ID, so a trace is read from up to 60 of its files, the
  nearest to the time asked about first, however many other exports arrived then. A service that
  exports every few seconds would crowd a lookup by time. `trace` says how many of its files it read,
  and how many it didn't. Exports archived before the index (October 2026) aren't in it.
- **Counted once.** An export's SHA-256 digest is kept an hour, so an exporter's retry is skipped.
- **Percentiles are within 2% of the true value,** by nearest rank.
- **An answer's schemas live apart from the code that makes them** (`trace-view.ts` from
  `read-archived-trace.ts`, `request-queries.ts` from `request-store.ts`), and the package is
  side-effect free, so a client of the API, such as the dashboard, bundles the schemas alone.
- **Not yet:** scheduled jobs whose root spans are internal, errors from failed spans of services
  that send no logs, and the feature and release of each request.
