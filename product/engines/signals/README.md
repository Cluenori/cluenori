# @cluenori/signals

Signals from a project's services, starting with requests: read from OpenTelemetry trace exports
where they arrive, counted in the project's Durable Object by the minute and by the hour, and asked
about by endpoint and over time.

## Use it

```ts
// Where an export arrives (the Worker): read and add up its requests.
const { batch, rejected } = yield* readRequests(body)
// rejected: { count: 2, problem: "A request ends before it starts" }, for the exporter's answer

// In the project's Durable Object: count them, once.
const signals = yield* Signals
yield* signals.record(component, batch) // "recorded", or "duplicate" for an exporter's retry

const table = yield* signals.endpoints({ period, environment: EnvironmentKey.make("prod") })
// table.rows: [{ endpoint: "GET /api/notes/{id}", requests: 15, errors: 0, averageMs: 2.1,
//   p50Ms: 0.05, p80Ms: 0.06, p95Ms: 31.0, p99Ms: 31.0, ... }, ...]
// table.covered: the part of the period the counts answer for; table.dataUntil: the newest data
```

An export that isn't one fails with `OtlpInvalid`. A request older than the 14 days requests are
kept, or more than an hour in the future, is refused and counted in `rejected`; the rest of the
export is counted.

## Owns

- **Rules:** what a request is (a server or consumer span), its endpoint (the span's name), whether
  it failed (an error status), and its environment (`deployment.environment.name`, or the older
  `deployment.environment`, lowercase).
- **Data:** in each project's database, requests counted by endpoint and environment, with a
  quantile sketch of their durations, by the minute (`signals_minute_counts`, 14 days) and by the
  hour (`signals_hour_counts`, 15 months); each component's endpoints, at most 500, the rest
  counted as `(other endpoints)` (`signals_endpoints`); and the digests of the last hour's exports
  (`signals_batches`).
- **Rules:** which counts answer a question: by the minute for two days or less, by the hour
  beyond, and a series step never finer than those buckets.

## Does not own

- **Which component sent an export:** `@cluenori/projects` checks its ingest key.
- **Logs, kept traces, errors, and product events:** they come with the slices that need them.

## Contract

`src/index.ts`. `readRequests` runs where exports arrive; `Signals` runs in the project's object;
`SignalsGroup` is the API's part: the endpoint table and requests over time.

## Depends on

- `@bagatka/otlp`, to read exports; `@bagatka/quantile-sketch`, for the percentiles.
- `@cluenori/foundation`, for the scope keys and `Period`; `@cluenori/projects`, for the
  `ProjectNotFound` its API answers.

## Decisions and constraints

- **Added up where an export arrives,** so the project's object, its one writer, only adds totals:
  one row write per endpoint, environment, and minute in an export, and one per hour.
- **Hours are written with minutes, not rolled up later,** so both always agree and late data needs
  no handling. It doubles the writes; rolling up in an alarm would halve them, if volume ever asks.
- **Counted once.** An export's SHA-256 digest is kept an hour, so an exporter's retry of the same
  batch is skipped.
- **Percentiles are within 2% of the true value,** by nearest rank, merged across buckets.
- **Old data goes while recording:** at most every ten minutes, minutes older than 14 days, hours
  older than 15 months, and digests older than an hour are removed.
- **Not yet:** scheduled jobs whose root spans are internal, and the feature and release of each
  request.
