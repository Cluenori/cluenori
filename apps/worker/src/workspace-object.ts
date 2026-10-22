import { webCryptoLayer } from "@bagatka/web-crypto"
import type { Actor } from "@cluenori/foundation"
import { ActivityLog, MemberId, WorkspaceKey } from "@cluenori/foundation"
import { GitHubConnection } from "@cluenori/github"
import type { Access } from "@cluenori/members"
import { Members } from "@cluenori/members"
import { NoPushToken, Notifications } from "@cluenori/notifications"
import type { PhoneId } from "@cluenori/phones"
import { PhoneKeyRejected, PhoneNotFound, Phones } from "@cluenori/phones"
import { ProjectIndex } from "@cluenori/projects"
import { SqliteClient } from "@effect/sql-sqlite-do"
import { DurableObject } from "cloudflare:workers"
import { Config, ConfigProvider, Effect, Layer, ManagedRuntime, Option, Redacted } from "effect"
import { FetchHttpClient } from "effect/http"

import { serve } from "./object-calls.ts"
import { SyncScheduler } from "./sync-scheduler.ts"
import type { WorkspaceCallName } from "./workspace-calls.ts"
import { workspaceCalls } from "./workspace-calls.ts"

type WorkspaceServices = ProjectIndex | Phones | Notifications | Members | GitHubConnection

// The owner `./setup` made; the API token stands for them (PATTERNS.md, "Configuration").
const ownerSetting = Config.option(Config.schema(MemberId, "CLUENORI_OWNER"))

// Whether a member may act on a phone: an owner on any, a member on their own.
const mayUsePhone = Effect.fn("mayUsePhone")(function* (actor: Actor, access: Access, phone: PhoneId) {
  if (access._tag === "Everything") {
    return true
  }
  const phones = yield* Phones
  const found = (yield* phones.phones).phones.find((each) => each.id === phone)
  return found !== undefined && actor._tag === "Member" && found.member === actor.id
})

// APNs's key, its IDs, and the app's bundle ID, which `./cluenori push setup` sets as secrets;
// without them nothing is pushed (PATTERNS.md, "Configuration").
const pushSettings = Config.option(
  Config.all({
    key: Config.Redacted("CLUENORI_APNS_KEY"),
    keyId: Config.String("CLUENORI_APNS_KEY_ID"),
    teamId: Config.String("CLUENORI_APNS_TEAM_ID"),
    topic: Config.String("CLUENORI_APNS_TOPIC"),
  }),
)

// Each call the Worker can make, on a visible line, translated to the engines' services.
const servedCalls: Readonly<
  Record<WorkspaceCallName, (input: string) => Effect.Effect<string, never, WorkspaceServices>>
> = {
  recordProject: serve(workspaceCalls.recordProject, (project) =>
    Effect.gen(function* () {
      const index = yield* ProjectIndex
      yield* index.record(project)
    }),
  ),
  projects: serve(workspaceCalls.projects, () =>
    Effect.gen(function* () {
      const index = yield* ProjectIndex
      return { projects: yield* index.all }
    }),
  ),
  phones: serve(workspaceCalls.phones, () =>
    Effect.gen(function* () {
      const phones = yield* Phones
      return yield* phones.phones
    }),
  ),
  startPairing: serve(workspaceCalls.startPairing, ({ actor, deployment }) =>
    Effect.gen(function* () {
      const phones = yield* Phones
      return yield* phones.startPairing(actor, deployment)
    }),
  ),
  pair: serve(workspaceCalls.pair, ({ phone, caller }) =>
    Effect.gen(function* () {
      const phones = yield* Phones
      const paired = yield* phones.pair(phone, caller)
      return { phone: paired.phone, key: Redacted.value(paired.key) }
    }),
  ),
  // A phone of a removed member acts for no one.
  authenticatePhone: serve(workspaceCalls.authenticatePhone, ({ key, caller }) =>
    Effect.gen(function* () {
      const phones = yield* Phones
      const members = yield* Members
      const actor = yield* phones.authenticate(Redacted.make(key), caller)
      if (actor._tag !== "Member") {
        return yield* new PhoneKeyRejected()
      }
      const access = yield* members
        .accessOf(actor.id)
        .pipe(Effect.catchTag("MemberNotFound", () => Effect.fail(new PhoneKeyRejected())))
      return { actor, access }
    }),
  ),
  removePhone: serve(workspaceCalls.removePhone, ({ actor, access, phone }) =>
    Effect.gen(function* () {
      const phones = yield* Phones
      if (!(yield* mayUsePhone(actor, access, phone))) {
        return yield* new PhoneNotFound({ phone })
      }
      yield* phones.remove(actor, phone)
    }),
  ),
  registerPush: serve(workspaceCalls.registerPush, ({ key, caller, push }) =>
    Effect.gen(function* () {
      const phones = yield* Phones
      yield* phones.registerPush(Redacted.make(key), caller, push)
    }),
  ),
  notify: serve(workspaceCalls.notify, (activity) =>
    Effect.gen(function* () {
      const notifications = yield* Notifications
      yield* notifications.notify(activity)
    }),
  ),
  testAlert: serve(workspaceCalls.testAlert, ({ actor, access, phone }) =>
    Effect.gen(function* () {
      const notifications = yield* Notifications
      if (!(yield* mayUsePhone(actor, access, phone))) {
        return yield* new NoPushToken({ phone })
      }
      yield* notifications.testAlert(phone)
    }),
  ),
  signedIn: serve(workspaceCalls.signedIn, ({ token, caller }) =>
    Effect.gen(function* () {
      const members = yield* Members
      const { member, access } = yield* members.signedIn(Redacted.make(token), caller)
      const actor: Actor = { _tag: "Member", id: member }
      return { actor, access }
    }),
  ),
  signOut: serve(workspaceCalls.signOut, (token) =>
    Effect.gen(function* () {
      const members = yield* Members
      yield* members.signOut(Redacted.make(token))
    }),
  ),
  signIns: serve(workspaceCalls.signIns, ({ actor, current }) =>
    Effect.gen(function* () {
      const members = yield* Members
      return yield* members.signIns(actor, current)
    }),
  ),
  endSignIn: serve(workspaceCalls.endSignIn, ({ actor, signIn }) =>
    Effect.gen(function* () {
      const members = yield* Members
      yield* members.endSignIn(actor, signIn)
    }),
  ),
  me: serve(workspaceCalls.me, (member) =>
    Effect.gen(function* () {
      const members = yield* Members
      return yield* members.member(member)
    }),
  ),
  members: serve(workspaceCalls.members, (actor) =>
    Effect.gen(function* () {
      const members = yield* Members
      return yield* members.members(actor)
    }),
  ),
  invite: serve(workspaceCalls.invite, ({ actor, invite, site }) =>
    Effect.gen(function* () {
      const members = yield* Members
      return yield* members.invite(actor, invite, site)
    }),
  ),
  setProjects: serve(workspaceCalls.setProjects, ({ actor, member, projects }) =>
    Effect.gen(function* () {
      const members = yield* Members
      return yield* members.setProjects(actor, member, projects)
    }),
  ),
  removeMember: serve(workspaceCalls.removeMember, ({ actor, member }) =>
    Effect.gen(function* () {
      const members = yield* Members
      const phones = yield* Phones
      yield* members.remove(actor, member)
      yield* phones.removeAllOf(actor, member)
    }),
  ),
  joinOptions: serve(workspaceCalls.joinOptions, ({ code, site }) =>
    Effect.gen(function* () {
      const members = yield* Members
      return yield* members.startJoining(code, site)
    }),
  ),
  join: serve(workspaceCalls.join, ({ code, registration, site, caller }) =>
    Effect.gen(function* () {
      const members = yield* Members
      const joined = yield* members.join(code, registration, site, caller)
      return { member: joined.member, signIn: Redacted.value(joined.signIn) }
    }),
  ),
  signInOptions: serve(workspaceCalls.signInOptions, (site) =>
    Effect.gen(function* () {
      const members = yield* Members
      return yield* members.startSignIn(site)
    }),
  ),
  signIn: serve(workspaceCalls.signIn, ({ assertion, site, caller }) =>
    Effect.gen(function* () {
      const members = yield* Members
      const signedIn = yield* members.signIn(assertion, site, caller)
      return { member: signedIn.member, signIn: Redacted.value(signedIn.signIn) }
    }),
  ),
  passkeyOptions: serve(workspaceCalls.passkeyOptions, ({ actor, site }) =>
    Effect.gen(function* () {
      const members = yield* Members
      return yield* members.startAddingPasskey(actor, site)
    }),
  ),
  pairWithPasskey: serve(workspaceCalls.pairWithPasskey, ({ assertion, phone, site, caller }) =>
    Effect.gen(function* () {
      const members = yield* Members
      const phones = yield* Phones
      const member = yield* members.verifyPasskey(assertion, site)
      const paired = yield* phones.pairFor({ _tag: "Member", id: member.id }, phone, caller)
      return { phone: paired.phone, key: Redacted.value(paired.key) }
    }),
  ),
  addPasskey: serve(workspaceCalls.addPasskey, ({ actor, registration, site }) =>
    Effect.gen(function* () {
      const members = yield* Members
      yield* members.addPasskey(actor, registration, site)
    }),
  ),
  github: serve(workspaceCalls.github, (access) =>
    Effect.gen(function* () {
      const github = yield* GitHubConnection
      return yield* github.status(access)
    }),
  ),
  connectGitHub: serve(workspaceCalls.connectGitHub, ({ actor, access, deployment, organization }) =>
    Effect.gen(function* () {
      const github = yield* GitHubConnection
      return yield* github.startConnecting(actor, access, deployment, organization)
    }),
  ),
  finishConnectingGitHub: serve(workspaceCalls.finishConnectingGitHub, ({ code, state }) =>
    Effect.gen(function* () {
      const github = yield* GitHubConnection
      return yield* github.finishConnecting(code, state)
    }),
  ),
  disconnectGitHub: serve(workspaceCalls.disconnectGitHub, ({ actor, access }) =>
    Effect.gen(function* () {
      const github = yield* GitHubConnection
      yield* github.disconnect(actor, access)
    }),
  ),
  gitHubToken: serve(workspaceCalls.gitHubToken, (repository) =>
    Effect.gen(function* () {
      const github = yield* GitHubConnection
      const issued = yield* github.tokenFor(repository)
      return { token: Redacted.value(issued.token), expiresAt: issued.expiresAt }
    }),
  ),
}

/**
 * The workspace's own Durable Object, named `<workspace>`: the records that belong to the whole
 * workspace rather than one project: the index of its projects, its members, their phones, the
 * alerts that reach them, and its GitHub App. The Worker, and projects' objects for GitHub's tokens,
 * reach it through `call`.
 */
export class WorkspaceObject extends DurableObject<Env> {
  readonly #runtime: ManagedRuntime.ManagedRuntime<WorkspaceServices, never>

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    // The Worker names the object by a decoded key, so this holds; `make` stops the object if not.
    const workspace = WorkspaceKey.make(ctx.id.name ?? "")
    const NotificationsLive = Layer.unwrap(
      Effect.gen(function* () {
        const push = yield* pushSettings
        return Notifications.layer({
          push: Option.map(push, ({ topic, ...credentials }) => ({ credentials, topic })),
          signing: crypto.subtle,
        })
      }),
    ).pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(env))), Layer.orDie)
    const MembersLive = Layer.unwrap(
      Effect.gen(function* () {
        const owner = yield* ownerSetting
        return Members.layer({ owner, crypto: crypto.subtle })
      }),
    ).pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(env))), Layer.orDie)
    this.#runtime = ManagedRuntime.make(
      Layer.mergeAll(NotificationsLive, GitHubConnection.layer({ signing: crypto.subtle })).pipe(
        Layer.provideMerge(Layer.mergeAll(Phones.layer, MembersLive)),
        Layer.provideMerge(ProjectIndex.layer),
        Layer.provide(ActivityLog.layer({ workspace })),
        Layer.provide(webCryptoLayer(crypto)),
        Layer.provide(FetchHttpClient.layer),
        Layer.provide(SqliteClient.layer({ storage: ctx.storage })),
        // In the runtime itself, so every call runs on it as the Worker's requests do.
        Layer.provideMerge(SyncScheduler),
      ),
    )
  }

  /** Runs one of `workspaceCalls`: its input and answer are that call's encodings as JSON text. */
  call(name: WorkspaceCallName, input: string): Promise<string> {
    return this.#runtime.runPromise(servedCalls[name](input))
  }
}
