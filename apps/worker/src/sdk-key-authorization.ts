import type { ComponentKey, ProjectKey } from "@cluenori/foundation"
import type { SdkKey } from "@cluenori/projects"
import { SdkKeyRejected } from "@cluenori/signals"
import { Context } from "effect"
import { HttpApiMiddleware, HttpApiSchema, HttpApiSecurity } from "effect/http-api"

/**
 * The component whose SDK key a request carried, in its project, and the key. The key names them, so
 * the Worker routes by it unread; the project's object checks the key in the same call that reads or
 * records anything, and refuses one that isn't active with `SdkKeyRejected`.
 */
export class CurrentSdkComponent extends Context.Service<
  CurrentSdkComponent,
  { readonly project: ProjectKey; readonly component: ComponentKey; readonly key: SdkKey }
>()("@cluenori/worker/sdk-key-authorization/CurrentSdkComponent") {}

/**
 * Requires a component's SDK key, `Authorization: Bearer <SDK key>`, on the routes it guards: the key
 * an app's build carries, which may only send that component's signals. Not a secret: anyone can read
 * it from the app, so it grants nothing else.
 */
export class SdkKeyAuthorization extends HttpApiMiddleware.Service<
  SdkKeyAuthorization,
  { provides: CurrentSdkComponent; requires: never }
>()("@cluenori/worker/sdk-key-authorization/SdkKeyAuthorization", {
  requiredForClient: true,
  security: { bearer: HttpApiSecurity.bearer },
  error: SdkKeyRejected.pipe(HttpApiSchema.status(401)),
}) {}
