import { softwareAuthenticator } from "@bagatka/webauthn"
import type { Actor, Caller } from "@cluenori/foundation"
import { ProjectKey } from "@cluenori/foundation"
import { GitHub, GitHubRefused, Repository } from "@cluenori/github"
import { Email, InviteCode, Members } from "@cluenori/members"
import { AppVersion, ModelIdentifier, PairingCode, Phones, PushToken, SystemVersion } from "@cluenori/phones"
import { ProjectIndex, ProjectName } from "@cluenori/projects"
import { assert, describe, it } from "@effect/vitest"
import { DateTime, Effect, Layer, Option, Redacted, Schema } from "effect"
import { TestClock } from "effect/testing"

import type { WatcherSettings } from "../src/index.ts"
import { Watcher } from "../src/index.ts"
import { inWorkspace, owner } from "./in-workspace.ts"

// 2026-10-27T10:00:00Z.
const start = 1793095200000
const minute = 60_000
const repository = Repository.make("octo-org/watch")
const ownerActor: Actor = { _tag: "Member", id: owner }
const home: Caller = { address: "203.0.113.7", country: "PL", userAgent: "Cluenori/1.0 (1) iOS/27.0" }
const ownerToken = "a1".repeat(32)
const memberToken = "b2".repeat(32)
const pem = "-----BEGIN PRIVATE KEY-----\nMIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg\n-----END PRIVATE KEY-----\n"
const settings: WatcherSettings = {
  push: Option.some({
    key: Redacted.make(pem),
    keyId: "ABCDE12345",
    teamId: "TEAM123456",
    topic: "com.example.cluenori",
  }),
}

const PhonesSecret = Schema.Struct({
  writtenAt: Schema.String,
  phones: Schema.Array(Schema.Struct({ token: Schema.String, environment: Schema.String })),
})
const KeySecret = Schema.Struct({
  keyId: Schema.String,
  teamId: Schema.String,
  topic: Schema.String,
  key: Schema.String,
})

const unused = () => Effect.die("Only secrets are written in these tests")

/**
 * A fake GitHub that keeps each secret written, by repository and name, and refuses while
 * `refusing` is set, as GitHub does an app without Secrets: write. Sealing is `@cluenori/github`'s.
 */
const fakeGitHub = () => {
  const written: Array<{ readonly repository: string; readonly name: string; readonly value: string }> = []
  const state = { refusing: false }
  const layer = Layer.succeed(
    GitHub,
    GitHub.of({
      tagsContaining: unused,
      commit: unused,
      compare: unused,
      pullRequest: unused,
      publishRelease: unused,
      defaultBranch: unused,
      dispatchWorkflow: unused,
      workflowRuns: unused,
      workflowRun: unused,
      selfHostedRunners: unused,
      setActionsSecret: (forRepository, name, value) =>
        state.refusing
          ? Effect.fail(
              new GitHubRefused({
                status: 403,
                reason: `${forRepository}'s Actions secrets can't be written: the token lacks Secrets: write there`,
              }),
            )
          : Effect.sync(() => {
              written.push({ repository: forRepository, name, value: Redacted.value(value) })
            }),
    }),
  )
  return { written, state, layer }
}

// Pairs a phone for `actor`, which registers `token`; returns its ID.
const phoneWith = (token: string, actor: Actor) =>
  Effect.gen(function* () {
    const phones = yield* Phones
    const pairing = yield* phones.startPairing(actor, "https://cluenori.example")
    const { phone, key } = yield* phones.pair(
      {
        code: PairingCode.make(new URL(pairing.link).searchParams.get("code") ?? ""),
        model: ModelIdentifier.make("iPhone19,3"),
        systemVersion: SystemVersion.make("27.0"),
        appVersion: AppVersion.make("1.0 (1)"),
      },
      home,
    )
    yield* phones.registerPush(key, home, { token: PushToken.make(token), environment: "production" })
    return phone.id
  })

// Ada joins, seeing Atlas alone, and turns notifications on on her phone.
const memberWithPhone = Effect.gen(function* () {
  const index = yield* ProjectIndex
  const atlas = ProjectKey.make("atlas")
  yield* index.record({ key: atlas, name: ProjectName.make("Atlas"), createdAt: DateTime.makeUnsafe(start) })
  const members = yield* Members
  const site = { origin: "https://cluenori.example", rpId: "cluenori.example" }
  const invite = yield* members.invite(ownerActor, { email: Email.make("ada@example.com"), projects: [atlas] }, site)
  const code = InviteCode.make(new URL(invite.link).hash.slice(1))
  const options = yield* members.startJoining(code, site)
  const device = yield* softwareAuthenticator(crypto)
  const joined = yield* members.join(
    code,
    yield* device.register({ ...site, challenge: options.challenge }, { userHandle: options.user.id }),
    site,
    home,
  )
  yield* phoneWith(memberToken, { _tag: "Member", id: joined.member.id })
})

const phonesIn = (value: string) =>
  Schema.decodeEffect(Schema.fromJsonString(PhonesSecret))(value).pipe(
    Effect.map((list) => list.phones.map((phone) => phone.token)),
    Effect.orDie,
  )

describe("Watcher", () => {
  it.effect("writes the key and only owners' tokens, again only when they change", () =>
    Effect.gen(function* () {
      const github = fakeGitHub()
      yield* inWorkspace(
        "writes-owners",
        start,
        settings,
        github.layer,
        Effect.gen(function* () {
          const watcher = yield* Watcher
          const phone = yield* phoneWith(ownerToken, ownerActor)
          yield* memberWithPhone
          // Nothing before an owner names the repository.
          yield* watcher.sync
          assert.strictEqual(github.written.length, 0)

          const status = yield* watcher.setRepository(ownerActor, { _tag: "Everything" }, repository)
          assert.deepStrictEqual(
            github.written.map((each) => `${each.repository} ${each.name}`),
            ["octo-org/watch CLUENORI_APNS_KEY", "octo-org/watch CLUENORI_PHONES"],
          )
          const key = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(KeySecret))(github.written[0]?.value)
          assert.deepStrictEqual(key, {
            keyId: "ABCDE12345",
            teamId: "TEAM123456",
            topic: "com.example.cluenori",
            key: pem,
          })
          assert.deepStrictEqual(yield* phonesIn(github.written[1]?.value ?? ""), [ownerToken])
          assert.strictEqual(status.phones, 1)
          assert.isUndefined(status.problem)

          // Nothing changed: nothing written.
          yield* TestClock.adjust(minute)
          yield* watcher.sync
          assert.strictEqual(github.written.length, 2)

          // The owner's phone is removed: the phones are written again, empty; the key isn't.
          const phones = yield* Phones
          yield* phones.remove(ownerActor, phone)
          yield* watcher.sync
          assert.deepStrictEqual(
            github.written.map((each) => each.name),
            ["CLUENORI_APNS_KEY", "CLUENORI_PHONES", "CLUENORI_PHONES"],
          )
          assert.deepStrictEqual(yield* phonesIn(github.written[2]?.value ?? ""), [])
        }),
      )
    }),
  )

  it.effect("keeps a refusal in the status, and asks GitHub again only after 5 minutes", () =>
    Effect.gen(function* () {
      const github = fakeGitHub()
      github.state.refusing = true
      yield* inWorkspace(
        "refused",
        start,
        settings,
        github.layer,
        Effect.gen(function* () {
          const watcher = yield* Watcher
          yield* phoneWith(ownerToken, ownerActor)
          const status = yield* watcher.setRepository(ownerActor, { _tag: "Everything" }, repository)
          assert.include(status.problem ?? "", "lacks Secrets: write")
          assert.notInclude(status.problem ?? "", ownerToken)
          github.state.refusing = false
          yield* TestClock.adjust(4 * minute)
          yield* watcher.sync
          assert.strictEqual(github.written.length, 0)
          yield* TestClock.adjust(2 * minute)
          yield* watcher.sync
          assert.strictEqual(github.written.length, 2)
          const after = yield* watcher.status({ _tag: "Everything" })
          assert.isUndefined(after.problem)
          assert.strictEqual(after.phones, 1)
        }),
      )
    }),
  )

  it.effect("lets only an owner name the repository or see it", () =>
    Effect.gen(function* () {
      const github = fakeGitHub()
      yield* inWorkspace(
        "owners-only",
        start,
        settings,
        github.layer,
        Effect.gen(function* () {
          const watcher = yield* Watcher
          const someone: Actor = { _tag: "Member", id: owner }
          const refused = yield* watcher
            .setRepository(someone, { _tag: "Projects", projects: [] }, repository)
            .pipe(Effect.flip)
          assert.strictEqual(refused._tag, "NotAllowed")
          const hidden = yield* watcher.status({ _tag: "Projects", projects: [] }).pipe(Effect.flip)
          assert.strictEqual(hidden._tag, "NotAllowed")
          assert.strictEqual(github.written.length, 0)
        }),
      )
    }),
  )
})
