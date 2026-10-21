import { AssertionResponse, CreationOptions, RegistrationResponse, RequestOptions } from "@bagatka/webauthn"
import { MemberId, NotAllowed, ProjectKey } from "@cluenori/foundation"
import { ProjectNotFound } from "@cluenori/projects"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api"

import {
  Invite,
  InviteCode,
  InviteMember,
  InviteRejected,
  Member,
  MemberExists,
  MemberList,
  MemberNotFound,
  PasskeyRejected,
  SignInId,
  SignInList,
  SignInNotFound,
} from "./member.ts"

/** The projects a member is to see. */
export const SetProjects = Schema.Struct({ projects: Schema.Array(ProjectKey) }).annotate({
  identifier: "SetProjects",
})

/** An invitation's code, as the invited person's page sends it. */
export const InvitationCode = Schema.Struct({ code: InviteCode }).annotate({ identifier: "InvitationCode" })

/** An invitation's code, and the passkey made with its options. */
export const JoinWithPasskey = Schema.Struct({ code: InviteCode, registration: RegistrationResponse }).annotate({
  identifier: "JoinWithPasskey",
})

/** Who calls, and the deployment's members, which only owners see or change. */
export class MembersGroup extends HttpApiGroup.make("members")
  .add(
    HttpApiEndpoint.get("me", "/me", { success: Member }).annotate(
      OpenApi.Description,
      "The member who calls: an owner sees every project; a member, the projects listed.",
    ),
  )
  .add(
    HttpApiEndpoint.post("passkeyOptions", "/me/passkeys/options", { success: CreationOptions }).annotate(
      OpenApi.Description,
      "The options that make another passkey for the member who calls, on this site, good for 5 minutes: pass them to navigator.credentials.create().",
    ),
  )
  .add(
    HttpApiEndpoint.post("addPasskey", "/me/passkeys", {
      payload: RegistrationResponse,
      success: HttpApiSchema.NoContent,
      error: PasskeyRejected.pipe(HttpApiSchema.status(400)),
    }).annotate(
      OpenApi.Description,
      "Adds the passkey made from passkeyOptions to the member who calls. 400 when it doesn't hold, such as for options used already.",
    ),
  )
  .add(
    HttpApiEndpoint.get("signIns", "/sign-ins", { success: SignInList }).annotate(
      OpenApi.Description,
      "The browsers signed in with passkeys, the latest seen first, each with what it is, when and where from it signed in and last called, and whether it is the one asking: an owner sees every member's, a member their own.",
    ),
  )
  .add(
    HttpApiEndpoint.delete("endSignIn", "/sign-ins/:signIn", {
      params: { signIn: SignInId },
      success: HttpApiSchema.NoContent,
      error: SignInNotFound.pipe(HttpApiSchema.status(404)),
    }).annotate(
      OpenApi.Description,
      "Signs a browser out: its sign-in stops working at once. An owner signs out any; a member, their own.",
    ),
  )
  .add(
    HttpApiEndpoint.get("members", "/members", {
      success: MemberList,
      error: NotAllowed.pipe(HttpApiSchema.status(403)),
    }).annotate(OpenApi.Description, "Every member, owners first. Owners only."),
  )
  .add(
    HttpApiEndpoint.post("invite", "/members/invites", {
      payload: InviteMember,
      success: Invite.pipe(HttpApiSchema.status(201)),
      error: [
        NotAllowed.pipe(HttpApiSchema.status(403)),
        MemberExists.pipe(HttpApiSchema.status(409)),
        ProjectNotFound.pipe(HttpApiSchema.status(404)),
      ],
    }).annotate(
      OpenApi.Description,
      "Invites someone to see these projects: a link, <deployment>/invite#<code>, good once for 7 days, which makes their passkey and signs them in. Send it to them yourself. Owners only.",
    ),
  )
  .add(
    HttpApiEndpoint.put("setProjects", "/members/:member/projects", {
      params: { member: MemberId },
      payload: SetProjects,
      success: Member,
      error: [
        NotAllowed.pipe(HttpApiSchema.status(403)),
        MemberNotFound.pipe(HttpApiSchema.status(404)),
        ProjectNotFound.pipe(HttpApiSchema.status(404)),
      ],
    }).annotate(OpenApi.Description, "Sets the projects a member sees. Owners only, and not for an owner."),
  )
  .add(
    HttpApiEndpoint.delete("removeMember", "/members/:member", {
      params: { member: MemberId },
      success: HttpApiSchema.NoContent,
      error: [NotAllowed.pipe(HttpApiSchema.status(403)), MemberNotFound.pipe(HttpApiSchema.status(404))],
    }).annotate(
      OpenApi.Description,
      "Removes a member: their passkeys, sign-ins and phones stop working at once. Owners only, and not an owner.",
    ),
  ) {}

/** Joining by an invitation, and signing in with a passkey: the calls that need no credential. */
export class PasskeysGroup extends HttpApiGroup.make("passkeys")
  .add(
    HttpApiEndpoint.post("joinOptions", "/invites/options", {
      payload: InvitationCode,
      success: CreationOptions,
      error: InviteRejected.pipe(HttpApiSchema.status(403)),
    }).annotate(
      OpenApi.Description,
      "The options that make the invited person's passkey on this site, good for 5 minutes. 403 for an invitation that is wrong, used, or older than 7 days.",
    ),
  )
  .add(
    HttpApiEndpoint.post("join", "/invites/join", {
      payload: JoinWithPasskey,
      success: Member,
      error: [InviteRejected.pipe(HttpApiSchema.status(403)), PasskeyRejected.pipe(HttpApiSchema.status(400))],
    }).annotate(
      OpenApi.Description,
      "Joins with the passkey made from joinOptions: the new member, signed in with the sign-in cookie, HttpOnly, Secure and SameSite=Strict, for /api, kept 30 days. The invitation is used up; a passkey that doesn't hold answers 400 and leaves it open.",
    ),
  )
  .add(
    HttpApiEndpoint.post("signInOptions", "/sign-in/passkey/options", { success: RequestOptions }).annotate(
      OpenApi.Description,
      "The options that sign in with any of this site's passkeys, good for 5 minutes: pass them to navigator.credentials.get().",
    ),
  )
  .add(
    HttpApiEndpoint.post("signInWithPasskey", "/sign-in/passkey", {
      payload: AssertionResponse,
      success: Member,
      error: PasskeyRejected.pipe(HttpApiSchema.status(401)),
    }).annotate(
      OpenApi.Description,
      "Signs in with a passkey answering signInOptions: the member, signed in with the sign-in cookie for 30 days. 401 for a passkey the deployment doesn't know, or an answer that doesn't hold.",
    ),
  ) {}
