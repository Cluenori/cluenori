import { webCryptoLayer } from "@bagatka/web-crypto"
import { ActivityLog, ProjectKey, WorkspaceKey } from "@cluenori/foundation"
import { SqliteClient } from "@effect/sql-sqlite-do"
import { runInDurableObject } from "cloudflare:test"
import { env } from "cloudflare:workers"
import { Effect, Layer } from "effect"
import type { SqlClient } from "effect/sql"

import { ProjectIndex, Projects } from "../src/index.ts"

/**
 * Runs `program` inside the Durable Object of project `project`, with the engine built on its
 * storage the way a host builds it. Tests use projects of their own, so they share nothing.
 */
export const inProject = <A, E>(
  project: string,
  program: Effect.Effect<A, E, Projects | ActivityLog | SqlClient.SqlClient>,
) =>
  Effect.promise(() =>
    runInDurableObject(env.PROJECT.getByName(project), (_instance, state) =>
      Effect.runPromise(
        program.pipe(
          Effect.provide(
            Projects.layer({ project: ProjectKey.make(project) }).pipe(
              Layer.provideMerge(
                ActivityLog.layer({ workspace: WorkspaceKey.make("main"), project: ProjectKey.make(project) }),
              ),
              Layer.provide(webCryptoLayer(crypto)),
              Layer.provideMerge(SqliteClient.layer({ storage: state.storage })),
            ),
          ),
        ),
      ),
    ),
  )

/**
 * Runs `program` inside a Durable Object standing for a workspace's own, with the project index
 * built on its storage the way a host builds it. Tests use workspaces of their own.
 */
export const inWorkspace = <A, E>(workspace: string, program: Effect.Effect<A, E, ProjectIndex>) =>
  Effect.promise(() =>
    runInDurableObject(env.PROJECT.getByName(`workspace/${workspace}`), (_instance, state) =>
      Effect.runPromise(
        program.pipe(
          Effect.provide(ProjectIndex.layer.pipe(Layer.provide(SqliteClient.layer({ storage: state.storage })))),
        ),
      ),
    ),
  )
