import { ActivityLog, ProjectKey, WorkspaceKey } from "@cluenori/foundation"
import { GitHub, GitHubRefused } from "@cluenori/github"
import { Incidents } from "@cluenori/incidents"
import { Projects } from "@cluenori/projects"
import { AppBatchStore, AppSignals, ArchiveStore, Signals } from "@cluenori/signals"
import { BrowserCrypto } from "@effect/platform-browser"
import { SqliteClient } from "@effect/sql-sqlite-do"
import { runInDurableObject } from "cloudflare:test"
import { env } from "cloudflare:workers"
import type { Crypto } from "effect"
import { Effect, Layer, Option, Stream } from "effect"
import { AiError, LanguageModel } from "effect/ai"
import { HttpClient, HttpClientError } from "effect/http"
import type { SqlClient } from "effect/sql"
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

/** GitHub before the workspace's app is connected: every call is refused. */
export const notConnected = GitHub.layerFor(() =>
  Effect.fail(new GitHubRefused({ status: 0, reason: "Cluenori isn't connected to GitHub yet" })),
).pipe(Layer.provide(unreachableWeb))

/** A language model that answers `answer` to every prompt, keeping each prompt it was given. */
export const fakeModel = (answer: (prompt: string) => string, prompts: Array<string> = []) =>
  Layer.effect(
    LanguageModel.LanguageModel,
    LanguageModel.make({
      generateText: (options) =>
        Effect.sync(() => {
          const text = options.prompt.content
            .map((message) =>
              typeof message.content === "string"
                ? message.content
                : message.content.map((part) => (part.type === "text" ? part.text : "")).join(""),
            )
            .join("\n\n")
          prompts.push(text)
          return [{ type: "text" as const, text: answer(text) }]
        }),
      streamText: () => Stream.empty,
    }),
  )

/** A language model that never answers. */
export const noModel = Layer.effect(
  LanguageModel.LanguageModel,
  LanguageModel.make({
    generateText: () =>
      Effect.fail(
        AiError.make({
          module: "test",
          method: "generateText",
          reason: new AiError.UnknownError({ description: "No model in the test" }),
        }),
      ),
    streamText: () => Stream.empty,
  }),
)

/** Sources with nothing set up: GitHub not connected, no App Store Connect key, no language model. */
export const noSources = Layer.mergeAll(
  Layer.succeed(
    ReleaseSources,
    ReleaseSources.of({ appStoreConnect: Option.none(), appStoreConnectManager: Option.none() }),
  ),
  notConnected,
  noModel,
)

/**
 * Runs `program` inside the Durable Object of project `project`, starting at the time `now` (Unix
 * ms), with the engines built on its storage the way the host builds them, the archive in memory,
 * a web that answers nothing, the module's records, and `sources` for GitHub and App Store Connect,
 * neither set up unless given. `TestClock.setTime` moves time within it. Tests use projects of their own.
 */
export const inProject = <A, E>(
  project: string,
  now: number,
  program: Effect.Effect<
    A,
    E,
    | Incidents
    | Signals
    | AppSignals
    | Projects
    | ActivityLog
    | ReleaseRecords
    | ReleaseSources
    | GitHub
    | Crypto.Crypto
    | LanguageModel.LanguageModel
    | SqlClient.SqlClient
  >,
  sources: Layer.Layer<ReleaseSources | GitHub | LanguageModel.LanguageModel> = noSources,
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
                  AppSignals.layer({ workspace: WorkspaceKey.make("main"), project: ProjectKey.make(project) }).pipe(
                    Layer.provide(AppBatchStore.layerMemory()),
                  ),
                ),
              ),
              Layer.provideMerge(
                ActivityLog.layer({ workspace: WorkspaceKey.make("main"), project: ProjectKey.make(project) }),
              ),
              Layer.provide(ArchiveStore.layerMemory),
              Layer.provide(unreachableWeb),
              Layer.provideMerge(BrowserCrypto.layer),
              Layer.provideMerge(SqliteClient.layer({ storage: state.storage })),
              Layer.provideMerge(TestClock.layer()),
            ),
          ),
        ),
      ),
    ),
  )
