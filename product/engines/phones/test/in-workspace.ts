import { ActivityLog, WorkspaceKey } from "@cluenori/foundation"
import { BrowserCrypto } from "@effect/platform-browser"
import { SqliteClient } from "@effect/sql-sqlite-do"
import { runInDurableObject } from "cloudflare:test"
import { env } from "cloudflare:workers"
import { Effect, Layer } from "effect"
import { TestClock } from "effect/testing"

import { Phones } from "../src/index.ts"

/**
 * Runs `program` inside the workspace's Durable Object named `name`, starting at the time `now` (Unix
 * ms), with the engine built on its storage the way the host builds it. `TestClock.setTime` moves
 * time within it. Tests use objects of their own.
 */
export const inWorkspace = <A, E>(name: string, now: number, program: Effect.Effect<A, E, Phones | ActivityLog>) =>
  Effect.promise(() =>
    runInDurableObject(env.WORKSPACE.getByName(name), (_instance, state) =>
      Effect.runPromise(
        TestClock.setTime(now).pipe(
          Effect.andThen(program),
          Effect.provide(
            Phones.layer.pipe(
              Layer.provideMerge(ActivityLog.layer({ workspace: WorkspaceKey.make("main") })),
              Layer.provide(BrowserCrypto.layer),
              Layer.provide(SqliteClient.layer({ storage: state.storage })),
              Layer.provideMerge(TestClock.layer()),
            ),
          ),
        ),
      ),
    ),
  )
