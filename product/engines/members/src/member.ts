import { Instant, MemberId, ProjectKey, Uuidv7 } from "@cluenori/foundation"
import { Schema } from "effect"

/** What a member may do: an owner everything, a member everything in the projects they are in. */
export const MemberRole = Schema.Literals(["owner", "member"]).annotate({ identifier: "MemberRole" })
export type MemberRole = typeof MemberRole.Type

/** An email address, lowercase: how a member is told apart, and what their passkeys are named by. */
export const Email = Schema.String.check(
  Schema.isMaxLength(254),
  Schema.isPattern(/^[^\sA-Z@]+@[^\sA-Z@]+\.[^\sA-Z@]+$/, { expected: "an email address in lowercase" }),
).pipe(Schema.brand("Email"))
export type Email = typeof Email.Type

/** Someone who signs in to the deployment, and what they see. */
export class Member extends Schema.Class<Member>("Member")({
  id: MemberId,
  role: MemberRole,
  /** Absent for the owner `./setup` made. */
  email: Schema.optionalKey(Email),
  /** The projects a member sees; absent for an owner, who sees every one. */
  projects: Schema.optionalKey(Schema.Array(ProjectKey)),
  addedAt: Instant,
  /** How many passkeys they sign in with. */
  passkeys: Schema.Int,
}) {}

/** The deployment's members, owners first, then by when they joined. */
export const MemberList = Schema.Struct({ members: Schema.Array(Member) }).annotate({ identifier: "MemberList" })
export type MemberList = typeof MemberList.Type

/** What a member sees: every project, or these. */
export const Access = Schema.Union([
  Schema.TaggedStruct("Everything", {}),
  Schema.TaggedStruct("Projects", { projects: Schema.Array(ProjectKey) }),
]).annotate({ identifier: "Access" })
export type Access = typeof Access.Type

/** Whether `access` sees `project`. */
export const canSee = (access: Access, project: ProjectKey) =>
  access._tag === "Everything" || access.projects.includes(project)

/** Who to invite, and the projects they will see: at least one. */
export const InviteMember = Schema.Struct({
  email: Email,
  projects: Schema.Array(ProjectKey).check(Schema.isMinLength(1)),
}).annotate({ identifier: "InviteMember" })
export type InviteMember = typeof InviteMember.Type

/**
 * An invitation: the link that makes their passkey and signs them in, good once until `expiresAt`. The
 * link is `<deployment>/invite#<code>`: the code stays in the browser, out of every server's logs.
 */
export const Invite = Schema.Struct({ link: Schema.String, expiresAt: Instant }).annotate({ identifier: "Invite" })
export type Invite = typeof Invite.Type

/** An invitation's code: 43 characters of base64url, good once, for 7 days. */
export const InviteCode = Schema.String.check(
  Schema.isPattern(/^[\w-]{43}$/, { expected: "an invitation code of 43 letters, digits, - and _" }),
).pipe(Schema.brand("InviteCode"))
export type InviteCode = typeof InviteCode.Type

/**
 * A browser's sign-in: `cluenori.sign-in.<ID>.<secret>`, kept in its cookie for 30 days. Cluenori
 * keeps only its SHA-256 digest.
 */
export const SignInToken = Schema.String.check(
  Schema.isPattern(/^cluenori\.sign-in\.[0-9a-f-]{36}\.[\w-]{43}$/, { expected: "a sign-in token" }),
).pipe(Schema.brand("SignInToken"))
export type SignInToken = typeof SignInToken.Type

/** A browser's sign-in's ID: the part of its token after `cluenori.sign-in.`. */
export const SignInId = Uuidv7.pipe(Schema.brand("SignInId"))
export type SignInId = typeof SignInId.Type

/** A browser signed in as a member: what it is, and when and where from it signed in and was last seen. */
export class SignIn extends Schema.Class<SignIn>("SignIn")({
  id: SignInId,
  member: MemberId,
  /** What people call it, `Safari on macOS`; absent when its User-Agent says nothing Cluenori knows. */
  browser: Schema.optionalKey(Schema.String),
  signedInAt: Instant,
  /** When it last called, at most a minute out. */
  seenAt: Instant,
  /** Absent when the call came without one, as it can outside Cloudflare. */
  address: Schema.optionalKey(Schema.String),
  /** Two letters, as Cloudflare places the address; absent when it couldn't. */
  country: Schema.optionalKey(Schema.String),
  /** Whether it is the browser asking. */
  current: Schema.Boolean,
}) {}

/**
 * The sign-ins of the browsers a member sees: an owner every member's, a member their own; the latest
 * seen first.
 */
export const SignInList = Schema.Struct({ signIns: Schema.Array(SignIn) }).annotate({ identifier: "SignInList" })
export type SignInList = typeof SignInList.Type

/** Whether a cookie's value is meant as a sign-in token, by its prefix, before it is checked. */
export const isSignInToken = (value: string) => value.startsWith("cluenori.sign-in.")

/**
 * Where a passkey ceremony runs: the page's origin, `https://cluenori.example`, and the site its
 * passkeys belong to, its hostname. The host reads both from the request.
 */
export const Site = Schema.Struct({ origin: Schema.String, rpId: Schema.String })
export type Site = typeof Site.Type

/** The deployment has no member with this ID. */
export class MemberNotFound extends Schema.TaggedError<MemberNotFound>()("MemberNotFound", { member: MemberId }) {}

/** A member has this email already: remove them first to invite them again. */
export class MemberExists extends Schema.TaggedError<MemberExists>()("MemberExists", { email: Email }) {}

/** The invitation is wrong, used, or older than 7 days: ask for a new one. */
export class InviteRejected extends Schema.TaggedError<InviteRejected>()("InviteRejected", {}) {}

/** The passkey didn't sign in: the deployment doesn't know it, or its answer doesn't hold. */
export class PasskeyRejected extends Schema.TaggedError<PasskeyRejected>()("PasskeyRejected", {}) {}

/** No sign-in with this ID that the member sees: it signed out, or it is another member's. */
export class SignInNotFound extends Schema.TaggedError<SignInNotFound>()("SignInNotFound", { signIn: SignInId }) {}

/** The sign-in isn't one: signed out, older than 30 days, or its member removed. */
export class SignInRejected extends Schema.TaggedError<SignInRejected>()("SignInRejected", {}) {}
