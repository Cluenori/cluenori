import { CluenoriApi } from "@cluenori/worker"
import { exports } from "cloudflare:workers"
import { Context, Layer } from "effect"
import { FetchHttpClient } from "effect/http"
import { HttpApiClient } from "effect/http-api"

/** Where journeys address the Worker. Requests never leave the test; any host works. */
export const baseUrl = "https://cluenori.test"

/**
 * An `HttpClient` whose requests go to the Worker under test, through its default export: the same
 * entry the platform calls for a request from the internet.
 */
export const WorkerHttpClient = FetchHttpClient.layer.pipe(
  Layer.provide(Layer.succeed(FetchHttpClient.Fetch, (input, init) => exports.default.fetch(input, init))),
)

/** The public API's typed client, derived from its definition, as the dashboard and the CLI use it. */
export class CluenoriClient extends Context.Service<CluenoriClient, HttpApiClient.ForApi<typeof CluenoriApi>>()(
  "@cluenori/journeys/test/cluenori-client/CluenoriClient",
) {
  static readonly layer = Layer.effect(CluenoriClient, HttpApiClient.make(CluenoriApi, { baseUrl })).pipe(
    Layer.provideMerge(WorkerHttpClient),
  )
}
