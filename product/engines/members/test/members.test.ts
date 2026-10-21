import type { SoftwareAuthenticator } from "@bagatka/webauthn"
import { softwareAuthenticator } from "@bagatka/webauthn"
import type { Actor, Caller } from "@cluenori/foundation"
import { ActivityLog, MemberId, ProjectKey } from "@cluenori/foundation"
import { ProjectIndex, ProjectName } from "@cluenori/projects"
import { assert, describe, it } from "@effect/vitest"
import { DateTime, Effect, Redacted } from "effect"
import { TestClock } from "effect/testing"

import type { Site } from "../src/index.ts"
import { canSee, Email, InviteCode, Members, SignInId } from "../src/index.ts"
import { inWorkspace } from "./in-workspace.ts"

// 2026-10-21T10:00:00Z.
const start = 1792576800000
const day = 86_400_000

const ownerId = MemberId.make("0199f7a2-5c1e-7d3a-9b2f-4e8a1c6d0f53")
const owner: Actor = { _tag: "Member", id: ownerId }
const site: Site = { origin: "https://cluenori.example", rpId: "cluenori.example" }
const notes = ProjectKey.make("notes")
const atlas = ProjectKey.make("atlas")
const ada = Email.make("ada@example.com")

// Where the browsers call from, as Cloudflare and they say.
const macSafari: Caller = {
  address: "203.0.113.7",
  country: "PL",
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15",
}
const iPhoneChrome: Caller = {
  address: "198.51.100.4",
  country: "DE",
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0 Mobile/15E148 Safari/604.1",
}

const withProjects = Effect.gen(function* () {
  const index = yield* ProjectIndex
  for (const key of [notes, atlas]) {
    yield* index.record({ key, name: ProjectName.make(key), createdAt: DateTime.makeUnsafe(start - day) })
  }
})

// The code of an invitation's link.
const codeOf = (link: string) => InviteCode.make(new URL(link).hash.slice(1))

// Ada, invited to Notes, joins with a passkey on their device.
const adaJoins = Effect.gen(function* () {
  const members = yield* Members
  const device = yield* softwareAuthenticator(crypto)
  const invite = yield* members.invite(owner, { email: ada, projects: [notes] }, site)
  const code = codeOf(invite.link)
  const options = yield* members.startJoining(code, site)
  const registration = yield* device.register({ challenge: options.challenge, ...site })
  const joined = yield* members.join(code, registration, site, macSafari)
  return { device, code, joined }
})

const signInWith = (device: SoftwareAuthenticator) =>
  Effect.gen(function* () {
    const members = yield* Members
    const options = yield* members.startSignIn(site)
    return yield* members.signIn(yield* device.sign({ challenge: options.challenge, ...site }), site, iPhoneChrome)
  })

describe("Members", () => {
  it.effect(
    "invites a member to a project, who joins with a passkey, sees that project alone, and signs in again",
    () =>
      inWorkspace(
        "joins",
        start,
        ownerId,
        Effect.gen(function* () {
          const members = yield* Members
          yield* withProjects
          const { device, code, joined } = yield* adaJoins
          assert.deepStrictEqual(
            [joined.member.role, joined.member.email, joined.member.projects, joined.member.passkeys],
            ["member", ada, [notes], 1],
          )

          const first = yield* members.signedIn(joined.signIn, macSafari)
          assert.strictEqual(first.member, joined.member.id)
          assert.isTrue(canSee(first.access, notes))
          assert.isFalse(canSee(first.access, atlas))
          assert.strictEqual((yield* members.startJoining(code, site).pipe(Effect.flip))._tag, "InviteRejected")

          const again = yield* signInWith(device)
          assert.strictEqual(again.member.id, joined.member.id)
          yield* members.signOut(again.signIn)
          assert.strictEqual(
            (yield* members.signedIn(again.signIn, macSafari).pipe(Effect.flip))._tag,
            "SignInRejected",
          )
          // The first browser stays signed in.
          yield* members.signedIn(joined.signIn, macSafari)

          const log = yield* ActivityLog
          assert.deepStrictEqual(
            (yield* log.latest).map((entry) => entry.name),
            ["passkey.added", "member.joined", "member.invited"],
          )
        }),
      ),
  )

  it.effect("lets only an owner invite, list, change who sees what, and remove", () =>
    inWorkspace(
      "owners",
      start,
      ownerId,
      Effect.gen(function* () {
        const members = yield* Members
        yield* withProjects
        const { joined } = yield* adaJoins
        const member: Actor = { _tag: "Member", id: joined.member.id }

        const refused = [
          yield* members
            .invite(member, { email: Email.make("bob@example.com"), projects: [notes] }, site)
            .pipe(Effect.flip),
          yield* members.members(member).pipe(Effect.flip),
          yield* members.setProjects(member, joined.member.id, [atlas]).pipe(Effect.flip),
          yield* members.remove(owner, ownerId).pipe(Effect.flip),
          yield* members.invite(owner, { email: ada, projects: [notes] }, site).pipe(Effect.flip),
          yield* members
            .invite(owner, { email: Email.make("bob@example.com"), projects: [ProjectKey.make("graph")] }, site)
            .pipe(Effect.flip),
        ]
        assert.deepStrictEqual(
          refused.map((error) => error._tag),
          ["NotAllowed", "NotAllowed", "NotAllowed", "NotAllowed", "MemberExists", "ProjectNotFound"],
        )

        const moved = yield* members.setProjects(owner, joined.member.id, [atlas, notes, atlas])
        assert.deepStrictEqual(moved.projects, [atlas, notes])
        assert.deepStrictEqual(
          (yield* members.members(owner)).members.map((each) => [each.role, each.email ?? "", each.projects ?? []]),
          [
            ["owner", "", []],
            ["member", ada, [atlas, notes]],
          ],
        )
        assert.strictEqual((yield* members.accessOf(ownerId))._tag, "Everything")

        yield* members.remove(owner, joined.member.id)
        assert.strictEqual((yield* members.signedIn(joined.signIn, macSafari).pipe(Effect.flip))._tag, "SignInRejected")
        assert.strictEqual((yield* members.accessOf(joined.member.id).pipe(Effect.flip))._tag, "MemberNotFound")
      }),
    ),
  )

  it.effect("refuses a passkey for another page, a challenge used twice, and an invitation 7 days on", () =>
    inWorkspace(
      "refuses",
      start,
      ownerId,
      Effect.gen(function* () {
        const members = yield* Members
        yield* withProjects
        const device = yield* softwareAuthenticator(crypto)
        const invite = yield* members.invite(owner, { email: ada, projects: [notes] }, site)
        const code = codeOf(invite.link)

        const options = yield* members.startJoining(code, site)
        const elsewhere = yield* device.register({
          ...site,
          challenge: options.challenge,
          origin: "https://evil.example",
        })
        assert.strictEqual(
          (yield* members.join(code, elsewhere, site, macSafari).pipe(Effect.flip))._tag,
          "PasskeyRejected",
        )
        // The invitation is still open, and its next ceremony works.
        const retry = yield* members.startJoining(code, site)
        const joined = yield* members.join(
          code,
          yield* device.register({ ...site, challenge: retry.challenge }),
          site,
          macSafari,
        )

        const signIn = yield* members.startSignIn(site)
        const assertion = yield* device.sign({ ...site, challenge: signIn.challenge })
        yield* members.signIn(assertion, site, macSafari)
        assert.strictEqual(
          (yield* members.signIn(assertion, site, macSafari).pipe(Effect.flip))._tag,
          "PasskeyRejected",
        )
        const stranger = yield* softwareAuthenticator(crypto)
        const other = yield* members.startSignIn(site)
        const unknown = yield* stranger.sign({ ...site, challenge: other.challenge })
        assert.strictEqual((yield* members.signIn(unknown, site, macSafari).pipe(Effect.flip))._tag, "PasskeyRejected")

        const late = yield* members.invite(owner, { email: Email.make("bob@example.com"), projects: [atlas] }, site)
        yield* TestClock.adjust(7 * day + 1)
        assert.strictEqual(
          (yield* members.startJoining(codeOf(late.link), site).pipe(Effect.flip))._tag,
          "InviteRejected",
        )
        // A sign-in lasts 30 days.
        yield* members.signedIn(joined.signIn, macSafari)
        yield* TestClock.adjust(23 * day)
        assert.strictEqual((yield* members.signedIn(joined.signIn, macSafari).pipe(Effect.flip))._tag, "SignInRejected")
      }),
    ),
  )

  it.effect("adds a passkey for the owner, who then signs in with it and sees everything", () =>
    inWorkspace(
      "adds",
      start,
      ownerId,
      Effect.gen(function* () {
        const members = yield* Members
        const device = yield* softwareAuthenticator(crypto)
        const options = yield* members.startAddingPasskey(owner, site)
        assert.strictEqual(options.user.name, "Owner")
        yield* members.addPasskey(owner, yield* device.register({ ...site, challenge: options.challenge }), site)

        const signedIn = yield* signInWith(device)
        assert.deepStrictEqual(
          [signedIn.member.id, signedIn.member.role, signedIn.member.passkeys],
          [ownerId, "owner", 1],
        )
        assert.strictEqual((yield* members.signedIn(signedIn.signIn, macSafari)).access._tag, "Everything")
      }),
    ),
  )

  it.effect("lists the browsers signed in, what and where each is, and signs one out", () =>
    inWorkspace(
      "sign-ins",
      start,
      ownerId,
      Effect.gen(function* () {
        const members = yield* Members
        yield* withProjects
        const { device, joined } = yield* adaJoins
        const adaActor: Actor = { _tag: "Member", id: joined.member.id }
        yield* TestClock.adjust(60_000)
        const phone = yield* signInWith(device)
        const current = SignInId.make(Redacted.value(phone.signIn).split(".")[2] ?? "")

        const listed = yield* members.signIns(adaActor, current)
        assert.deepStrictEqual(
          listed.signIns.map((each) => [each.browser, each.address, each.country, each.current]),
          [
            ["Chrome on iPhone", "198.51.100.4", "DE", true],
            ["Safari on macOS", "203.0.113.7", "PL", false],
          ],
        )
        // A call from another address is recorded at once.
        yield* members.signedIn(joined.signIn, iPhoneChrome)
        assert.strictEqual((yield* members.signIns(owner, undefined)).signIns[0]?.address, "198.51.100.4")

        const mac = listed.signIns[1]?.id ?? current
        assert.strictEqual(
          (yield* members
            .endSignIn({ _tag: "Member", id: MemberId.make("0199f7a2-5c1e-7d3a-9b2f-4e8a1c6d0f54") }, mac)
            .pipe(Effect.flip))._tag,
          "SignInNotFound",
        )
        yield* members.endSignIn(owner, mac)
        assert.strictEqual((yield* members.signedIn(joined.signIn, macSafari).pipe(Effect.flip))._tag, "SignInRejected")
        assert.deepStrictEqual(
          (yield* members.signIns(adaActor, current)).signIns.map((each) => each.id),
          [current],
        )
      }),
    ),
  )
})
