import { Effect, Option, Schema } from "effect"
import type { SqlClient } from "effect/sql"
import { SqlSchema } from "effect/sql"

import type { ArchiveSettings } from "./archive-index.ts"
import type { ArchiveUnavailable } from "./archive-store.ts"

/** The stores whose files a reset deletes in the background, each the purge of one bucket. */
export type PurgedStore = "archive" | "app-batches"

// Each run of a purge lists and deletes at most this many pages of a store's files, 1,000 each.
const pagesPerRun = 5

const Marker = Schema.Struct({ before: Schema.Int, after: Schema.NullOr(Schema.String) })

/**
 * Marks `store`'s files of the project stored before `before` (Unix ms) to be deleted, from the
 * start of the listing: a purge under way for an earlier reset starts over with the later time.
 */
const markPurge = (sql: SqlClient.SqlClient, store: PurgedStore, before: number) =>
  sql`INSERT INTO signals_purges ${sql.insert({ store, before, after: null })}
    ON CONFLICT (store) DO UPDATE SET before = excluded.before, after = NULL`

/**
 * Deletes every row of `tables`, and marks `store`'s files stored before `before` (Unix ms) to be
 * deleted, in one transaction: a reset's part in one of the engine's services.
 */
export const resetTables = (
  sql: SqlClient.SqlClient,
  tables: ReadonlyArray<string>,
  store: PurgedStore,
  before: number,
) =>
  sql
    .withTransaction(
      Effect.forEach(tables, (table) => sql`DELETE FROM ${sql(table)}`, { discard: true }).pipe(
        Effect.andThen(markPurge(sql, store, before)),
      ),
    )
    .pipe(Effect.orDie)

/**
 * Goes on with `store`'s purge, if one is marked: a few pages of the project's files, by key, each
 * page's files stored before the reset deleted with `deleteBefore`, and the place reached kept, so
 * the next run goes on from there; the mark goes once the listing ends. Files stored since stay:
 * the project keeps writing under the same keys. A reset meanwhile, which moves the mark, is left
 * to its own purge. Fails with `ArchiveUnavailable` when the store can't be reached, the mark kept.
 */
export const purgeFiles = (
  sql: SqlClient.SqlClient,
  store: PurgedStore,
  settings: ArchiveSettings,
  deleteBefore: (
    prefix: string,
    before: number,
    after: string | undefined,
  ) => Effect.Effect<Option.Option<string>, ArchiveUnavailable>,
) =>
  Effect.gen(function* () {
    const marker = yield* SqlSchema.findOneOption({
      Request: Schema.Void,
      Result: Marker,
      execute: () => sql`SELECT before, after FROM signals_purges WHERE store = ${store}`,
    })(undefined).pipe(Effect.orDie)
    if (Option.isNone(marker)) {
      return
    }
    const { before } = marker.value
    const prefix = `${settings.workspace}/${settings.project}/`
    let after = marker.value.after ?? undefined
    for (let page = 0; page < pagesPerRun; page++) {
      const next = yield* deleteBefore(prefix, before, after)
      if (Option.isNone(next)) {
        yield* sql`DELETE FROM signals_purges WHERE store = ${store} AND before = ${before}`.pipe(Effect.orDie)
        return
      }
      after = next.value
      yield* sql`UPDATE signals_purges SET after = ${after} WHERE store = ${store} AND before = ${before}`.pipe(
        Effect.orDie,
      )
    }
  })
