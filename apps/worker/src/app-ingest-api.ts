import { AppManifestGroup } from "@cluenori/manifest"
import { AppIngestGroup } from "@cluenori/signals"
import { HttpApi, OpenApi } from "effect/http-api"

import { SdkKeyAuthorization } from "./sdk-key-authorization.ts"

/**
 * What apps' SDKs call, with a component's SDK key: a separate API from the public one, which needs a
 * member's credential. The SDKs' clients are generated from its OpenAPI document.
 */
export class CluenoriIngestApi extends HttpApi.make("cluenoriIngest")
  .add(AppIngestGroup.middleware(SdkKeyAuthorization))
  .add(AppManifestGroup.middleware(SdkKeyAuthorization))
  .annotate(OpenApi.Title, "CluenoriIngest") {}
