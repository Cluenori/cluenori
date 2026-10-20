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
 * The cookie a browser gets by signing in with the API token (`POST /api/sign-in`): HttpOnly, so the
 * page's scripts can't read it; Secure; SameSite=Strict, so other sites can't send it; for `/api`.
 */
export const signInCookie = HttpApiSecurity.apiKey({ key: "cluenori_sign_in", in: "cookie" })

/**
 * Requires the API token on the routes it guards: `Authorization: Bearer <API token>` from a client,
 * which provides it with `HttpApiMiddleware.layerClient`; or the sign-in cookie from a browser, which
 * sends it by itself.
 */
export class MemberAuthorization extends HttpApiMiddleware.Service<
  MemberAuthorization,
  { provides: CurrentActor; requires: never }
>()("@cluenori/worker/member-authorization/MemberAuthorization", {
  requiredForClient: true,
  security: { bearer: HttpApiSecurity.bearer, signIn: signInCookie },
  error: Unauthorized,
}) {}
