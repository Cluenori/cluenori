import { BrowserCrypto } from "@effect/platform-browser"
import { SqliteClient } from "@effect/sql-sqlite-do"
import { runInDurableObject } from "cloudflare:test"
import { env } from "cloudflare:workers"
import { Effect, Layer } from "effect"
import type { SqlClient } from "effect/sql"

import type { ActivityLogSettings } from "../src/index.ts"
import { ActivityLog } from "../src/index.ts"

/**
 * Runs `program` inside the Durable Object named `object`, with Foundation built on that object's
 * storage the way a host builds it. A failure inside fails the test with what went wrong. Each call builds it anew, as a restarted object would. Tests
 * name objects of their own, so they share nothing.
 */
export const inObject = <A, E>(
  object: string,
  settings: ActivityLogSettings,
  program: Effect.Effect<A, E, ActivityLog | SqlClient.SqlClient>,
) =>
  Effect.promise(() =>
    runInDurableObject(env.PROJECT.getByName(object), (_instance, state) =>
      Effect.runPromise(
        program.pipe(
          Effect.provide(
            ActivityLog.layer(settings).pipe(
              Layer.provide(BrowserCrypto.layer),
              Layer.provideMerge(SqliteClient.layer({ storage: state.storage })),
            ),
          ),
        ),
      ),
    ),
  )
