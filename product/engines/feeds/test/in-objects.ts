import { ActivityLog, ProjectKey, WorkspaceKey } from "@cluenori/foundation"
import type { FeedAlert } from "@cluenori/notifications"
import { Notifications, PushUnavailable } from "@cluenori/notifications"
import { ProjectIndex, ProjectName, Projects } from "@cluenori/projects"
import { BrowserCrypto } from "@effect/platform-browser"
import { SqliteClient } from "@effect/sql-sqlite-do"
import { runInDurableObject } from "cloudflare:test"
import { env } from "cloudflare:workers"
import { DateTime, Effect, Layer } from "effect"
import { TestClock } from "effect/testing"

import { Feeds, FeedWatch } from "../src/index.ts"

/**
 * Notifications that keep each feed's alert they are handed, instead of pushing it, letting other
 * fibers run first, as a push over the network does. The first `unavailable` alerts fail as APNs
 * not taking them does; `handed` keeps those too.
 */
export const keptAlerts = (unavailable = 0) => {
  const alerts: Array<FeedAlert> = []
  const handed: Array<FeedAlert> = []
  const layer = Layer.succeed(
    Notifications,
    Notifications.of({
      notify: () => Effect.void,
      notifyFeed: (alert) =>
        Effect.yieldNow.pipe(
          Effect.andThen(() => {
            handed.push(alert)
            return handed.length <= unavailable
              ? Effect.fail(new PushUnavailable({ reason: "ServiceUnavailable" }))
              : Effect.sync(() => void alerts.push(alert))
          }),
        ),
      testAlert: () => Effect.void,
    }),
  )
  return { alerts, handed, layer }
}

const withProjects = Effect.gen(function* () {
  const index = yield* ProjectIndex
  for (const [key, name] of [
    ["notes", "Notes"],
    ["folio", "Folio"],
    ["atlas", "Atlas"],
  ] as const) {
    yield* index.record({ key: ProjectKey.make(key), name: ProjectName.make(name), createdAt: DateTime.makeUnsafe(0) })
  }
})

/**
 * Runs `program` inside the workspace's Durable Object named `name` at `now` (Unix ms), with Feeds
 * built on its storage as the host builds it, handing alerts to `notifications`, and the workspace
 * having projects Notes, Folio and Atlas. `TestClock.setTime` moves time within it.
 */
export const inWorkspace = <A, E>(
  name: string,
  now: number,
  notifications: Layer.Layer<Notifications>,
  program: Effect.Effect<A, E, Feeds | ActivityLog>,
) =>
  Effect.promise(() =>
    runInDurableObject(env.WORKSPACE.getByName(name), (_instance, state) =>
      Effect.runPromise(
        TestClock.setTime(now).pipe(
          Effect.andThen(withProjects),
          Effect.andThen(program),
          Effect.provide(
            Feeds.layer.pipe(
              Layer.provideMerge(ActivityLog.layer({ workspace: WorkspaceKey.make("main") })),
              Layer.provideMerge(ProjectIndex.layer),
              Layer.provide(notifications),
              Layer.provide(BrowserCrypto.layer),
              Layer.provide(SqliteClient.layer({ storage: state.storage })),
              Layer.provideMerge(TestClock.layer()),
            ),
          ),
        ),
      ),
    ),
  )

/**
 * Runs `program` inside project `project`'s Durable Object at `now` (Unix ms), with its side of
 * feeds and its project's records built on its storage as the host builds them.
 */
export const inProject = <A, E>(
  project: string,
  now: number,
  program: Effect.Effect<A, E, FeedWatch | Projects | ActivityLog>,
) =>
  Effect.promise(() =>
    runInDurableObject(env.PROJECT.getByName(project), (_instance, state) =>
      Effect.runPromise(
        TestClock.setTime(now).pipe(
          Effect.andThen(program),
          Effect.provide(
            FeedWatch.layer.pipe(
              Layer.provideMerge(Projects.layer({ project: ProjectKey.make(project) })),
              Layer.provideMerge(
                ActivityLog.layer({ workspace: WorkspaceKey.make("main"), project: ProjectKey.make(project) }),
              ),
              Layer.provide(BrowserCrypto.layer),
              Layer.provide(SqliteClient.layer({ storage: state.storage })),
              Layer.provideMerge(TestClock.layer()),
            ),
          ),
        ),
      ),
    ),
  )
