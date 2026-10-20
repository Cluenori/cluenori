import { webCryptoLayer } from "@bagatka/web-crypto"
import { ProjectKey, WorkspaceKey } from "@cluenori/foundation"
import { SqliteClient } from "@effect/sql-sqlite-do"
import { runInDurableObject } from "cloudflare:test"
import { env } from "cloudflare:workers"
import { Effect, Layer } from "effect"
import type { SqlClient } from "effect/sql"
import { TestClock } from "effect/testing"

import { ArchiveStore, Signals } from "../src/index.ts"

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
export const WebCrypto = webCryptoLayer(crypto)
