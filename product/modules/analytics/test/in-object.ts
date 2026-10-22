import { ProjectKey, WorkspaceKey } from "@cluenori/foundation"
import { AppBatchStore, AppSignals } from "@cluenori/signals"
import { webCryptoLayer } from "@cluenori/web-crypto"
import { SqliteClient } from "@effect/sql-sqlite-do"
import { runInDurableObject } from "cloudflare:test"
import { env } from "cloudflare:workers"
import { Effect, Layer } from "effect"
import { TestClock } from "effect/testing"

/**
 * Runs `program` inside the Durable Object of project `project` at the time `now` (Unix ms), with the
 * apps' signals built on its storage as the host builds them. Tests use projects of their own.
 */
export const inProject = <A, E>(project: string, now: number, program: Effect.Effect<A, E, AppSignals>) =>
  Effect.promise(() =>
    runInDurableObject(env.PROJECT.getByName(project), (_instance, state) =>
      Effect.runPromise(
        TestClock.setTime(now).pipe(
          Effect.andThen(program),
          Effect.provide(
            AppSignals.layer({ workspace: WorkspaceKey.make("main"), project: ProjectKey.make(project) }).pipe(
              Layer.provide(AppBatchStore.layerMemory()),
              Layer.provide(webCryptoLayer(crypto)),
              Layer.provide(SqliteClient.layer({ storage: state.storage })),
              Layer.provideMerge(TestClock.layer()),
            ),
          ),
        ),
      ),
    ),
  )
