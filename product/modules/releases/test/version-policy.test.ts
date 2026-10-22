import type { AppStoreConnect } from "@bagatka/app-store-connect"
import { AppStoreConnectUnavailable } from "@bagatka/app-store-connect"
import type { Actor } from "@cluenori/foundation"
import { ActivityLog, ComponentKey, EnvironmentKey, MemberId, ReleaseVersion } from "@cluenori/foundation"
import type { ManifestQuery } from "@cluenori/manifest"
import { StoreVersion } from "@cluenori/manifest"
import { BundleId, ComponentName, ProjectName, Projects } from "@cluenori/projects"
import { assert, describe, it } from "@effect/vitest"
import { Effect, Layer, Option } from "effect"

import type { UpdateWords } from "../src/index.ts"
import { NoteLocale, ReleaseSources, releasesModule, versionPolicyFor } from "../src/index.ts"
import { inProject, noModel, notConnected } from "./in-object.ts"

// 2026-10-21T10:00:00Z, on a minute.
const start = 1792576800000

const ios = ComponentKey.make("notes-ios")
const web = ComponentKey.make("notes-web")
const production = EnvironmentKey.make("production")
const beta = EnvironmentKey.make("beta")
const member: Actor = { _tag: "Member", id: MemberId.make("0199f7a2-5c1e-7d3a-9b2f-4e8a1c6d0f53") }
const storeUrl = "https://apps.apple.com/app/id1234567890"

const words: ReadonlyArray<UpdateWords> = [
  {
    locale: NoteLocale.make("en-US"),
    decision: "require",
    text: { title: "Update Notes", message: "This version of Notes is no longer supported." },
  },
  {
    locale: NoteLocale.make("en-US"),
    decision: "recommend",
    text: { title: "A new Notes is out", message: "Update for faster sync." },
  },
  {
    locale: NoteLocale.make("uk-UA"),
    decision: "require",
    text: { title: "Оновіть Notes", message: "Ця версія Notes більше не підтримується." },
  },
  {
    locale: NoteLocale.make("uk-UA"),
    decision: "recommend",
    text: { title: "Вийшла нова версія Notes", message: "Оновіть для швидшої синхронізації." },
  },
]

// The project, with the iOS app and the web app, neither with deploy targets.
const project = Effect.gen(function* () {
  const projects = yield* Projects
  yield* projects.create(member, ProjectName.make("Notes"))
  yield* projects.addComponent(member, { key: ios, name: ComponentName.make("Notes") })
  yield* projects.addComponent(member, { key: web, name: ComponentName.make("Notes for the web") })
})

const setPolicy = (policy: {
  readonly component?: ComponentKey
  readonly minimum?: string
  readonly recommended?: string
  readonly storeUrl?: string
}) =>
  releasesModule.actions.setVersionPolicy.run(member, {
    component: policy.component ?? ios,
    ...(policy.minimum === undefined ? {} : { minimum: StoreVersion.make(policy.minimum) }),
    ...(policy.recommended === undefined ? {} : { recommended: StoreVersion.make(policy.recommended) }),
    ...(policy.storeUrl === undefined ? {} : { storeUrl: policy.storeUrl }),
  })

const policyOf = (release: string, environment = production, locale?: string, component = ios) => {
  const query: ManifestQuery = {
    environment,
    release: ReleaseVersion.make(release),
    ...(locale === undefined ? {} : { locale }),
  }
  return versionPolicyFor(component, query)
}

// App Store Connect with one app, com.example.notes, keeping each bundle ID it was asked about.
const fakeAppStore = (asked: Array<string>): AppStoreConnect["Service"] => ({
  app: (bundleId) =>
    Effect.sync(() => {
      asked.push(bundleId)
      return bundleId === "com.example.notes"
        ? Option.some({ id: "1234567890", name: "Notes", bundleId })
        : Option.none()
    }),
  builds: () => Effect.die("No builds in these tests"),
  build: () => Effect.die("No builds in these tests"),
  appStoreVersions: () => Effect.die("No versions in these tests"),
  appLocales: () => Effect.die("No languages in these tests"),
  prepareVersion: () => Effect.die("Nothing is submitted in these tests"),
  submitForReview: () => Effect.die("Nothing is submitted in these tests"),
  releaseVersion: () => Effect.die("Nothing is released in these tests"),
  setPhasedRelease: () => Effect.die("No phased release in these tests"),
  setWhatToTest: () => Effect.die("No What to Test in these tests"),
})

const withAppStore = (appStore: AppStoreConnect["Service"]) =>
  Layer.mergeAll(
    Layer.succeed(
      ReleaseSources,
      ReleaseSources.of({ appStoreConnect: Option.some(appStore), appStoreConnectManager: Option.none() }),
    ),
    notConnected,
    noModel,
  )

describe("Version policies", () => {
  it.effect("keep a component's policy, and read it back", () =>
    inProject(
      "version-policy",
      start,
      Effect.gen(function* () {
        yield* project
        const set = yield* releasesModule.actions.setVersionPolicy.run(member, {
          component: ios,
          minimum: StoreVersion.make("0.4.0"),
          recommended: StoreVersion.make("0.4.1"),
          storeUrl,
          minimumOsVersion: StoreVersion.make("26.0"),
          words,
        })
        const { policies } = yield* releasesModule.queries.versionPolicies.run({})

        assert.deepStrictEqual(policies, [set])
        assert.deepInclude(set, {
          component: ios,
          minimum: StoreVersion.make("0.4.0"),
          recommended: StoreVersion.make("0.4.1"),
          storeUrl,
          minimumOsVersion: StoreVersion.make("26.0"),
        })
        assert.deepStrictEqual(set.words, words)
      }),
    ),
  )

  it.effect("require an update below the minimum, offer one below the recommended, in production only", () =>
    inProject(
      "version-policy-decisions",
      start,
      Effect.gen(function* () {
        yield* project
        const before = yield* policyOf("0.3.0+20")
        yield* releasesModule.actions.setVersionPolicy.run(member, {
          component: ios,
          minimum: StoreVersion.make("0.4.0"),
          recommended: StoreVersion.make("0.4.1"),
          storeUrl,
          minimumOsVersion: StoreVersion.make("26.0"),
          words,
        })
        const old = yield* policyOf("0.3.0+20", production, "en-US")
        const behind = yield* policyOf("0.4.0+31", production, "en-US")
        const short = yield* policyOf("0.4+5")
        const current = yield* policyOf("0.4.1+40")
        const newer = yield* policyOf("1.0+1")
        const inBeta = yield* policyOf("0.3.0+20", beta)
        const dated = yield* policyOf("2026.10.20-a1b2c3d")
        const otherApp = yield* policyOf("0.3.0+20", production, "en-US", web)

        assert.deepStrictEqual(before, { decision: "none" })
        assert.deepStrictEqual(old, {
          decision: "require",
          update: { version: StoreVersion.make("0.4.1"), minimumOsVersion: StoreVersion.make("26.0"), storeUrl },
          text: { title: "Update Notes", message: "This version of Notes is no longer supported." },
        })
        assert.deepStrictEqual(behind, {
          decision: "recommend",
          update: { version: StoreVersion.make("0.4.1"), minimumOsVersion: StoreVersion.make("26.0"), storeUrl },
          text: { title: "A new Notes is out", message: "Update for faster sync." },
        })
        // 0.4 is 0.4.0: at the minimum, below the recommended.
        assert.strictEqual(short.decision, "recommend")
        assert.isUndefined(short.text)
        assert.deepStrictEqual(current, { decision: "none" })
        assert.deepStrictEqual(newer, { decision: "none" })
        assert.deepStrictEqual(inBeta, { decision: "none" })
        assert.deepStrictEqual(dated, { decision: "none" })
        assert.deepStrictEqual(otherApp, { decision: "none" })
      }),
    ),
  )

  it.effect("update to the minimum without a recommended version", () =>
    inProject(
      "version-policy-minimum",
      start,
      Effect.gen(function* () {
        yield* project
        yield* setPolicy({ minimum: "0.4", storeUrl })
        const old = yield* policyOf("0.3.9+19")
        const same = yield* policyOf("0.4.0+20")

        assert.deepStrictEqual(old, { decision: "require", update: { version: StoreVersion.make("0.4"), storeUrl } })
        assert.deepStrictEqual(same, { decision: "none" })
      }),
    ),
  )

  it.effect("show the words in the language asked, else the same language, else none", () =>
    inProject(
      "version-policy-words",
      start,
      Effect.gen(function* () {
        yield* project
        yield* releasesModule.actions.setVersionPolicy.run(member, {
          component: ios,
          minimum: StoreVersion.make("0.4.0"),
          storeUrl,
          words,
        })
        const ukrainian = yield* policyOf("0.3.0+20", production, "uk-UA")
        const language = yield* policyOf("0.3.0+20", production, "uk")
        const german = yield* policyOf("0.3.0+20", production, "de-DE")
        const unasked = yield* policyOf("0.3.0+20")

        assert.deepStrictEqual(ukrainian.text, {
          title: "Оновіть Notes",
          message: "Ця версія Notes більше не підтримується.",
        })
        assert.deepStrictEqual(language.text, ukrainian.text)
        assert.strictEqual(german.decision, "require")
        assert.isUndefined(german.text)
        assert.isUndefined(unasked.text)
      }),
    ),
  )

  it.effect("refuse a policy that can't be followed, saying why", () =>
    inProject(
      "version-policy-refused",
      start,
      Effect.gen(function* () {
        yield* project
        const lower = yield* setPolicy({ minimum: "0.4.1", recommended: "0.4.0", storeUrl }).pipe(Effect.flip)
        const neither = yield* setPolicy({ storeUrl }).pipe(Effect.flip)
        const missing = yield* setPolicy({
          component: ComponentKey.make("notes-mac"),
          minimum: "0.4.0",
          storeUrl,
        }).pipe(Effect.flip)
        const noStore = yield* setPolicy({ minimum: "0.4.0" }).pipe(Effect.flip)
        const { policies } = yield* releasesModule.queries.versionPolicies.run({})
        const log = yield* ActivityLog
        const names = (yield* log.latest).map((entry): string => entry.name)

        assert.include(lower.reason, "lower than the minimum")
        assert.include(neither.reason, "minimum version, a recommended one")
        assert.include(missing.reason, "no component notes-mac")
        assert.include(noStore.reason, "give the store URL")
        assert.deepStrictEqual(policies, [])
        assert.notInclude(names, "version_policy.set")
      }),
    ),
  )

  it.effect("find the store URL from the component's App Store deploy target, asking only when none is given", () => {
    const asked: Array<string> = []
    return inProject(
      "version-policy-app-store",
      start,
      Effect.gen(function* () {
        yield* project
        const projects = yield* Projects
        yield* projects.linkComponent(member, ios, {
          deployTargets: [
            {
              environment: beta,
              appStore: { bundleId: BundleId.make("com.example.notes.beta"), distribution: "appStore" },
            },
            {
              environment: production,
              appStore: { bundleId: BundleId.make("com.example.notes"), distribution: "appStore" },
            },
          ],
        })
        const found = yield* setPolicy({ minimum: "0.4.0" })
        const askedForFound = [...asked]
        const given = yield* setPolicy({ minimum: "0.4.0", storeUrl: "https://apps.apple.com/app/id42" })

        assert.strictEqual(found.storeUrl, storeUrl)
        // The production target's app, not the beta's.
        assert.deepStrictEqual(askedForFound, ["com.example.notes"])
        assert.strictEqual(given.storeUrl, "https://apps.apple.com/app/id42")
        assert.deepStrictEqual(asked, ["com.example.notes"])
      }),
      withAppStore(fakeAppStore(asked)),
    )
  })

  it.effect("refuse without a store URL when App Store Connect doesn't answer, saying to give it", () =>
    inProject(
      "version-policy-app-store-down",
      start,
      Effect.gen(function* () {
        yield* project
        const projects = yield* Projects
        yield* projects.linkComponent(member, ios, {
          deployTargets: [
            {
              environment: production,
              appStore: { bundleId: BundleId.make("com.example.notes"), distribution: "appStore" },
            },
          ],
        })
        const refused = yield* setPolicy({ minimum: "0.4.0" }).pipe(Effect.flip)

        assert.include(refused.reason, "Too many requests")
        assert.include(refused.reason, "give the store URL")
      }),
      withAppStore({
        ...fakeAppStore([]),
        app: () => Effect.fail(new AppStoreConnectUnavailable({ reason: "Too many requests" })),
      }),
    ),
  )

  it.effect("clear a policy, after which releases are asked nothing; clearing none does nothing", () =>
    inProject(
      "version-policy-clear",
      start,
      Effect.gen(function* () {
        yield* project
        yield* setPolicy({ minimum: "0.4.0", storeUrl })
        const required = yield* policyOf("0.3.0+20")
        yield* releasesModule.actions.clearVersionPolicy.run(member, { component: ios })
        yield* releasesModule.actions.clearVersionPolicy.run(member, { component: ios })
        const cleared = yield* policyOf("0.3.0+20")
        const { policies } = yield* releasesModule.queries.versionPolicies.run({})
        const log = yield* ActivityLog
        const entries = (yield* log.latest).filter((entry) => entry.name.startsWith("version_policy."))

        assert.strictEqual(required.decision, "require")
        assert.deepStrictEqual(cleared, { decision: "none" })
        assert.deepStrictEqual(policies, [])
        assert.deepStrictEqual(
          entries.map((entry): [string, string | undefined] => [entry.name, entry.component]),
          [
            ["version_policy.cleared", ios],
            ["version_policy.set", ios],
          ],
        )
        assert.deepStrictEqual(entries[1]?.attrs, { minimum: "0.4.0", storeUrl })
      }),
    ),
  )

  it.effect("answer none for a project that doesn't exist", () =>
    inProject(
      "version-policy-no-project",
      start,
      Effect.gen(function* () {
        const answer = yield* policyOf("0.3.0+20")

        assert.deepStrictEqual(answer, { decision: "none" })
      }),
    ),
  )
})
