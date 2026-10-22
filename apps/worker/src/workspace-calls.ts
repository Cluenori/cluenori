import { GitHubRefused, GitHubUnavailable, Repository } from "@bagatka/github"
import { CreationOptions, RegistrationResponse, RequestOptions, AssertionResponse } from "@bagatka/webauthn"
import { Actor, Envelope, Instant, MemberId, NotAllowed, ProjectKey } from "@cluenori/foundation"
import { Caller } from "@cluenori/foundation"
import {
  ConnectRejected,
  GitHubAccount,
  GitHubAlreadyConnected,
  GitHubAppForm,
  GitHubAppSummary,
  GitHubStatus,
  ManifestCode,
} from "@cluenori/github"
import {
  Access,
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
  SignInRejected,
  SignInToken,
  Site,
} from "@cluenori/members"
import { NoPushToken, PushNotSetUp, PushRejected, PushUnavailable } from "@cluenori/notifications"
import {
  PairedPhone,
  Pairing,
  PairingCodeRejected,
  PairPhone,
  PhoneId,
  PhoneKey,
  PhoneKeyRejected,
  PhoneList,
  PhoneDetails,
  PhoneNotFound,
  RegisterPush,
} from "@cluenori/phones"
import { Project, ProjectList, ProjectNotFound } from "@cluenori/projects"
import { Schema } from "effect"

import type { ObjectCall, PlainSchema } from "./object-calls.ts"
import { objectCall } from "./object-calls.ts"

export type WorkspaceCallName =
  | "recordProject"
  | "projects"
  | "phones"
  | "startPairing"
  | "pair"
  | "authenticatePhone"
  | "removePhone"
  | "registerPush"
  | "notify"
  | "testAlert"
  | "signedIn"
  | "signOut"
  | "signIns"
  | "endSignIn"
  | "me"
  | "members"
  | "invite"
  | "setProjects"
  | "removeMember"
  | "joinOptions"
  | "join"
  | "signInOptions"
  | "signIn"
  | "passkeyOptions"
  | "addPasskey"
  | "pairWithPasskey"
  | "github"
  | "connectGitHub"
  | "finishConnectingGitHub"
  | "disconnectGitHub"
  | "gitHubToken"

/** One thing the Worker asks the workspace's Durable Object: its input, its answer, and how it fails. */
export type WorkspaceCall<I extends PlainSchema, S extends PlainSchema, F extends PlainSchema> = ObjectCall<
  WorkspaceCallName,
  I,
  S,
  F
>

const workspaceCall = <I extends PlainSchema, S extends PlainSchema, F extends PlainSchema>(
  name: WorkspaceCallName,
  input: I,
  success: S,
  error: F,
): WorkspaceCall<I, S, F> => objectCall(name, input, success, error)

/** Who calls, and what they see. */
export const Calling = Schema.Struct({ actor: Actor, access: Access })

/**
 * A token that acts as the workspace's GitHub App on one repository, and when it expires: it
 * crosses from the workspace's object to a project's only in the answer.
 */
const RepositoryToken = Schema.Struct({ token: Schema.String, expiresAt: Instant })

/** A member just signed in, with their browser's sign-in token. */
const SignedIn = Schema.Struct({ member: Member, signIn: SignInToken })

/** What the Worker asks the workspace's Durable Object, one entry per call. */
export const workspaceCalls = {
  recordProject: workspaceCall("recordProject", Project, Schema.Void, Schema.Never),
  projects: workspaceCall("projects", Schema.Void, ProjectList, Schema.Never),
  phones: workspaceCall("phones", Schema.Void, PhoneList, Schema.Never),
  startPairing: workspaceCall(
    "startPairing",
    Schema.Struct({ actor: Actor, deployment: Schema.String }),
    Pairing,
    Schema.Never,
  ),
  // The phone's new key crosses to the Worker only in the answer, and then to the phone.
  pair: workspaceCall("pair", Schema.Struct({ phone: PairPhone, caller: Caller }), PairedPhone, PairingCodeRejected),
  // Who a phone's key acts for, and what they see: one request before the call's own.
  authenticatePhone: workspaceCall(
    "authenticatePhone",
    Schema.Struct({ key: PhoneKey, caller: Caller }),
    Calling,
    PhoneKeyRejected,
  ),
  // An owner removes any phone; a member, only their own: another's is not found.
  removePhone: workspaceCall(
    "removePhone",
    Schema.Struct({ ...Calling.fields, phone: PhoneId }),
    Schema.Void,
    PhoneNotFound,
  ),
  registerPush: workspaceCall(
    "registerPush",
    Schema.Struct({ key: PhoneKey, caller: Caller, push: RegisterPush }),
    Schema.Void,
    PhoneKeyRejected,
  ),
  notify: workspaceCall("notify", Schema.Array(Envelope), Schema.Void, PushUnavailable),
  // An owner rings any phone; a member, only their own: another's has no push token for them.
  testAlert: workspaceCall(
    "testAlert",
    Schema.Struct({ ...Calling.fields, phone: PhoneId }),
    Schema.Void,
    Schema.Union([PushNotSetUp, NoPushToken, PushRejected, PushUnavailable]),
  ),
  // Who a browser's sign-in is for, and what they see: one request before the call's own.
  signedIn: workspaceCall("signedIn", Schema.Struct({ token: SignInToken, caller: Caller }), Calling, SignInRejected),
  signOut: workspaceCall("signOut", SignInToken, Schema.Void, Schema.Never),
  signIns: workspaceCall(
    "signIns",
    Schema.Struct({ actor: Actor, current: Schema.optionalKey(SignInId) }),
    SignInList,
    Schema.Never,
  ),
  endSignIn: workspaceCall("endSignIn", Schema.Struct({ actor: Actor, signIn: SignInId }), Schema.Void, SignInNotFound),
  me: workspaceCall("me", MemberId, Member, MemberNotFound),
  members: workspaceCall("members", Actor, MemberList, NotAllowed),
  invite: workspaceCall(
    "invite",
    Schema.Struct({ actor: Actor, invite: InviteMember, site: Site }),
    Invite,
    Schema.Union([NotAllowed, MemberExists, ProjectNotFound]),
  ),
  setProjects: workspaceCall(
    "setProjects",
    Schema.Struct({ actor: Actor, member: MemberId, projects: Schema.Array(ProjectKey) }),
    Member,
    Schema.Union([NotAllowed, MemberNotFound, ProjectNotFound]),
  ),
  // The member, then their phones, which stop working too.
  removeMember: workspaceCall(
    "removeMember",
    Schema.Struct({ actor: Actor, member: MemberId }),
    Schema.Void,
    Schema.Union([NotAllowed, MemberNotFound]),
  ),
  joinOptions: workspaceCall(
    "joinOptions",
    Schema.Struct({ code: InviteCode, site: Site }),
    CreationOptions,
    InviteRejected,
  ),
  // The new sign-in's token crosses to the Worker only in the answer, and then to the cookie.
  join: workspaceCall(
    "join",
    Schema.Struct({ code: InviteCode, registration: RegistrationResponse, site: Site, caller: Caller }),
    SignedIn,
    Schema.Union([InviteRejected, PasskeyRejected]),
  ),
  signInOptions: workspaceCall("signInOptions", Site, RequestOptions, Schema.Never),
  signIn: workspaceCall(
    "signIn",
    Schema.Struct({ assertion: AssertionResponse, site: Site, caller: Caller }),
    SignedIn,
    PasskeyRejected,
  ),
  passkeyOptions: workspaceCall(
    "passkeyOptions",
    Schema.Struct({ actor: Actor, site: Site }),
    CreationOptions,
    NotAllowed,
  ),
  // The passkey's member, then a phone acting for them: its key crosses to the Worker only in the
  // answer, and then to the phone.
  pairWithPasskey: workspaceCall(
    "pairWithPasskey",
    Schema.Struct({ assertion: AssertionResponse, phone: PhoneDetails, site: Site, caller: Caller }),
    PairedPhone,
    PasskeyRejected,
  ),
  addPasskey: workspaceCall(
    "addPasskey",
    Schema.Struct({ actor: Actor, registration: RegistrationResponse, site: Site }),
    Schema.Void,
    Schema.Union([NotAllowed, PasskeyRejected]),
  ),
  github: workspaceCall("github", Access, GitHubStatus, NotAllowed),
  connectGitHub: workspaceCall(
    "connectGitHub",
    Schema.Struct({ ...Calling.fields, deployment: Schema.String, organization: Schema.optionalKey(GitHubAccount) }),
    GitHubAppForm,
    Schema.Union([NotAllowed, GitHubAlreadyConnected]),
  ),
  // From the browser GitHub sent back, without a sign-in: the state is what an owner started.
  finishConnectingGitHub: workspaceCall(
    "finishConnectingGitHub",
    Schema.Struct({ code: ManifestCode, state: Schema.String }),
    GitHubAppSummary,
    ConnectRejected,
  ),
  disconnectGitHub: workspaceCall("disconnectGitHub", Calling, Schema.Void, NotAllowed),
  // A project's object asks it for the repositories it reads and acts on.
  gitHubToken: workspaceCall(
    "gitHubToken",
    Repository,
    RepositoryToken,
    Schema.Union([GitHubRefused, GitHubUnavailable]),
  ),
}
