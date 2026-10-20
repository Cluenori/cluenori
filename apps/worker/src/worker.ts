import { webCryptoLayer } from "@bagatka/web-crypto"
import { MemberId, WorkspaceKey } from "@cluenori/foundation"
import { env } from "cloudflare:workers"
import { Config, ConfigProvider, Effect, Layer, Option, Schema } from "effect"
import { HttpRouter, HttpServer } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"

import { CluenoriApi } from "./cluenori-api.ts"
import { memberAuthorizationLayer } from "./member-authorization-layer.ts"
import { OtlpLogs, OtlpMetrics, OtlpTraces } from "./otlp-ingest.ts"
import { ProjectObjects } from "./project-objects.ts"
import { ProjectsHandlers } from "./projects-handlers.ts"
import { SignalsHandlers } from "./signals-handlers.ts"
import { SyncScheduler } from "./sync-scheduler.ts"
import { SystemHandlers } from "./system-handlers.ts"

// A self-hosted deployment has one workspace.
const workspace = WorkspaceKey.make("main")

// The only configuration the Worker reads, one line per setting (PATTERNS.md, "Configuration").
const apiSettings = Config.all({
  token: Config.option(Config.Redacted("CLUENORI_API_TOKEN")),
  owner: Config.option(Config.schema(MemberId, "CLUENORI_OWNER")),
})
// Set by wrangler.jsonc's `eu` environment, which ./setup deploys for data kept in the EU.
const jurisdiction = Config.option(Config.schema(Schema.Literal("eu"), "CLUENORI_JURISDICTION"))

// Projects' Durable Objects are made in the EU when the deployment's data stays there.
const Projects = Layer.unwrap(
  Effect.gen(function* () {
    const where = yield* jurisdiction
    const namespace = Option.isSome(where) ? env.PROJECT.jurisdiction(where.value) : env.PROJECT
    return ProjectObjects.layer(namespace, workspace)
  }),
)

// Every route group is provided on its own line.
const ApiRoutes = HttpApiBuilder.layer(CluenoriApi, { openapiPath: "/api/openapi.json" }).pipe(
  Layer.provide(SystemHandlers),
  Layer.provide(ProjectsHandlers),
  Layer.provide(SignalsHandlers),
  Layer.provide(
    Layer.unwrap(
      Effect.gen(function* () {
        const settings = yield* apiSettings
        return memberAuthorizationLayer(settings)
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
    Layer.provideMerge(webCryptoLayer(crypto)),
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(env))),
    Layer.provide(HttpServer.layerServices),
    Layer.provideMerge(SyncScheduler),
  ),
)

export default {
  fetch: (request) => app.handler(request),
} satisfies ExportedHandler<Env>

// The platform finds Durable Object classes among the entry's exports.
export { ProjectObject } from "./project-object.ts"
