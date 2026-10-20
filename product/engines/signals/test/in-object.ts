import { webCryptoLayer } from "@bagatka/web-crypto"
import { SqliteClient } from "@effect/sql-sqlite-do"
import { runInDurableObject } from "cloudflare:test"
import { env } from "cloudflare:workers"
import { Effect, Layer } from "effect"
import type { SqlClient } from "effect/sql"
import { TestClock } from "effect/testing"

import { Signals } from "../src/index.ts"

/**
 * Runs `program` inside the Durable Object of project `project` at the time `now` (Unix ms), with
 * the engine built on its storage the way a host builds it. Tests use projects of their own.
 */
export const inProject = <A, E>(
  project: string,
  now: number,
  program: Effect.Effect<A, E, Signals | SqlClient.SqlClient>,
) =>
  Effect.promise(() =>
    runInDurableObject(env.PROJECT.getByName(project), (_instance, state) =>
      Effect.runPromise(
        TestClock.setTime(now).pipe(
          Effect.andThen(program),
          Effect.provide(
            Signals.layer.pipe(
              Layer.provideMerge(SqliteClient.layer({ storage: state.storage })),
              Layer.provideMerge(TestClock.layer()),
            ),
          ),
        ),
      ),
    ),
  )

/** Effect's `Crypto` on the runtime's Web Crypto, as a host provides it. */
export const WebCrypto = webCryptoLayer(crypto)
