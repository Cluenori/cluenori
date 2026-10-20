import type { Actor } from "@cluenori/foundation"
import { Context, Schema } from "effect"
import { HttpApiMiddleware, HttpApiSecurity } from "effect/http-api"

/** Who is calling the public API: the member its token belongs to. Handlers act for them. */
export class CurrentActor extends Context.Service<CurrentActor, Actor>()(
  "@cluenori/worker/member-authorization/CurrentActor",
) {}

/** The API token is missing or wrong, or this deployment has none yet. `message` says which. */
export class Unauthorized extends Schema.TaggedError<Unauthorized>()(
  "Unauthorized",
  { message: Schema.String },
  { httpApiStatus: 401 },
) {}

/**
 * Requires `Authorization: Bearer <API token>` on the routes it guards. Clients provide the token
 * with `HttpApiMiddleware.layerClient`.
 */
export class MemberAuthorization extends HttpApiMiddleware.Service<
  MemberAuthorization,
  { provides: CurrentActor; requires: never }
>()("@cluenori/worker/member-authorization/MemberAuthorization", {
  requiredForClient: true,
  security: { bearer: HttpApiSecurity.bearer },
  error: Unauthorized,
}) {}
