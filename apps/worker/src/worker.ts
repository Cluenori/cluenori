import { webCryptoLayer } from "@bagatka/web-crypto"
import { MemberId, WorkspaceKey } from "@cluenori/foundation"
import { env } from "cloudflare:workers"
import { Config, ConfigProvider, Effect, Layer, ManagedRuntime, Option, Schema } from "effect"
import { HttpRouter, HttpServer } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"

import { activityOf } from "./activity-queue.ts"
import { ApiToken } from "./api-token.ts"
import { CluenoriApi } from "./cluenori-api.ts"
import { IncidentsHandlers } from "./incidents-handlers.ts"
import { memberAuthorizationLayer } from "./member-authorization-layer.ts"
import { OtlpLogs, OtlpMetrics, OtlpTraces } from "./otlp-ingest.ts"
import { NotificationsHandlers, PairingHandlers, PhonePushHandlers, PhonesHandlers } from "./phones-handlers.ts"
import { ProjectObjects } from "./project-objects.ts"
import { ProjectsHandlers } from "./projects-handlers.ts"
import { SignInHandlers } from "./sign-in-handlers.ts"
import { SignalsHandlers } from "./signals-handlers.ts"
import { SyncScheduler } from "./sync-scheduler.ts"
import { SystemHandlers } from "./system-handlers.ts"
import { TodayHandlers } from "./today-handlers.ts"
import { workspaceCalls } from "./workspace-calls.ts"
import { WorkspaceObjects } from "./workspace-objects.ts"

// A self-hosted deployment has one workspace.
const workspace = WorkspaceKey.make("main")

// The only configuration the Worker reads, one line per setting (PATTERNS.md, "Configuration").
const apiSettings = Config.all({
  token: Config.option(Config.Redacted("CLUENORI_API_TOKEN")),
  owner: Config.option(Config.schema(MemberId, "CLUENORI_OWNER")),
})
// Set by wrangler.jsonc's `eu` environment, which ./setup deploys for data kept in the EU.
const jurisdiction = Config.option(Config.schema(Schema.Literal("eu"), "CLUENORI_JURISDICTION"))

// The Durable Objects, projects' and the workspace's, are made in the EU when the deployment's data
// stays there.
const Projects = Layer.unwrap(
  Effect.gen(function* () {
    const where = yield* jurisdiction
    const namespace = Option.isSome(where) ? env.PROJECT.jurisdiction(where.value) : env.PROJECT
    return ProjectObjects.layer(namespace, workspace)
  }),
)
const Workspace = Layer.unwrap(
  Effect.gen(function* () {
    const where = yield* jurisdiction
    const namespace = Option.isSome(where) ? env.WORKSPACE.jurisdiction(where.value) : env.WORKSPACE
    return WorkspaceObjects.layer(namespace, workspace)
  }),
)

// Every route group is provided on its own line.
const ApiRoutes = HttpApiBuilder.layer(CluenoriApi, { openapiPath: "/api/openapi.json" }).pipe(
  Layer.provide(SystemHandlers),
  Layer.provide(SignInHandlers),
  Layer.provide(ProjectsHandlers),
  Layer.provide(SignalsHandlers),
  Layer.provide(IncidentsHandlers),
  Layer.provide(PairingHandlers),
  Layer.provide(PhonesHandlers),
  Layer.provide(PhonePushHandlers),
  Layer.provide(NotificationsHandlers),
  Layer.provide(TodayHandlers),
  Layer.provide(memberAuthorizationLayer),
  Layer.provideMerge(
    Layer.unwrap(
      Effect.gen(function* () {
        const settings = yield* apiSettings
        return ApiToken.layer(settings)
      }),
    ),
  ),
)

// Built once per isolate, at module scope, and reused for every request (PATTERNS.md, "The Worker
// entry"). Building does no I/O, which Workers don't allow outside a request.
const app = HttpRouter.toWebHandler(
  Layer.mergeAll(ApiRoutes, OtlpTraces, OtlpLogs, OtlpMetrics).pipe(
    // The OTLP route asks for these per request, so they are outputs of the app's layer.
    Layer.provideMerge(Projects),
    Layer.provideMerge(Workspace),
    Layer.provideMerge(webCryptoLayer(crypto)),
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(env))),
    Layer.provide(HttpServer.layerServices),
    Layer.provideMerge(SyncScheduler),
  ),
)

// What the activity queue's consumer runs on, built once per isolate like the app.
const reactions = ManagedRuntime.make(
  Workspace.pipe(
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(env))),
    Layer.provideMerge(SyncScheduler),
  ),
)

/**
 * The activity queue's consumer: each batch goes to the workspace's object, whose notifications tell
 * phones about incidents. When APNs may take them later, the whole batch is tried again: what was
 * sent is kept, so no phone is told twice.
 */
const reactTo = (batch: MessageBatch) =>
  Effect.gen(function* () {
    const activity = yield* activityOf(batch)
    const objects = yield* WorkspaceObjects
    const told = yield* objects.call(workspaceCalls.notify, activity).pipe(Effect.result)
    if (told._tag === "Failure") {
      yield* Effect.logWarning("APNs didn't take alerts; trying again soon", { reason: told.failure.reason })
      return yield* Effect.sync(() => batch.retryAll())
    }
    yield* Effect.sync(() => batch.ackAll())
  })

export default {
  fetch: (request) => app.handler(request),
  queue: (batch) => reactions.runPromise(reactTo(batch)),
} satisfies ExportedHandler<Env>

// The platform finds Durable Object classes among the entry's exports.
export { ProjectObject } from "./project-object.ts"
export { WorkspaceObject } from "./workspace-object.ts"
