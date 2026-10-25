import { ActivityLog, ProjectKey, WorkspaceKey } from "@cluenori/foundation"
import { Projects } from "@cluenori/projects"
import { ArchiveStore, Signals } from "@cluenori/signals"
import { BrowserCrypto } from "@effect/platform-browser"
import { SqliteClient } from "@effect/sql-sqlite-do"
import { runInDurableObject } from "cloudflare:test"
import { env } from "cloudflare:workers"
import { Effect, Layer } from "effect"
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/http"
import { TestClock } from "effect/testing"

import { Incidents } from "../src/index.ts"

/**
 * How the fake web answers each URL: with this status, or, for a URL not here, by not connecting.
 * Each test uses URLs of its own.
 */
export const answers = new Map<string, number>()

const fakeWeb = Layer.succeed(
  HttpClient.HttpClient,
  HttpClient.make((request, url) => {
    const status = answers.get(url.href)
    return status === undefined
      ? Effect.fail(
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({ request, description: "No route in the test" }),
          }),
        )
      : Effect.succeed(HttpClientResponse.fromWeb(request, new Response(null, { status })))
  }),
)

/**
 * Runs `program` inside the Durable Object of project `project`, starting at the time `now` (Unix
 * ms), with the engines built on its storage the way the host builds them, the archive in memory,
 * and the fake web. `TestClock.setTime` moves time within it. Tests use projects of their own.
 */
export const inProject = <A, E>(
  project: string,
  now: number,
  program: Effect.Effect<A, E, Incidents | Signals | Projects | ActivityLog>,
) =>
  Effect.promise(() =>
    runInDurableObject(env.PROJECT.getByName(project), (_instance, state) =>
      Effect.runPromise(
        TestClock.setTime(now).pipe(
          Effect.andThen(program),
          Effect.provide(
            Incidents.layer.pipe(
              Layer.provideMerge(
                Layer.mergeAll(
                  Projects.layer({ project: ProjectKey.make(project) }),
                  Signals.layer({ workspace: WorkspaceKey.make("main"), project: ProjectKey.make(project) }),
                ),
              ),
              Layer.provideMerge(
                ActivityLog.layer({ workspace: WorkspaceKey.make("main"), project: ProjectKey.make(project) }),
              ),
              Layer.provide(ArchiveStore.layerMemory),
              Layer.provide(fakeWeb),
              Layer.provide(BrowserCrypto.layer),
              Layer.provide(SqliteClient.layer({ storage: state.storage })),
              Layer.provideMerge(TestClock.layer()),
            ),
          ),
        ),
      ),
    ),
  )
