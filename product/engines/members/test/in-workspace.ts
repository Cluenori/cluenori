import { webCryptoLayer } from "@bagatka/web-crypto"
import type { MemberId } from "@cluenori/foundation"
import { ActivityLog, WorkspaceKey } from "@cluenori/foundation"
import { ProjectIndex } from "@cluenori/projects"
import { SqliteClient } from "@effect/sql-sqlite-do"
import { runInDurableObject } from "cloudflare:test"
import { env } from "cloudflare:workers"
import { Effect, Layer, Option } from "effect"
import { TestClock } from "effect/testing"

import { Members } from "../src/index.ts"

/**
 * Runs `program` inside the workspace's Durable Object named `name`, starting at the time `now` (Unix
 * ms), with the engine built on its storage the way the host builds it, `owner` its owner. Tests use
 * objects of their own.
 */
export const inWorkspace = <A, E>(
  name: string,
  now: number,
  owner: MemberId,
  program: Effect.Effect<A, E, Members | ProjectIndex | ActivityLog>,
) =>
  Effect.promise(() =>
    runInDurableObject(env.WORKSPACE.getByName(name), (_instance, state) =>
      Effect.runPromise(
        TestClock.setTime(now).pipe(
          Effect.andThen(program),
          Effect.provide(
            Members.layer({ owner: Option.some(owner), crypto: crypto.subtle }).pipe(
              Layer.provideMerge(ProjectIndex.layer),
              Layer.provideMerge(ActivityLog.layer({ workspace: WorkspaceKey.make("main") })),
              Layer.provide(webCryptoLayer(crypto)),
              Layer.provide(SqliteClient.layer({ storage: state.storage })),
              Layer.provideMerge(TestClock.layer()),
            ),
          ),
        ),
      ),
    ),
  )
