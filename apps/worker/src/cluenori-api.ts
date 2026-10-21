import { IncidentsGroup } from "@cluenori/incidents"
import { MembersGroup, PasskeysGroup } from "@cluenori/members"
import { NotificationsGroup } from "@cluenori/notifications"
import { PairingGroup, PhonePushGroup, PhonesGroup } from "@cluenori/phones"
import { ProjectsGroup } from "@cluenori/projects"
import { SignalsGroup } from "@cluenori/signals"
import { TodayGroup } from "@cluenori/today"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api"

import { MemberAuthorization, Unauthorized } from "./member-authorization.ts"

/** Endpoints about the deployment itself, not about any project. */
export class SystemGroup extends HttpApiGroup.make("system", { topLevel: true }).add(
  HttpApiEndpoint.get("health", "/health", { success: HttpApiSchema.NoContent }).annotate(
    OpenApi.Description,
    "Answers 204 when the Worker is deployed and serving. Use it for uptime checks; it reads no storage.",
  ),
) {}

/** The API token, as a browser signs in with it. */
export const SignIn = Schema.Struct({ token: Schema.RedactedFromValue(Schema.String) }).annotate({
  identifier: "SignIn",
})

/** Signing a browser in and out: the way the dashboard gets the API token's access. */
export class SignInGroup extends HttpApiGroup.make("signIn", { topLevel: true })
  .add(
    HttpApiEndpoint.post("signIn", "/sign-in", {
      payload: SignIn,
      success: HttpApiSchema.NoContent,
      error: Unauthorized,
    }).annotate(
      OpenApi.Description,
      "Signs a browser in with the deployment's API token: answers 204 with the sign-in cookie, HttpOnly, Secure and SameSite=Strict, for /api, kept 30 days. The API then accepts it in place of the bearer token. A wrong token answers 401 and sets nothing.",
    ),
  )
  .add(
    HttpApiEndpoint.post("signOut", "/sign-out", { success: HttpApiSchema.NoContent }).annotate(
      OpenApi.Description,
      "Signs the browser out: answers 204 and removes the sign-in cookie.",
    ),
  ) {}

/**
 * The public API: one definition for the dashboard, the CLI, MCP clients, and agents. Served under
 * `/api`, with its OpenAPI document at `/api/openapi.json`. Everything but the system, sign-in,
 * pairing and phone push groups needs a member's credential: the deployment's API token as a bearer
 * token or the sign-in cookie, or a paired phone's key as a bearer token. A phone registers its push
 * token with its own key only.
 */
export class CluenoriApi extends HttpApi.make("cluenori")
  .add(SystemGroup)
  .add(SignInGroup)
  .add(PasskeysGroup)
  .add(MembersGroup.middleware(MemberAuthorization))
  .add(ProjectsGroup.middleware(MemberAuthorization))
  .add(SignalsGroup.middleware(MemberAuthorization))
  .add(IncidentsGroup.middleware(MemberAuthorization))
  .add(PairingGroup)
  .add(PhonesGroup.middleware(MemberAuthorization))
  .add(PhonePushGroup)
  .add(NotificationsGroup.middleware(MemberAuthorization))
  .add(TodayGroup.middleware(MemberAuthorization))
  .prefix("/api")
  .annotate(OpenApi.Title, "Cluenori") {}
