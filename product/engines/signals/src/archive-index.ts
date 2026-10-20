import { ComponentKey } from "@cluenori/foundation"
import type { ProjectKey, WorkspaceKey } from "@cluenori/foundation"
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

/**
 * Which archive file holds each export of the project, by the time its records span, so the files
 * of a moment are found without listing the bucket. Part of Signals.
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

    const add = Effect.fn("ArchiveIndex.add")(function* (
      signal: ExportSignal,
      component: ComponentKey,
      span: { readonly from: DateTime.Utc; readonly to: DateTime.Utc },
      key: string,
      now: number,
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
    })

    /** The files whose records overlap [from, to), nearest to its middle first: at most `limit`, and how many overlap. */
    const around = Effect.fn("ArchiveIndex.around")(function* (
      signals: ReadonlyArray<ExportSignal>,
      from: number,
      to: number,
      limit: number,
    ) {
      const middle = Math.floor((from + to) / 2)
      const files = yield* SqlSchema.findAll({
        Request: Schema.Void,
        Result: FileRow,
        execute: () => sql`
          SELECT signal, component, key FROM signals_archive
          WHERE from_time < ${to} AND to_time >= ${from} AND signal IN ${sql.in(signals)}
          ORDER BY abs((from_time + to_time) / 2 - ${middle})
          LIMIT ${limit}`,
      })(undefined)
      const [counted] = yield* sql<{
        readonly files: number
      }>`SELECT count(*) AS files FROM signals_archive WHERE from_time < ${to} AND to_time >= ${from} AND signal IN ${sql.in(signals)}`
      return { files, overlapping: counted?.files ?? files.length }
    }, Effect.orDie)

    // Forgets files older than the bucket keeps.
    const cleanUp = Effect.fn("ArchiveIndex.cleanUp")(function* (now: number) {
      yield* sql`DELETE FROM signals_archive WHERE received_at < ${now - Duration.toMillis(archiveRetention)}`
    })

    return { add, around, cleanUp, keyOf }
  })
}
