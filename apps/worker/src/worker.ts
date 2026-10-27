import { MemberId, WorkspaceKey } from "@cluenori/foundation"
import { releasesModule } from "@cluenori/releases"
import { selfTelemetryUntraced, selfTelemetryUntracedServer } from "@cluenori/signals"
import { BrowserCrypto } from "@effect/platform-browser"
import { env } from "cloudflare:workers"
import { Config, ConfigProvider, Effect, Layer, ManagedRuntime, Option, Schema } from "effect"
import { HttpRouter, HttpServer } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"

import { activityOf } from "./activity-queue.ts"
import { AnalyticsHandlers } from "./analytics-handlers.ts"
import { ApiToken } from "./api-token.ts"
import { CluenoriIngestApi } from "./app-ingest-api.ts"
import { AppIngestHandlers, AppManifestHandlers, appIngestFromAnyOrigin } from "./app-ingest.ts"
import { AppleAppSiteAssociation } from "./apple-app-site.ts"
import { CluenoriApi } from "./cluenori-api.ts"
import { FeedsHandlers } from "./feeds-handlers.ts"
import { GitHubConnected, GitHubHandlers } from "./github-handlers.ts"
import { IncidentsHandlers } from "./incidents-handlers.ts"
import { ManifestCache } from "./manifest-cache.ts"
import { memberAuthorizationLayer } from "./member-authorization-layer.ts"
import { MemberProjects } from "./member-projects.ts"
import { moduleIngestRoute } from "./module-ingest.ts"
import { OtlpLogs, OtlpMetrics, OtlpTraces } from "./otlp-ingest.ts"
import {
  NotificationsHandlers,
  PairingHandlers,
  PhonePushHandlers,
  PhoneSignInHandlers,
  PhonesHandlers,
} from "./phones-handlers.ts"
import { ProjectObjects } from "./project-objects.ts"
import { ProjectsHandlers } from "./projects-handlers.ts"
import { ReleasesHandlers } from "./releases-handlers.ts"
import { sdkKeyAuthorizationLayer } from "./sdk-key-authorization-layer.ts"
import { MembersHandlers, PasskeysHandlers, SignInHandlers } from "./sign-in-handlers.ts"
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
const Workspace = WorkspaceObjects.layerInJurisdiction(env.WORKSPACE, workspace)

// Every route group is provided on its own line.
const ApiRoutes = HttpApiBuilder.layer(CluenoriApi, { openapiPath: "/api/openapi.json" }).pipe(
  Layer.provide(SystemHandlers),
  Layer.provide(SignInHandlers),
  Layer.provide(PasskeysHandlers),
  Layer.provide(MembersHandlers),
  Layer.provide(ProjectsHandlers),
  Layer.provide(SignalsHandlers),
  Layer.provide(IncidentsHandlers),
  Layer.provide(PairingHandlers),
  Layer.provide(PhoneSignInHandlers),
  Layer.provide(PhonesHandlers),
  Layer.provide(PhonePushHandlers),
  Layer.provide(NotificationsHandlers),
  Layer.provide(TodayHandlers),
  Layer.provide(FeedsHandlers),
  Layer.provide(ReleasesHandlers),
  Layer.provide(AnalyticsHandlers),
  Layer.provide(GitHubHandlers),
  Layer.provide(memberAuthorizationLayer),
  // Handlers reach projects only through it, which keeps to what the member sees (.oxlintrc.json);
  // they ask for it per request, so it is an output.
  Layer.provideMerge(MemberProjects.layer),
  Layer.provideMerge(
    Layer.unwrap(
      Effect.gen(function* () {
        const settings = yield* apiSettings
        return ApiToken.layer(settings)
      }),
    ),
  ),
)

// What apps' SDKs call, with a component's SDK key: their batches, and their manifest, which the
// edge keeps five minutes. Not under /api, and not for members.
const IngestRoutes = HttpApiBuilder.layer(CluenoriIngestApi).pipe(
  Layer.provide(AppIngestHandlers),
  Layer.provide(AppManifestHandlers),
  Layer.provide(sdkKeyAuthorizationLayer),
  // The manifest's handler asks for the cache per request, so it is an output.
  Layer.provideMerge(ManifestCache.layer),
)

// Built once per isolate, at module scope, and reused for every request (PATTERNS.md, "The Worker
// entry"). Building does no I/O, which Workers don't allow outside a request. Each route's path
// prefix is in wrangler.jsonc's `run_worker_first`, in every environment; any other path is the
// dashboard's, whose files answer a POST with 405. Tests call the Worker directly, past that. A
// request of the deployment's own telemetry is handled untraced, so ingesting what the Worker
// reports of itself never makes more of it (`selfTelemetryUntraced`). Apps' ingest routes answer web
// apps of any origin (`appIngestFromAnyOrigin`).
const app = HttpRouter.toWebHandler(
  Layer.mergeAll(
    ApiRoutes,
    IngestRoutes,
    OtlpTraces,
    OtlpLogs,
    OtlpMetrics,
    AppleAppSiteAssociation,
    GitHubConnected,
    // Modules' ingest writes, each on a line: what components' own tooling sends with their ingest key.
    moduleIngestRoute(releasesModule, "report"),
    moduleIngestRoute(releasesModule, "last"),
    moduleIngestRoute(releasesModule, "number"),
    moduleIngestRoute(releasesModule, "runner"),
  ).pipe(
    // The OTLP route asks for these per request, so they are outputs of the app's layer.
    Layer.provideMerge(Projects),
    Layer.provideMerge(Workspace),
    Layer.provideMerge(BrowserCrypto.layer),
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(env))),
    Layer.provide(HttpServer.layerServices),
    Layer.provideMerge(SyncScheduler),
    Layer.provideMerge(selfTelemetryUntracedServer),
  ),
  { middleware: (handled) => selfTelemetryUntraced(appIngestFromAnyOrigin(handled)) },
)

// What the activity queue's consumer runs on, built once per isolate like the app.
const reactions = ManagedRuntime.make(
  Workspace.pipe(
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(env))),
    Layer.provideMerge(SyncScheduler),
  ),
)

/**
 * The activity queue's consumer: each batch goes to the workspace's object, whose feeds take the
 * events they watch and whose notifications tell phones about incidents. When APNs may take alerts
 * later, the whole batch is tried again: what was recorded and sent is kept, so no entry is made and
 * no phone told twice. Feeds' own alerts wait for the object's alarm instead.
 */
const reactTo = (batch: MessageBatch) =>
  Effect.gen(function* () {
    const activity = yield* activityOf(batch)
    const objects = yield* WorkspaceObjects
    yield* objects.call(workspaceCalls.recordFeeds, activity)
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
