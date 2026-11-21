import { ActivityLog, ProjectKey, WorkspaceKey } from "@cluenori/foundation"
import { Incidents } from "@cluenori/incidents"
import { Projects } from "@cluenori/projects"
import { AppBatchStore, AppSignals, ArchiveStore, Signals } from "@cluenori/signals"
import { BrowserCrypto } from "@effect/platform-browser"
import { SqliteClient } from "@effect/sql-sqlite-do"
import { runInDurableObject } from "cloudflare:test"
import { env } from "cloudflare:workers"
import { Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/http"
import { TestClock } from "effect/testing"

import { Today } from "../src/index.ts"

/** Runs Today beside its real engines on an isolated project's SQLite, at a controlled time. */
export const inProject = <A, E>(
  project: string,
  now: number,
  program: Effect.Effect<A, E, Today | Projects | Signals | AppSignals | Incidents>,
) =>
  Effect.promise(() =>
    runInDurableObject(env.PROJECT.getByName(project), (_instance, state) =>
      Effect.runPromise(
        TestClock.setTime(now).pipe(
          Effect.andThen(program),
          Effect.provide(
            Today.layer.pipe(
              Layer.provideMerge(Incidents.layer),
              Layer.provideMerge(
                Layer.mergeAll(
                  Projects.layer({ project: ProjectKey.make(project) }),
                  Signals.layer({ workspace: WorkspaceKey.make("main"), project: ProjectKey.make(project) }),
                  AppSignals.layer({ workspace: WorkspaceKey.make("main"), project: ProjectKey.make(project) }),
                ),
              ),
              Layer.provide(
                ActivityLog.layer({ workspace: WorkspaceKey.make("main"), project: ProjectKey.make(project) }),
              ),
              Layer.provide(ArchiveStore.layerMemory),
              Layer.provide(AppBatchStore.layerMemory()),
              Layer.provide(BrowserCrypto.layer),
              Layer.provide(FetchHttpClient.layer),
              Layer.provide(SqliteClient.layer({ storage: state.storage })),
              Layer.provideMerge(TestClock.layer()),
            ),
          ),
        ),
      ),
    ),
  )
