import { ActivityLog, MemberId, WorkspaceKey } from "@cluenori/foundation"
import type { GitHub } from "@cluenori/github"
import { Members } from "@cluenori/members"
import { Phones } from "@cluenori/phones"
import { ProjectIndex } from "@cluenori/projects"
import { BrowserCrypto } from "@effect/platform-browser"
import { SqliteClient } from "@effect/sql-sqlite-do"
import { runInDurableObject } from "cloudflare:test"
import { env } from "cloudflare:workers"
import { Effect, Layer, Option } from "effect"
import { TestClock } from "effect/testing"

import type { WatcherSettings } from "../src/index.ts"
import { Watcher } from "../src/index.ts"

/** The owner the tests' deployment has. */
export const owner = MemberId.make("0199f7a2-5c1e-7d3a-9b2f-4e8a1c6d0f53")

/**
 * Runs `program` inside the workspace's Durable Object named `name`, at the time `now` (Unix ms),
 * with the engine built on its storage as the host builds it, with `settings`, and `github` for
 * GitHub. Tests use objects of their own.
 */
export const inWorkspace = <A, E>(
  name: string,
  now: number,
  settings: WatcherSettings,
  github: Layer.Layer<GitHub>,
  program: Effect.Effect<A, E, Watcher | Phones | Members | ProjectIndex>,
) =>
  Effect.promise(() =>
    runInDurableObject(env.WORKSPACE.getByName(name), (_instance, state) =>
      Effect.runPromise(
        TestClock.setTime(now).pipe(
          Effect.andThen(program),
          Effect.provide(
            Watcher.layer(settings).pipe(
              Layer.provideMerge(
                Layer.mergeAll(Phones.layer, Members.layer({ owner: Option.some(owner), crypto: crypto.subtle })),
              ),
              Layer.provideMerge(ProjectIndex.layer),
              Layer.provide(github),
              Layer.provide(ActivityLog.layer({ workspace: WorkspaceKey.make("main") })),
              Layer.provideMerge(BrowserCrypto.layer),
              Layer.provide(SqliteClient.layer({ storage: state.storage })),
              Layer.provideMerge(TestClock.layer()),
            ),
          ),
        ),
      ),
    ),
  )
