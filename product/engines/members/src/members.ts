import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
  WebAuthnCrypto,
} from "@bagatka/webauthn"
import {
  authenticationOptions,
  challengeOf,
  registrationOptions,
  verifyAuthentication,
  verifyRegistration,
} from "@bagatka/webauthn"
import type { Actor, Caller } from "@cluenori/foundation"
import { ActivityLog, Instant, MemberId, NotAllowed, ProjectKey, Source } from "@cluenori/foundation"
import { ProjectIndex, ProjectNotFound } from "@cluenori/projects"
import { Context, Crypto, DateTime, Duration, Effect, Layer, Option, Redacted, Schema } from "effect"
import { Base64Url, Hex } from "effect/encoding"
import { SqlClient, SqlSchema } from "effect/sql"

import { browserOf } from "./browsers.ts"
import type { Access, InviteMember, MemberList, Site, SignInList } from "./member.ts"
import type { Invite } from "./member.ts"
import {
  Email,
  InviteCode,
  InviteRejected,
  Member,
  MemberExists,
  MemberNotFound,
  MemberRole,
  PasskeyRejected,
  SignIn,
  SignInId,
  SignInNotFound,
  SignInRejected,
  SignInToken,
} from "./member.ts"
import { MemberInvited, MemberJoined, MemberProjectsChanged, MemberRemoved, PasskeyAdded } from "./members-activity.ts"
import { migrateMembers } from "./members-migrations.ts"

const source = Source.make("engine:members")

// An invitation is good once, for this long; at most this many are open at once, the oldest dropped.
const inviteLasts = Duration.toMillis(Duration.days(7))
const openInvites = 20

// A passkey ceremony's challenge is good once, for as long as the browser waits for the person.
const challengeLasts = Duration.toMillis(Duration.minutes(5))

// A browser stays signed in this long; when it calls is recorded at most this often, unless it
// calls from another address.
const signInLasts = Duration.toMillis(Duration.days(30))
const seenEvery = Duration.toMillis(Duration.minutes(1))

const signInPrefix = "cluenori.sign-in."

/** What the engine needs: the owner `./setup` made, and the platform's Web Crypto for passkeys. */
export interface MembersSettings {
  readonly owner: Option.Option<MemberId>
  readonly crypto: WebAuthnCrypto
}

/** A member just signed in, and their browser's sign-in, returned here only. */
export interface SignedIn {
  readonly member: Member
  readonly signIn: Redacted.Redacted<SignInToken>
}

const MemberRow = Schema.Struct({
  id: MemberId,
  role: MemberRole,
  email: Schema.NullOr(Email),
  addedAt: Instant,
  passkeys: Schema.Int,
})
type MemberRow = typeof MemberRow.Type

const ChallengeRow = Schema.Struct({ subject: Schema.String })

// A sign-in, as each call checks it.
interface SignInRow {
  readonly id: string
  readonly member: MemberId
  readonly seenAt: number
  readonly address: string | null
}
const PasskeyRow = Schema.Struct({
  id: Schema.String,
  member: MemberId,
  publicKey: Schema.String,
  signCount: Schema.Int,
})
const InviteRow = Schema.Struct({ email: Email, projects: Schema.fromJsonString(Schema.Array(ProjectKey)) })

// The account a member's passkeys name, WebAuthn's user handle: their ID's bytes, in base64url.
const userHandleOf = (member: MemberId) => Base64Url.encode(member)

// A passkey that didn't hold: why goes to the log, and the person is told only to try again.
const rejectedPasskey = (rejected: { readonly reason: string }) =>
  Effect.logWarning("A passkey was refused", { reason: rejected.reason }).pipe(
    Effect.andThen(Effect.fail(new PasskeyRejected())),
  )

/**
 * The deployment's members, what each sees, and how each signs in: invitations, passkeys, and
 * browsers' sign-ins. Runs in the workspace's Durable Object, beside the project index it checks
 * projects against.
 */
export class Members extends Context.Service<
  Members,
  {
    /** What `member` sees. Fails with `MemberNotFound` once they are removed. Reads only. */
    readonly accessOf: (member: MemberId) => Effect.Effect<Access, MemberNotFound>
    /** `member` as they are now. Fails with `MemberNotFound` once they are removed. Reads only. */
    readonly member: (member: MemberId) => Effect.Effect<Member, MemberNotFound>
    /** Every member, owners first. Only an owner may ask: `NotAllowed` for anyone else. */
    readonly members: (actor: Actor) => Effect.Effect<MemberList, NotAllowed>
    /**
     * Invites `input.email` to `input.projects`, with `member.invited`: a link on `site`, good once
     * for 7 days; at most 20 are open, another drops the oldest. Only an owner may: `NotAllowed`.
     * `MemberExists` for a member's email, `ProjectNotFound` for a project the deployment doesn't
     * have.
     */
    readonly invite: (
      actor: Actor,
      input: InviteMember,
      site: Site,
    ) => Effect.Effect<Invite, NotAllowed | MemberExists | ProjectNotFound>
    /**
     * The options that make the invited person's passkey on `site`. Fails with `InviteRejected`
     * for an invitation that is wrong, used, or expired, the same way whichever.
     */
    readonly startJoining: (
      code: InviteCode,
      site: Site,
    ) => Effect.Effect<PublicKeyCredentialCreationOptionsJSON, InviteRejected>
    /**
     * Makes the member, with the passkey they made from `startJoining`'s options and the projects of
     * their invitation, with `member.joined` and `passkey.added`, and signs their browser in. The
     * invitation is used up. `InviteRejected` as for `startJoining`; `PasskeyRejected` when the
     * passkey doesn't hold, which leaves the invitation open.
     */
    readonly join: (
      code: InviteCode,
      registration: RegistrationResponseJSON,
      site: Site,
      caller: Caller,
    ) => Effect.Effect<SignedIn, InviteRejected | PasskeyRejected>
    /** The options that sign in with any of `site`'s passkeys. */
    readonly startSignIn: (site: Site) => Effect.Effect<PublicKeyCredentialRequestOptionsJSON>
    /**
     * Signs in with a passkey answering `startSignIn`'s options: its member, and a sign-in for the
     * browser `caller` is. `PasskeyRejected` for a passkey the deployment doesn't know, or an answer that doesn't
     * hold, the same way whichever.
     */
    readonly signIn: (
      assertion: AuthenticationResponseJSON,
      site: Site,
      caller: Caller,
    ) => Effect.Effect<SignedIn, PasskeyRejected>
    /**
     * The member a passkey answering `startSignIn`'s options belongs to, for a caller that keeps
     * its own credential afterwards, such as a phone that pairs. No browser sign-in is made.
     * `PasskeyRejected` as for `signIn`.
     */
    readonly verifyPasskey: (
      assertion: AuthenticationResponseJSON,
      site: Site,
    ) => Effect.Effect<Member, PasskeyRejected>
    /**
     * Who a browser's sign-in is for, and what they see. `SignInRejected`, the same way whatever is
     * wrong, for a token that isn't a sign-in, that signed out, that is older than 30 days, or whose
     * member is removed. Records when and where from it called, at most once a minute from one
     * address.
     */
    readonly signedIn: (
      token: Redacted.Redacted<SignInToken>,
      caller: Caller,
    ) => Effect.Effect<{ readonly member: MemberId; readonly access: Access }, SignInRejected>
    /** Ends a browser's sign-in; one already ended is nothing to end. */
    readonly signOut: (token: Redacted.Redacted<SignInToken>) => Effect.Effect<void>
    /**
     * The browsers signed in that `actor` sees: an owner every member's, a member their own, `current`
     * marked. Reads only.
     */
    readonly signIns: (actor: Actor, current: SignInId | undefined) => Effect.Effect<SignInList>
    /**
     * Signs a browser out: its sign-in stops working at once. `SignInNotFound` for one `actor`
     * doesn't see, or that ended already.
     */
    readonly endSignIn: (actor: Actor, signIn: SignInId) => Effect.Effect<void, SignInNotFound>
    /** The options that add a passkey on `site` for the signed-in member `actor`. */
    readonly startAddingPasskey: (
      actor: Actor,
      site: Site,
    ) => Effect.Effect<PublicKeyCredentialCreationOptionsJSON, NotAllowed>
    /**
     * Adds the passkey `actor` made from `startAddingPasskey`'s options, with `passkey.added`.
     * `PasskeyRejected` when it doesn't hold.
     */
    readonly addPasskey: (
      actor: Actor,
      registration: RegistrationResponseJSON,
      site: Site,
    ) => Effect.Effect<void, NotAllowed | PasskeyRejected>
    /**
     * Sets the projects a member sees, with `member.projects_changed`. Only an owner may, and only
     * for a member, not an owner: `NotAllowed`. `MemberNotFound`, `ProjectNotFound` as named.
     */
    readonly setProjects: (
      actor: Actor,
      member: MemberId,
      projects: ReadonlyArray<ProjectKey>,
    ) => Effect.Effect<Member, NotAllowed | MemberNotFound | ProjectNotFound>
    /**
     * Removes a member, with `member.removed`: their passkeys and sign-ins stop working at once. Only an
     * owner may, and not an owner: `NotAllowed`. Their phones are the host's to remove.
     */
    readonly remove: (actor: Actor, member: MemberId) => Effect.Effect<void, NotAllowed | MemberNotFound>
  }
>()("@cluenori/members/members") {
  /**
   * Builds the engine on the workspace's database, first creating or updating its tables, and
   * listing `settings.owner` as an owner.
   */
  static readonly layer = (settings: MembersSettings) =>
    Layer.effect(
      Members,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const crypto = yield* Crypto.Crypto
        const log = yield* ActivityLog
        const index = yield* ProjectIndex
        yield* migrateMembers.pipe(Effect.orDie)

        if (Option.isSome(settings.owner)) {
          const addedAt = DateTime.formatIso(yield* DateTime.now)
          yield* sql`INSERT OR IGNORE INTO members_members ${sql.insert({ id: settings.owner.value, role: "owner", email: null, added_at: addedAt })}`.pipe(
            Effect.orDie,
          )
        }

        // Codes, tokens and IDs are ASCII, so their characters are their bytes.
        const digestOf = (text: string) =>
          crypto
            .digest(
              "SHA-256",
              Uint8Array.from(text, (character) => character.charCodeAt(0)),
            )
            .pipe(Effect.orDie, Effect.map(Hex.encode))
        const secret = crypto.randomBytes(32).pipe(Effect.orDie, Effect.map(Base64Url.encode))
        const nowMs = DateTime.now.pipe(Effect.map(DateTime.toEpochMillis))
        const encodeProjects = Schema.encodeEffect(Schema.fromJsonString(Schema.Array(ProjectKey)))

        const memberColumns = sql`m.id, m.role, m.email, m.added_at AS "addedAt",
          (SELECT COUNT(*) FROM members_passkeys p WHERE p.member = m.id) AS passkeys`

        const findMembers = SqlSchema.findAll({
          Request: Schema.Void,
          Result: MemberRow,
          execute: () => sql`SELECT ${memberColumns} FROM members_members m
            ORDER BY m.role = 'owner' DESC, m.added_at, m.id`,
        })
        const findMember = SqlSchema.findOneOption({
          Request: MemberId,
          Result: MemberRow,
          execute: (id) => sql`SELECT ${memberColumns} FROM members_members m WHERE m.id = ${id}`,
        })
        const findProjects = SqlSchema.findAll({
          Request: Schema.Void,
          Result: Schema.Struct({ member: MemberId, project: ProjectKey }),
          execute: () => sql`SELECT member, project FROM members_projects ORDER BY project`,
        })
        const findInvite = SqlSchema.findOneOption({
          Request: Schema.Struct({ digest: Schema.String, now: Schema.Int }),
          Result: InviteRow,
          execute: (asked) => sql`SELECT email, projects FROM members_invites
            WHERE code_digest = ${asked.digest} AND expires_at > ${asked.now}`,
        })
        const findPasskey = SqlSchema.findOneOption({
          Request: Schema.Struct({ id: Schema.String, rpId: Schema.String }),
          Result: PasskeyRow,
          execute: (asked) => sql`SELECT id, member, public_key AS "publicKey", sign_count AS "signCount"
            FROM members_passkeys WHERE id = ${asked.id} AND rp_id = ${asked.rpId}`,
        })
        const findPasskeyIds = SqlSchema.findAll({
          Request: Schema.Struct({ member: MemberId, rpId: Schema.String }),
          Result: Schema.Struct({ id: Schema.String }),
          execute: (asked) =>
            sql`SELECT id FROM members_passkeys WHERE member = ${asked.member} AND rp_id = ${asked.rpId}`,
        })
        const findSignIn = SqlSchema.findOneOption({
          Request: Schema.Struct({ id: Schema.String, now: Schema.Int }),
          Result: Schema.Struct({
            digest: Schema.String,
            member: MemberId,
            seenAt: Schema.Int,
            address: Schema.NullOr(Schema.String),
          }),
          execute: (asked) => sql`SELECT digest, member, seen_at AS "seenAt", address FROM members_sign_ins
            WHERE id = ${asked.id} AND expires_at > ${asked.now}`,
        })
        const findSignIns = SqlSchema.findAll({
          Request: Schema.Int,
          Result: Schema.Struct({
            id: SignInId,
            member: MemberId,
            userAgent: Schema.NullOr(Schema.String),
            signedInAt: Schema.Int,
            seenAt: Schema.Int,
            address: Schema.NullOr(Schema.String),
            country: Schema.NullOr(Schema.String),
          }),
          execute: (now) => sql`SELECT id, member, user_agent AS "userAgent", signed_in_at AS "signedInAt",
            seen_at AS "seenAt", address, country FROM members_sign_ins
            WHERE expires_at > ${now} ORDER BY seen_at DESC, id DESC`,
        })

        const projectsOf = (member: MemberId) =>
          findProjects(undefined).pipe(
            Effect.orDie,
            Effect.map((rows) => rows.filter((row) => row.member === member).map((row) => row.project)),
          )

        const memberOf = (row: MemberRow, projects: ReadonlyArray<ProjectKey>) =>
          new Member({
            id: row.id,
            role: row.role,
            ...(row.email === null ? {} : { email: row.email }),
            ...(row.role === "owner" ? {} : { projects }),
            addedAt: row.addedAt,
            passkeys: row.passkeys,
          })

        const member = Effect.fn("Members.member")(function* (id: MemberId) {
          const row = yield* findMember(id).pipe(Effect.orDie)
          if (Option.isNone(row)) {
            return yield* new MemberNotFound({ member: id })
          }
          return memberOf(row.value, yield* projectsOf(id))
        })

        const accessOf = Effect.fn("Members.accessOf")(function* (id: MemberId) {
          const found = yield* member(id)
          const access: Access =
            found.role === "owner" ? { _tag: "Everything" } : { _tag: "Projects", projects: found.projects ?? [] }
          return access
        })

        // The owner `actor` is, or `NotAllowed`.
        const owner = Effect.fn("Members.owner")(function* (actor: Actor) {
          if (actor._tag !== "Member") {
            return yield* new NotAllowed()
          }
          const row = yield* findMember(actor.id).pipe(Effect.orDie)
          if (Option.isNone(row) || row.value.role !== "owner") {
            return yield* new NotAllowed()
          }
          return actor.id
        })

        // Projects the deployment has, or `ProjectNotFound` for the first it doesn't.
        const existing = Effect.fn("Members.existing")(function* (projects: ReadonlyArray<ProjectKey>) {
          const known = new Set((yield* index.all).map((project) => project.key))
          const unknown = projects.find((project) => !known.has(project))
          if (unknown !== undefined) {
            return yield* new ProjectNotFound({ project: unknown })
          }
          return [...new Set(projects)].toSorted()
        })

        // Keeps the challenge of one ceremony's options, of `purpose` on `site`, about `subject`.
        const keepChallenge = Effect.fn("Members.keepChallenge")(function* (
          challenge: string,
          purpose: string,
          subject: string,
          site: Site,
        ) {
          const now = yield* nowMs
          yield* sql`DELETE FROM members_challenges WHERE expires_at <= ${now}`.pipe(Effect.orDie)
          yield* sql`INSERT INTO members_challenges ${sql.insert({
            challenge,
            purpose,
            subject,
            origin: site.origin,
            rp_id: site.rpId,
            expires_at: now + challengeLasts,
          })}`.pipe(Effect.orDie)
        })

        // The subject of the challenge a ceremony answers, used up; none when it isn't one of
        // `purpose` on `site`, or expired.
        const takeChallenge = Effect.fn("Members.takeChallenge")(function* (
          answer: RegistrationResponseJSON | AuthenticationResponseJSON,
          purpose: string,
          site: Site,
        ) {
          const challenge = yield* challengeOf(answer).pipe(Effect.option)
          if (Option.isNone(challenge)) {
            return Option.none<{ readonly challenge: string; readonly subject: string }>()
          }
          const now = yield* nowMs
          const rows = yield* sql`DELETE FROM members_challenges
            WHERE challenge = ${challenge.value} AND purpose = ${purpose} AND origin = ${site.origin}
              AND rp_id = ${site.rpId} AND expires_at > ${now}
            RETURNING subject`.pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(ChallengeRow))),
            Effect.orDie,
          )
          return Option.map(Option.fromNullishOr(rows[0]), (row) => ({
            challenge: challenge.value,
            subject: row.subject,
          }))
        })

        // A new sign-in for `member`: its token, kept only as a digest.
        const newSignIn = Effect.fn("Members.newSignIn")(function* (memberId: MemberId, caller: Caller) {
          const now = yield* nowMs
          const id = yield* crypto.randomUUIDv7().pipe(Effect.orDie)
          const token = SignInToken.make(`${signInPrefix}${id}.${yield* secret}`)
          yield* sql`DELETE FROM members_sign_ins WHERE expires_at <= ${now}`.pipe(Effect.orDie)
          yield* sql`INSERT INTO members_sign_ins ${sql.insert({
            id,
            digest: yield* digestOf(token),
            member: memberId,
            user_agent: caller.userAgent ?? null,
            signed_in_at: now,
            seen_at: now,
            address: caller.address ?? null,
            country: caller.country ?? null,
            expires_at: now + signInLasts,
          })}`.pipe(Effect.orDie)
          return Redacted.make(token)
        })

        const passkeyOptions = Effect.fn("Members.passkeyOptions")(function* (
          purpose: string,
          subject: MemberId,
          name: string,
          site: Site,
        ) {
          const excludeIds = (yield* findPasskeyIds({ member: subject, rpId: site.rpId }).pipe(Effect.orDie)).map(
            (row) => row.id,
          )
          const options = yield* registrationOptions({
            rp: { id: site.rpId, name: "Cluenori" },
            user: { id: userHandleOf(subject), name, displayName: name },
            excludeIds,
          }).pipe(Effect.provideService(Crypto.Crypto, crypto))
          yield* keepChallenge(options.challenge, purpose, subject, site)
          return options
        })

        const members = Effect.fn("Members.members")(function* (actor: Actor) {
          yield* owner(actor)
          const rows = yield* findMembers(undefined).pipe(Effect.orDie)
          const projects = yield* findProjects(undefined).pipe(Effect.orDie)
          const list: MemberList = {
            members: rows.map((row) =>
              memberOf(
                row,
                projects.filter((each) => each.member === row.id).map((each) => each.project),
              ),
            ),
          }
          return list
        })

        const invite = Effect.fn("Members.invite")(function* (actor: Actor, input: InviteMember, site: Site) {
          yield* owner(actor)
          const projects = yield* existing(input.projects)
          const taken = yield* sql`SELECT id FROM members_members WHERE email = ${input.email}`.pipe(Effect.orDie)
          if (taken.length > 0) {
            return yield* new MemberExists({ email: input.email })
          }
          const now = yield* nowMs
          const code = InviteCode.make(yield* secret)
          const digest = yield* digestOf(code)
          const encoded = yield* encodeProjects(projects).pipe(Effect.orDie)
          const expiresAt = now + inviteLasts
          yield* log.commit({
            source,
            actor,
            write: Effect.gen(function* () {
              yield* sql`DELETE FROM members_invites WHERE expires_at <= ${now}`
              yield* sql`DELETE FROM members_invites WHERE code_digest IN (
                SELECT code_digest FROM members_invites ORDER BY expires_at DESC LIMIT -1 OFFSET ${openInvites - 1})`
              yield* sql`INSERT INTO members_invites ${sql.insert({
                code_digest: digest,
                email: input.email,
                projects: encoded,
                expires_at: expiresAt,
              })}`
            }).pipe(Effect.orDie),
            activity: () => [{ payload: MemberInvited.make({ email: input.email, projects }) }],
          })
          const invitation: Invite = {
            link: `${site.origin}/invite#${code}`,
            expiresAt: DateTime.makeUnsafe(expiresAt),
          }
          return invitation
        })

        const openInvite = Effect.fn("Members.openInvite")(function* (code: InviteCode) {
          const digest = yield* digestOf(code)
          const found = yield* findInvite({ digest, now: yield* nowMs }).pipe(Effect.orDie)
          if (Option.isNone(found)) {
            return yield* new InviteRejected()
          }
          return { digest, ...found.value }
        })

        // The joining member's ID is made with the challenge, so their passkey names them from the start.
        const startJoining = Effect.fn("Members.startJoining")(function* (code: InviteCode, site: Site) {
          const invitation = yield* openInvite(code)
          const id = MemberId.make(yield* crypto.randomUUIDv7().pipe(Effect.orDie))
          return yield* passkeyOptions(`join:${invitation.digest}`, id, invitation.email, site)
        })

        const join = Effect.fn("Members.join")(function* (
          code: InviteCode,
          registration: RegistrationResponseJSON,
          site: Site,
          caller: Caller,
        ) {
          const invitation = yield* openInvite(code)
          const taken = yield* takeChallenge(registration, `join:${invitation.digest}`, site)
          if (Option.isNone(taken)) {
            return yield* rejectedPasskey({ reason: "No open challenge to join with" })
          }
          const id = MemberId.make(taken.value.subject)
          const passkey = yield* verifyRegistration(settings.crypto, registration, {
            challenge: taken.value.challenge,
            origins: [site.origin],
            rpId: site.rpId,
            userHandle: userHandleOf(id),
          }).pipe(Effect.catchTag("WebAuthnRejected", rejectedPasskey))
          const now = yield* DateTime.now
          const actor: Actor = { _tag: "Member", id }
          const projects = invitation.projects
          yield* log.commit({
            source,
            actor,
            write: Effect.gen(function* () {
              yield* sql`DELETE FROM members_invites WHERE code_digest = ${invitation.digest}`
              yield* sql`INSERT INTO members_members ${sql.insert({
                id,
                role: "member",
                email: invitation.email,
                added_at: DateTime.formatIso(now),
              })}`
              for (const project of projects) {
                yield* sql`INSERT INTO members_projects ${sql.insert({ member: id, project })}`
              }
              yield* sql`INSERT INTO members_passkeys ${sql.insert({
                id: passkey.id,
                member: id,
                rp_id: site.rpId,
                public_key: passkey.publicKey,
                sign_count: passkey.signCount,
                added_at: DateTime.toEpochMillis(now),
              })}`
            }).pipe(Effect.orDie),
            activity: () => [
              { payload: MemberJoined.make({ member: id, email: invitation.email }) },
              { payload: PasskeyAdded.make({ member: id }) },
            ],
          })
          const signedIn: SignedIn = {
            member: yield* member(id).pipe(Effect.orDie),
            signIn: yield* newSignIn(id, caller),
          }
          return signedIn
        })

        const startSignIn = Effect.fn("Members.startSignIn")(function* (site: Site) {
          const options = yield* authenticationOptions({ rpId: site.rpId }).pipe(
            Effect.provideService(Crypto.Crypto, crypto),
          )
          yield* keepChallenge(options.challenge, "sign-in", "", site)
          return options
        })

        const verifyPasskey = Effect.fn("Members.verifyPasskey")(function* (
          assertion: AuthenticationResponseJSON,
          site: Site,
        ) {
          const taken = yield* takeChallenge(assertion, "sign-in", site)
          const found = yield* findPasskey({ id: assertion.id, rpId: site.rpId }).pipe(Effect.orDie)
          if (Option.isNone(taken) || Option.isNone(found)) {
            return yield* rejectedPasskey({ reason: "No open challenge, or a passkey the deployment doesn't know" })
          }
          const passkey = found.value
          const checked = yield* verifyAuthentication(
            settings.crypto,
            assertion,
            { ...passkey, userHandle: userHandleOf(passkey.member) },
            { challenge: taken.value.challenge, origins: [site.origin], rpId: site.rpId },
          ).pipe(Effect.catchTag("WebAuthnRejected", rejectedPasskey))
          yield* sql`UPDATE members_passkeys SET sign_count = ${checked.signCount} WHERE id = ${passkey.id}`.pipe(
            Effect.orDie,
          )
          return yield* member(passkey.member).pipe(
            Effect.catchTag("MemberNotFound", () => Effect.fail(new PasskeyRejected())),
          )
        })

        const signIn = Effect.fn("Members.signIn")(function* (
          assertion: AuthenticationResponseJSON,
          site: Site,
          caller: Caller,
        ) {
          const signedInMember = yield* verifyPasskey(assertion, site)
          const signedIn: SignedIn = { member: signedInMember, signIn: yield* newSignIn(signedInMember.id, caller) }
          return signedIn
        })

        const signInRow = Effect.fn("Members.signInRow")(function* (token: Redacted.Redacted<SignInToken>) {
          const presented = Redacted.value(token)
          const id = presented.slice(signInPrefix.length, signInPrefix.length + 36)
          const found = yield* findSignIn({ id, now: yield* nowMs }).pipe(Effect.orDie)
          // Both sides are digests, so comparing them in ordinary time reveals nothing about a token.
          if (Option.isNone(found) || found.value.digest !== (yield* digestOf(presented))) {
            return Option.none<SignInRow>()
          }
          const row: SignInRow = {
            id,
            member: found.value.member,
            seenAt: found.value.seenAt,
            address: found.value.address,
          }
          return Option.some(row)
        })

        const signedIn = Effect.fn("Members.signedIn")(function* (
          token: Redacted.Redacted<SignInToken>,
          caller: Caller,
        ) {
          const row = yield* signInRow(token)
          if (Option.isNone(row)) {
            return yield* new SignInRejected()
          }
          const now = yield* nowMs
          if (now - row.value.seenAt >= seenEvery || row.value.address !== (caller.address ?? null)) {
            yield* sql`UPDATE members_sign_ins SET seen_at = ${now}, address = ${caller.address ?? null},
              country = ${caller.country ?? null} WHERE id = ${row.value.id}`.pipe(Effect.orDie)
          }
          const access = yield* accessOf(row.value.member).pipe(
            Effect.catchTag("MemberNotFound", () => Effect.fail(new SignInRejected())),
          )
          return { member: row.value.member, access }
        })

        const signOut = Effect.fn("Members.signOut")(function* (token: Redacted.Redacted<SignInToken>) {
          const row = yield* signInRow(token)
          if (Option.isSome(row)) {
            yield* sql`DELETE FROM members_sign_ins WHERE id = ${row.value.id}`.pipe(Effect.orDie)
          }
        })

        const signIns = Effect.fn("Members.signIns")(function* (actor: Actor, current: SignInId | undefined) {
          const isOwner = Option.isSome(yield* owner(actor).pipe(Effect.option))
          const rows = yield* findSignIns(yield* nowMs).pipe(Effect.orDie)
          const list: SignInList = {
            signIns: rows
              .filter((row) => isOwner || (actor._tag === "Member" && row.member === actor.id))
              .map((row) => {
                const browser = browserOf(row.userAgent ?? undefined)
                return new SignIn({
                  id: row.id,
                  member: row.member,
                  ...(browser === undefined ? {} : { browser }),
                  signedInAt: DateTime.makeUnsafe(row.signedInAt),
                  seenAt: DateTime.makeUnsafe(row.seenAt),
                  ...(row.address === null ? {} : { address: row.address }),
                  ...(row.country === null ? {} : { country: row.country }),
                  current: row.id === current,
                })
              }),
          }
          return list
        })

        const endSignIn = Effect.fn("Members.endSignIn")(function* (actor: Actor, id: SignInId) {
          const isOwner = Option.isSome(yield* owner(actor).pipe(Effect.option))
          const own = actor._tag === "Member" ? actor.id : ""
          const ended = yield* (
            isOwner
              ? sql`DELETE FROM members_sign_ins WHERE id = ${id} RETURNING id`
              : sql`DELETE FROM members_sign_ins WHERE id = ${id} AND member = ${own} RETURNING id`
          ).pipe(Effect.orDie)
          if (ended.length === 0) {
            return yield* new SignInNotFound({ signIn: id })
          }
        })

        const signedInMember = Effect.fn("Members.signedInMember")(function* (actor: Actor) {
          if (actor._tag !== "Member") {
            return yield* new NotAllowed()
          }
          return yield* member(actor.id).pipe(Effect.catchTag("MemberNotFound", () => Effect.fail(new NotAllowed())))
        })

        const startAddingPasskey = Effect.fn("Members.startAddingPasskey")(function* (actor: Actor, site: Site) {
          const found = yield* signedInMember(actor)
          return yield* passkeyOptions(`add:${found.id}`, found.id, found.email ?? "Owner", site)
        })

        const addPasskey = Effect.fn("Members.addPasskey")(function* (
          actor: Actor,
          registration: RegistrationResponseJSON,
          site: Site,
        ) {
          const found = yield* signedInMember(actor)
          const taken = yield* takeChallenge(registration, `add:${found.id}`, site)
          if (Option.isNone(taken)) {
            return yield* rejectedPasskey({ reason: "No open challenge to add a passkey with" })
          }
          const passkey = yield* verifyRegistration(settings.crypto, registration, {
            challenge: taken.value.challenge,
            origins: [site.origin],
            rpId: site.rpId,
            userHandle: userHandleOf(found.id),
          }).pipe(Effect.catchTag("WebAuthnRejected", rejectedPasskey))
          const now = yield* nowMs
          yield* log.commit({
            source,
            actor,
            write: sql`INSERT INTO members_passkeys ${sql.insert({
              id: passkey.id,
              member: found.id,
              rp_id: site.rpId,
              public_key: passkey.publicKey,
              sign_count: passkey.signCount,
              added_at: now,
            })}`.pipe(Effect.orDie),
            activity: () => [{ payload: PasskeyAdded.make({ member: found.id }) }],
          })
        })

        // The member `id` names, when a member, not an owner.
        const memberNotOwner = Effect.fn("Members.memberNotOwner")(function* (id: MemberId) {
          const found = yield* member(id)
          if (found.role === "owner") {
            return yield* new NotAllowed()
          }
          return found
        })

        const setProjects = Effect.fn("Members.setProjects")(function* (
          actor: Actor,
          id: MemberId,
          asked: ReadonlyArray<ProjectKey>,
        ) {
          yield* owner(actor)
          yield* memberNotOwner(id)
          const projects = yield* existing(asked)
          yield* log.commit({
            source,
            actor,
            write: Effect.gen(function* () {
              yield* sql`DELETE FROM members_projects WHERE member = ${id}`
              for (const project of projects) {
                yield* sql`INSERT INTO members_projects ${sql.insert({ member: id, project })}`
              }
            }).pipe(Effect.orDie),
            activity: () => [{ payload: MemberProjectsChanged.make({ member: id, projects }) }],
          })
          return yield* member(id)
        })

        const remove = Effect.fn("Members.remove")(function* (actor: Actor, id: MemberId) {
          yield* owner(actor)
          yield* memberNotOwner(id)
          yield* log.commit({
            source,
            actor,
            write: Effect.gen(function* () {
              yield* sql`DELETE FROM members_members WHERE id = ${id}`
              yield* sql`DELETE FROM members_projects WHERE member = ${id}`
              yield* sql`DELETE FROM members_passkeys WHERE member = ${id}`
              yield* sql`DELETE FROM members_sign_ins WHERE member = ${id}`
            }).pipe(Effect.orDie),
            activity: () => [{ payload: MemberRemoved.make({ member: id }) }],
          })
        })

        return Members.of({
          accessOf,
          member,
          members,
          invite,
          startJoining,
          join,
          startSignIn,
          signIn,
          verifyPasskey,
          signedIn,
          signOut,
          signIns,
          endSignIn,
          startAddingPasskey,
          addPasskey,
          setProjects,
          remove,
        })
      }),
    )
}
