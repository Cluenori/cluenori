import type { Actor } from "@cluenori/foundation"
import { Context, Schema } from "effect"
import { HttpApiMiddleware, HttpApiSecurity } from "effect/http-api"

/**
 * Who is calling the public API: the member its token belongs to, or who paired the phone whose key
 * it is. Handlers act for them.
 */
export class CurrentActor extends Context.Service<CurrentActor, Actor>()(
  "@cluenori/worker/member-authorization/CurrentActor",
) {}

/**
 * The API token is missing or wrong, a phone's key no longer works, or this deployment has no token
 * yet. `message` says which.
 */
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
 * Requires a member's credential on the routes it guards: `Authorization: Bearer <API token>` from a
 * client, which provides it with `HttpApiMiddleware.layerClient`, or `Bearer <phone key>` from a
 * paired phone; or the sign-in cookie from a browser, which sends it by itself.
 */
export class MemberAuthorization extends HttpApiMiddleware.Service<
  MemberAuthorization,
  { provides: CurrentActor; requires: never }
>()("@cluenori/worker/member-authorization/MemberAuthorization", {
  requiredForClient: true,
  // Tried in this order, and a failure says what the last one found: a bearer token's problem, such
  // as a removed phone's key, is what a client is told.
  security: { signIn: signInCookie, bearer: HttpApiSecurity.bearer },
  error: Unauthorized,
}) {}
