import { ComponentKey } from "@cluenori/foundation"
import type { ProjectKey, TraceId, WorkspaceKey } from "@cluenori/foundation"
import { DateTime, Duration, Effect, Schema } from "effect"
import { SqlClient, SqlSchema } from "effect/sql"

import { ExportSignal } from "./exports.ts"

/** How long the archive keeps every export: the bucket's lifecycle rule removes older files. */
export const archiveRetention = Duration.days(90)

/** Whose archive files these are: they are kept under `<workspace>/<project>/`. */
export interface ArchiveSettings {
  readonly workspace: WorkspaceKey
  readonly project: ProjectKey
}

const FileRow = Schema.Struct({ signal: ExportSignal, component: ComponentKey, key: Schema.String })

const TraceFiles = Schema.Struct({
  files: Schema.Int,
  from: Schema.NullOr(Schema.Int),
  to: Schema.NullOr(Schema.Int),
})

// A trace as the index keeps it: the first 52 bits of its ID, which a number holds exactly.
const traceKeyOf = (trace: TraceId) => Number.parseInt(trace.slice(0, 13), 16)

/**
 * Which archive file holds each export of the project, and the time its records span, and which
 * files hold each trace's records, so a trace's files are found without listing the bucket or
 * reading others. Part of Signals.
 */
export const archiveIndex = (settings: ArchiveSettings) => {
  /** Where an export is archived: by project, kind, the day it arrived, component, and digest. */
  const keyOf = (signal: ExportSignal, component: ComponentKey, digest: string, now: number) =>
    [
      settings.workspace,
      settings.project,
      signal,
      DateTime.formatIso(DateTime.makeUnsafe(now)).slice(0, 10),
      component,
      `${digest}.otlp`,
    ].join("/")

  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    /** Adds an export's file, and which traces it holds records of. Runs inside the caller's transaction. */
    const add = Effect.fn("ArchiveIndex.add")(function* (
      signal: ExportSignal,
      component: ComponentKey,
      span: { readonly from: DateTime.Utc; readonly to: DateTime.Utc },
      key: string,
      now: number,
      traces: ReadonlyArray<TraceId>,
    ) {
      yield* sql`
        INSERT INTO signals_archive ${sql.insert({
          signal,
          component,
          from_time: DateTime.toEpochMillis(span.from),
          to_time: DateTime.toEpochMillis(span.to),
          key,
          received_at: now,
        })}
        ON CONFLICT (key) DO NOTHING`
      if (traces.length === 0) {
        return
      }
      const [file] = yield* sql<{ readonly id: number }>`SELECT id FROM signals_archive WHERE key = ${key}`
      if (file === undefined) {
        return yield* Effect.die(`The archive's index lost the file it just added, ${key}.`)
      }
      for (const trace of traces) {
        yield* sql`
          INSERT INTO signals_trace_files ${sql.insert({ trace: traceKeyOf(trace), file: file.id })}
          ON CONFLICT DO NOTHING`
      }
    })

    /**
     * The files holding records of `trace`, nearest to `around` first: at most `limit`; how many
     * there are; and when their records start and end, absent when none is kept.
     */
    const ofTrace = Effect.fn("ArchiveIndex.ofTrace")(function* (trace: TraceId, around: number, limit: number) {
      const key = traceKeyOf(trace)
      const files = yield* SqlSchema.findAll({
        Request: Schema.Void,
        Result: FileRow,
        execute: () => sql`
          SELECT a.signal, a.component, a.key
          FROM signals_trace_files t JOIN signals_archive a ON a.id = t.file
          WHERE t.trace = ${key}
          ORDER BY abs((a.from_time + a.to_time) / 2 - ${around})
          LIMIT ${limit}`,
      })(undefined)
      const summary = yield* SqlSchema.findOne({
        Request: Schema.Void,
        Result: TraceFiles,
        execute: () => sql`
          SELECT count(*) AS files, min(a.from_time) AS "from", max(a.to_time) AS "to"
          FROM signals_trace_files t JOIN signals_archive a ON a.id = t.file
          WHERE t.trace = ${key}`,
      })(undefined)
      const { from, to } = summary
      return {
        files,
        total: summary.files,
        span: from === null || to === null ? undefined : { from, to },
      }
    }, Effect.orDie)

    // Forgets files older than the bucket keeps.
    const cleanUp = Effect.fn("ArchiveIndex.cleanUp")(function* (now: number) {
      const before = now - Duration.toMillis(archiveRetention)
      yield* sql`DELETE FROM signals_trace_files WHERE file IN (SELECT id FROM signals_archive WHERE received_at < ${before})`
      yield* sql`DELETE FROM signals_archive WHERE received_at < ${before}`
    })

    return { add, cleanUp, keyOf, ofTrace }
  })
}
