import { CluenoriApi, MemberAuthorization } from "@cluenori/worker"
import { Layer } from "effect"
import { FetchHttpClient, HttpClientRequest } from "effect/http"
import { HttpApiMiddleware } from "effect/http-api"
import { AtomHttpApi } from "effect/reactivity"

import { telemetryHeaders } from "@/lib/telemetry"

// A signed-in browser sends the sign-in cookie with every call to its own origin, by itself; the
// API's token never reaches the page's scripts. Each call carries the page's feature and origin
// when the dashboard is measured, so the API's work splits by the client that asked for it.
const SignedIn = HttpApiMiddleware.layerClient(MemberAuthorization, ({ next, request }) =>
  next(HttpClientRequest.setHeaders(request, telemetryHeaders({}))),
)

/**
 * The public API's typed client, derived from its definition, with the runtime the dashboard's atoms
 * run on. It calls the origin the dashboard is served from, as the Worker serves both.
 */
export class CluenoriClient extends AtomHttpApi.Service<CluenoriClient>()(
  "@cluenori/dashboard/api-client/CluenoriClient",
  {
    api: CluenoriApi,
    httpClient: Layer.mergeAll(FetchHttpClient.layer, SignedIn),
    baseUrl: window.location.origin,
  },
) {}
