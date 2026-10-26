import { ProjectKey, WorkspaceKey } from "@cluenori/foundation"
import { BrowserCrypto } from "@effect/platform-browser"
import { SqliteClient } from "@effect/sql-sqlite-do"
import { runInDurableObject } from "cloudflare:test"
import { env } from "cloudflare:workers"
import { Effect, Layer } from "effect"
import { SqlClient } from "effect/sql"
import { TestClock } from "effect/testing"

import type { AppRateLimits } from "../src/index.ts"
import { AppBatchStore, AppSignals, ArchiveStore, Signals } from "../src/index.ts"

/**
 * Runs `program` inside the Durable Object of project `project` at the time `now` (Unix ms), with
 * the engine built on its storage the way a host builds it, and `archive` for its archive (one in
 * memory unless given). Tests use projects of their own.
 */
export const inProject = <A, E>(
  project: string,
  now: number,
  program: Effect.Effect<A, E, Signals | ArchiveStore | SqlClient.SqlClient>,
  archive: Layer.Layer<ArchiveStore> = ArchiveStore.layerMemory,
) =>
  Effect.promise(() =>
    runInDurableObject(env.PROJECT.getByName(project), (_instance, state) =>
      Effect.runPromise(
        TestClock.setTime(now).pipe(
          Effect.andThen(program),
          Effect.provide(
            Signals.layer({ workspace: WorkspaceKey.make("main"), project: ProjectKey.make(project) }).pipe(
              Layer.provideMerge(archive),
              Layer.provideMerge(SqliteClient.layer({ storage: state.storage })),
              Layer.provideMerge(TestClock.layer()),
            ),
          ),
        ),
      ),
    ),
  )

/** Effect's `Crypto` on the runtime's Web Crypto, as a host provides it. */
export const WebCrypto = BrowserCrypto.layer

/**
 * Runs `program` inside the Durable Object of project `project` at the time `now` (Unix ms), with
 * the apps' signals built on its storage the way a host builds them: their batches kept in `files`,
 * and `limits` on how much they take.
 */
export const inApps = <A, E>(
  project: string,
  now: number,
  program: Effect.Effect<A, E, AppSignals | SqlClient.SqlClient>,
  options: { readonly files?: Map<string, string>; readonly limits?: AppRateLimits } = {},
) =>
  Effect.promise(() =>
    runInDurableObject(env.PROJECT.getByName(project), (_instance, state) =>
      Effect.runPromise(
        TestClock.setTime(now).pipe(
          Effect.andThen(program),
          Effect.provide(
            AppSignals.layer({
              workspace: WorkspaceKey.make("main"),
              project: ProjectKey.make(project),
              ...(options.limits === undefined ? {} : { limits: options.limits }),
            }).pipe(
              Layer.provideMerge(AppBatchStore.layerMemory(options.files)),
              Layer.provideMerge(WebCrypto),
              Layer.provideMerge(SqliteClient.layer({ storage: state.storage })),
              Layer.provideMerge(TestClock.layer()),
            ),
          ),
        ),
      ),
    ),
  )

/** Removes what migration 0009 made, apps' tables, so a test can build a database from before it. */
export const dropAppTables = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  for (const table of [
    "signals_people",
    "signals_person_users",
    "signals_installations",
    "signals_app_releases",
    "signals_app_first_days",
    "signals_app_days",
    "signals_app_feature_days",
    "signals_app_measures",
    "signals_app_diagnostics",
    "signals_app_sessions",
    "signals_app_seen",
    "signals_app_timeline",
  ]) {
    yield* sql`DROP TABLE ${sql(table)}`
  }
})

/** Removes what migration 0011 made, features of services' signals, so a test can build a database from before it. */
export const dropFeatureSignals = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`DROP INDEX signals_logs_feature`
  yield* sql`ALTER TABLE signals_logs DROP COLUMN feature`
  yield* sql`DROP TABLE signals_feature_days`
  yield* sql`DROP INDEX IF EXISTS signals_app_feature_days_feature`
  yield* sql`DROP INDEX IF EXISTS signals_app_feature_days_person`
})

/** Removes what migration 0013 made, log messages, so a test can build a database from before it. */
export const dropLogMessages = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`DROP INDEX signals_logs_message`
  yield* sql`ALTER TABLE signals_logs DROP COLUMN message`
  yield* sql`DROP TABLE signals_log_messages`
})
