import { webCryptoLayer } from "@bagatka/web-crypto"
import { ActivityLog, ProjectKey, WorkspaceKey } from "@cluenori/foundation"
import { Incidents } from "@cluenori/incidents"
import { Projects } from "@cluenori/projects"
import { ArchiveStore, Signals } from "@cluenori/signals"
import { SqliteClient } from "@effect/sql-sqlite-do"
import { runInDurableObject } from "cloudflare:test"
import { env } from "cloudflare:workers"
import { Effect, Layer, Option } from "effect"
import { HttpClient, HttpClientError } from "effect/http"
import { TestClock } from "effect/testing"

import { ReleaseRecords, ReleaseSources } from "../src/index.ts"

// A web that answers nothing: every monitor the tests add is down.
const unreachableWeb = Layer.succeed(
  HttpClient.HttpClient,
  HttpClient.make((request) =>
    Effect.fail(
      new HttpClientError.HttpClientError({
        reason: new HttpClientError.TransportError({ request, description: "No web in the test" }),
      }),
    ),
  ),
)

/** Sources with nothing set up: no GitHub token, no App Store Connect key. */
export const noSources = Layer.succeed(
  ReleaseSources,
  ReleaseSources.of({ github: Option.none(), appStoreConnect: Option.none() }),
)

/**
 * Runs `program` inside the Durable Object of project `project`, starting at the time `now` (Unix
 * ms), with the engines built on its storage the way the host builds them, the archive in memory,
 * a web that answers nothing, the module's records, and `sources` for GitHub and App Store Connect,
 * none unless given. `TestClock.setTime` moves time within it. Tests use projects of their own.
 */
export const inProject = <A, E>(
  project: string,
  now: number,
  program: Effect.Effect<A, E, Incidents | Signals | Projects | ActivityLog | ReleaseRecords | ReleaseSources>,
  sources: Layer.Layer<ReleaseSources> = noSources,
) =>
  Effect.promise(() =>
    runInDurableObject(env.PROJECT.getByName(project), (_instance, state) =>
      Effect.runPromise(
        TestClock.setTime(now).pipe(
          Effect.andThen(program),
          Effect.provide(
            Layer.mergeAll(ReleaseRecords.layer, sources).pipe(
              Layer.provideMerge(Incidents.layer),
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
              Layer.provide(unreachableWeb),
              Layer.provide(webCryptoLayer(crypto)),
              Layer.provide(SqliteClient.layer({ storage: state.storage })),
              Layer.provideMerge(TestClock.layer()),
            ),
          ),
        ),
      ),
    ),
  )
