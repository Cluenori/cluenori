import { AuthenticationResponseJSON } from "@bagatka/webauthn"
import { AnalyticsGroup } from "@cluenori/analytics"
import { FeedsGroup } from "@cluenori/feeds"
import { GitHubGroup } from "@cluenori/github-app"
import { IncidentsGroup } from "@cluenori/incidents"
import { MembersGroup, PasskeyRejected, PasskeysGroup } from "@cluenori/members"
import { NotificationsGroup } from "@cluenori/notifications"
import { PairedPhoneAnswer, PairingGroup, PhoneDetails, PhonePushGroup, PhonesGroup } from "@cluenori/phones"
import { ProjectsGroup } from "@cluenori/projects"
import { ReleasesGroup } from "@cluenori/releases"
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

/** A phone's passkey answer, and what the phone says about itself. */
export const PairWithPasskey = Schema.Struct({
  assertion: AuthenticationResponseJSON,
  ...PhoneDetails.fields,
}).annotate({
  identifier: "PairWithPasskey",
})

/**
 * A phone signing in with its owner's passkey, in place of a pairing code: it pairs, acting for the
 * passkey's member. Needs no credential but the passkey.
 */
export class PhoneSignInGroup extends HttpApiGroup.make("phoneSignIn").add(
  HttpApiEndpoint.post("pairWithPasskey", "/phones/passkey", {
    payload: PairWithPasskey,
    success: PairedPhoneAnswer,
    error: PasskeyRejected.pipe(HttpApiSchema.status(401)),
  }).annotate(
    OpenApi.Description,
    "Pairs a phone with a passkey answering /sign-in/passkey/options, acting for its member, and answers with its key, shown only this once, as pairing with a code does. The phone's passkey request names this site, which must list the app in /.well-known/apple-app-site-association. A passkey the deployment doesn't know, or an answer that doesn't hold, answers 401.",
  ),
) {}

/**
 * The public API: one definition for the dashboard, the CLI, MCP clients, and agents. Served under
 * `/api`, with its OpenAPI document at `/api/openapi.json`. Everything but the system, sign-in,
 * passkeys, pairing, phone sign-in and phone push groups, engines' and modules' alike, needs a member's credential: the deployment's API token as a bearer
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
  .add(PhoneSignInGroup)
  .add(PhonesGroup.middleware(MemberAuthorization))
  .add(PhonePushGroup)
  .add(NotificationsGroup.middleware(MemberAuthorization))
  .add(TodayGroup.middleware(MemberAuthorization))
  .add(FeedsGroup.middleware(MemberAuthorization))
  .add(GitHubGroup.middleware(MemberAuthorization))
  // Modules' routes, each module on a line: its group, not its definition, so clients that build on
  // this definition don't bundle the queries it runs in projects' objects.
  .add(ReleasesGroup.middleware(MemberAuthorization))
  .add(AnalyticsGroup.middleware(MemberAuthorization))
  .prefix("/api")
  .annotate(OpenApi.Title, "Cluenori") {}
