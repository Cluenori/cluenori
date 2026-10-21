import type { ComponentKey, TraceId } from "@cluenori/foundation"
import { Period } from "@cluenori/foundation"
import { Context, DateTime, Duration, Effect, Layer, Option, Ref, Schema } from "effect"
import type { SqlError } from "effect/sql"
import { SqlClient, SqlSchema } from "effect/sql"

import type { ArchiveSettings } from "./archive-index.ts"
import { archiveIndex, archiveRetention } from "./archive-index.ts"
import type { ArchiveUnavailable } from "./archive-store.ts"
import { ArchiveStore } from "./archive-store.ts"
import type {
  ErrorDetail,
  ErrorGroupNotFound,
  ErrorQuery,
  ErrorTable,
  LogCountQuery,
  LogCounts,
  LogPage,
  LogQuery,
} from "./error-groups.ts"
import type { ExportSignal, LogExport, MetricsExport, TraceExport } from "./exports.ts"
import type { ErrorGroupId } from "./log-entry.ts"
import { logStore } from "./log-store.ts"
import { traceViewOf } from "./read-archived-trace.ts"
import { BatchDigest } from "./request-counts.ts"
import type { EndpointTable, KeptRequests, RequestQuery, RequestSeries, SeriesStep } from "./request-queries.ts"
import { requestStore } from "./request-store.ts"
import { migrateSignals } from "./signals-migrations.ts"
import type { TraceView } from "./trace-view.ts"

// An exporter retries a failed export within seconds; an hour of digests catches every retry.
const batchWindow = Duration.hours(1)

// Old data is removed while recording, at most this often.
const cleanupInterval = Duration.minutes(10)

// A trace is read from at most this many of its archive files, the nearest to the time it is asked
// about first, or the newest.
const traceFiles = 60

/** Whose signals these are. */
export type SignalsSettings = ArchiveSettings

/**
 * The signals of one project: its requests, warnings and errors, and every export in the archive,
 * and the questions asked of them. Runs inside the Durable Object that holds the project's database.
 */
export class Signals extends Context.Service<
  Signals,
  {
    /**
     * Archives a trace export, adds its requests to the counts of `component`, and keeps those of
     * its requests that are now among the slowest or the slowest failed of their endpoint and hour,
     * once: an export whose digest arrived in the last hour, an exporter's retry, is skipped. Fails
     * with `ArchiveUnavailable` when it can't be archived, having counted nothing, so the exporter
     * should send it again.
     */
    readonly recordTraces: (
      component: ComponentKey,
      exported: TraceExport,
    ) => Effect.Effect<"recorded" | "duplicate", ArchiveUnavailable>
    /** Archives a log export and keeps its warnings and errors, once, as `recordTraces` does. */
    readonly recordLogs: (
      component: ComponentKey,
      exported: LogExport,
    ) => Effect.Effect<"recorded" | "duplicate", ArchiveUnavailable>
    /** Archives a metrics export, once, as `recordTraces` does. */
    readonly recordMetrics: (
      component: ComponentKey,
      exported: MetricsExport,
    ) => Effect.Effect<"recorded" | "duplicate", ArchiveUnavailable>
    /**
     * Every endpoint's requests in the query's period, most requested first: by the minute for two
     * days or less, by the hour beyond. Reads only.
     */
    readonly endpoints: (query: RequestQuery) => Effect.Effect<EndpointTable>
    /**
     * Requests and errors over the query's period, one point per step that has requests. A step
     * finer than the counts' buckets (by the hour past two days) is widened to them; the answer
     * says which step it used. Reads only.
     */
    readonly requestsOverTime: (query: RequestQuery, step: SeriesStep) => Effect.Effect<RequestSeries>
    /**
     * Requests worth opening in the query's period: the slowest, slowest first, and the failed,
     * newest first, at most 20 of each, from those kept of each endpoint, environment and hour (the
     * five slowest and the five slowest failed, 14 days). Reads only.
     */
    readonly keptRequests: (query: RequestQuery) => Effect.Effect<KeptRequests>
    /** The errors of the query's period, most frequent first. Reads only. */
    readonly errors: (query: ErrorQuery) => Effect.Effect<ErrorTable>
    /** One error and its latest occurrences in the query's period. Reads only. */
    readonly error: (id: ErrorGroupId, query: ErrorQuery) => Effect.Effect<ErrorDetail, ErrorGroupNotFound>
    /** A page of warnings and errors, newest first. Reads only. */
    readonly logs: (query: LogQuery) => Effect.Effect<LogPage>
    /**
     * Warnings and errors counted over time, a series by level, component, or error group: one
     * indexed read of the period's warnings and errors. Kept 90 days.
     */
    readonly logCounts: (query: LogCountQuery) => Effect.Effect<LogCounts>
    /**
     * Trace `trace` from the archive: its spans and its logs at every level, from every component,
     * read from the archive files that hold its records, found by its ID: up to 60 of them, the
     * nearest to `around` first, or the newest without it. Fails with `ArchiveUnavailable` when the
     * archive can't be read.
     */
    readonly trace: (trace: TraceId, around?: DateTime.Utc) => Effect.Effect<TraceView, ArchiveUnavailable>
  }
>()("@cluenori/signals/signals") {
  /** Builds the engine on the object's database and the archive, first creating or updating its tables. */
  static readonly layer = (settings: SignalsSettings) =>
    Layer.effect(
      Signals,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const archive = yield* ArchiveStore
        yield* migrateSignals.pipe(Effect.orDie)
        const requests = yield* requestStore
        const logs = yield* logStore
        const index = yield* archiveIndex(settings)
        const lastCleanup = yield* Ref.make(0)

        const findBatch = SqlSchema.findOneOption({
          Request: BatchDigest,
          Result: Schema.Struct({ digest: BatchDigest }),
          execute: (digest) => sql`SELECT digest FROM signals_batches WHERE digest = ${digest}`,
        })

        const cleanUp = Effect.fn("Signals.cleanUp")(function* (now: number) {
          const last = yield* Ref.get(lastCleanup)
          if (now - last < Duration.toMillis(cleanupInterval)) {
            return
          }
          yield* requests.cleanUp(now)
          yield* logs.cleanUp(now)
          yield* index.cleanUp(now)
          yield* sql`DELETE FROM signals_batches WHERE received_at < ${now - Duration.toMillis(batchWindow)}`
          yield* Ref.set(lastCleanup, now)
        })

        type Archived = {
          readonly digest: BatchDigest
          readonly archive: Uint8Array
          readonly from: DateTime.Utc
          readonly to: DateTime.Utc
        }

        // Inside the transaction: checks again for a retry that arrived meanwhile, then writes.
        const commitExport = Effect.fn("Signals.commitExport")(function* (
          signal: ExportSignal,
          component: ComponentKey,
          exported: Archived,
          key: string,
          now: number,
          traces: ReadonlyArray<TraceId>,
          write: Effect.Effect<void, SqlError.SqlError | Schema.SchemaError>,
        ) {
          const again = yield* findBatch(exported.digest)
          if (Option.isSome(again)) {
            return "duplicate" as const
          }
          yield* sql`INSERT INTO signals_batches ${sql.insert({ digest: exported.digest, received_at: now })}`
          yield* write
          yield* index.add(signal, component, exported, key, now, traces)
          yield* cleanUp(now)
          return "recorded" as const
        })

        // Archives first, outside the transaction, which holds only SQL; then writes everything else
        // in one transaction.
        const store = Effect.fn("Signals.store")(function* (
          signal: ExportSignal,
          component: ComponentKey,
          exported: Archived,
          traces: ReadonlyArray<TraceId>,
          write: Effect.Effect<void, SqlError.SqlError | Schema.SchemaError>,
        ) {
          const seen = yield* findBatch(exported.digest).pipe(Effect.orDie)
          if (Option.isSome(seen)) {
            return "duplicate" as const
          }
          const current = yield* DateTime.now
          const now = DateTime.toEpochMillis(current)
          const key = index.keyOf(signal, component, exported.digest, now)
          yield* archive.put(key, exported.archive)
          return yield* sql
            .withTransaction(commitExport(signal, component, exported, key, now, traces, write))
            .pipe(Effect.orDie)
        })

        const recordTraces = Effect.fn("Signals.recordTraces")(function* (
          component: ComponentKey,
          exported: TraceExport,
        ) {
          return yield* store(
            "traces",
            component,
            exported,
            exported.traces,
            requests.add(component, exported.counts, exported.kept),
          )
        })

        const recordLogs = Effect.fn("Signals.recordLogs")(function* (component: ComponentKey, exported: LogExport) {
          return yield* store(
            "logs",
            component,
            exported,
            exported.traces,
            logs.add(component, exported.entries, exported.errors),
          )
        })

        const recordMetrics = Effect.fn("Signals.recordMetrics")(function* (
          component: ComponentKey,
          exported: MetricsExport,
        ) {
          return yield* store("metrics", component, exported, [], Effect.void)
        })

        const nowMillis = DateTime.now.pipe(Effect.map(DateTime.toEpochMillis))

        const errors = Effect.fn("Signals.errors")(function* (query: ErrorQuery) {
          const now = yield* nowMillis
          return yield* logs.errors(query, now)
        })

        const error = Effect.fn("Signals.error")(function* (id: ErrorGroupId, query: ErrorQuery) {
          const now = yield* nowMillis
          return yield* logs.error(id, query, now)
        })

        const searchLogs = Effect.fn("Signals.logs")(function* (query: LogQuery) {
          const now = yield* nowMillis
          return yield* logs.logs(query, now)
        })

        const logCounts = Effect.fn("Signals.logCounts")(function* (query: LogCountQuery) {
          const now = yield* nowMillis
          return yield* logs.logCounts(query, now)
        })

        const trace = Effect.fn("Signals.trace")(function* (traceId: TraceId, around?: DateTime.Utc) {
          const found = yield* index.ofTrace(
            traceId,
            around === undefined ? undefined : DateTime.toEpochMillis(around),
            traceFiles,
          )
          const read = yield* Effect.forEach(
            found.files,
            (file) => archive.get(file.key).pipe(Effect.map(Option.map((bytes) => ({ ...file, bytes })))),
            { concurrency: 8 },
          )
          const files = read.flatMap((file) => (Option.isSome(file) ? [file.value] : []))
          // The index holds every trace the archive keeps, so without files of this one, all of it was searched.
          const now = yield* nowMillis
          const searched =
            found.span === undefined
              ? new Period({
                  from: DateTime.makeUnsafe(now - Duration.toMillis(archiveRetention)),
                  to: DateTime.makeUnsafe(now),
                })
              : // A period ends before its `to`, so it ends a millisecond after the last record.
                new Period({ from: DateTime.makeUnsafe(found.span.from), to: DateTime.makeUnsafe(found.span.to + 1) })
          return yield* traceViewOf(traceId, searched, files, found.total - files.length)
        })

        return Signals.of({
          recordTraces,
          recordLogs,
          recordMetrics,
          endpoints: requests.endpoints,
          requestsOverTime: requests.requestsOverTime,
          keptRequests: requests.keptRequests,
          errors,
          error,
          logs: searchLogs,
          logCounts,
          trace,
        })
      }),
    )
}
