import { Layer, Scheduler } from "effect"
import { HttpRouter, HttpServer } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"

import { CluenoriApi } from "./cluenori-api.ts"
import { SystemHandlers } from "./system-handlers.ts"

// Every route group is provided on its own line.
const ApiRoutes = HttpApiBuilder.layer(CluenoriApi, { openapiPath: "/api/openapi.json" }).pipe(
  Layer.provide(SystemHandlers),
)

// Workers can discard timers owned by a request, which would leave work shared between requests
// suspended. The sync scheduler avoids that; its cost is that a fiber runs until it waits for I/O.
const SyncScheduler = Layer.succeed(Scheduler.Scheduler, new Scheduler.MixedScheduler("sync"))

// Built once per isolate, at module scope, and reused for every request (PATTERNS.md, "The Worker
// entry"). Building does no I/O, which Workers don't allow outside a request.
const app = HttpRouter.toWebHandler(
  ApiRoutes.pipe(Layer.provide(HttpServer.layerServices), Layer.provideMerge(SyncScheduler)),
)

export default {
  fetch: (request) => app.handler(request),
} satisfies ExportedHandler<Env>
