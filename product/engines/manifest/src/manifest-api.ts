import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"

import { AppManifest, ManifestQuery } from "./manifest.ts"

/**
 * Where apps' SDKs read their manifest. Served at `/ingest/v1/app/manifest` with the component's SDK
 * key as a bearer token; the same for every installation of a release, so it is cached at the edge.
 */
export class AppManifestGroup extends HttpApiGroup.make("appManifest").add(
  HttpApiEndpoint.get("manifest", "/ingest/v1/app/manifest", {
    query: ManifestQuery,
    success: AppManifest,
  }).annotate(
    OpenApi.Description,
    "The manifest of one release of the SDK key's component: what the app should do about its version (`none`, `recommend` a newer release, or `require` an update), with the release to update to and the project's words in the language asked for. The same for every installation of the release, and cached at the edge for `maxAgeSeconds`. 401 for an SDK key the deployment doesn't know or revoked; an SDK then keeps the last manifest it got, and never blocks without one.",
  ),
) {}
