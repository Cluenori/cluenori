import {
  ComponentKey,
  EnvelopeName,
  EnvironmentKey,
  InstallationId,
  ProjectKey,
  ReleaseVersion,
  SessionId,
} from "@cluenori/foundation"
import { StoreVersion } from "@cluenori/manifest"
import type { SdkKey } from "@cluenori/projects"
import { ComponentName, ProjectName } from "@cluenori/projects"
import { NoteLocale } from "@cluenori/releases"
import type { AppSignal } from "@cluenori/signals"
import { AppBatch, AppSignalId, AppUserId, CountryCode } from "@cluenori/signals"
import { CluenoriIngestApi, SdkKeyAuthorization } from "@cluenori/worker"
import { assert, layer } from "@effect/vitest"
import { exports } from "cloudflare:workers"
import { DateTime, Effect, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import { HttpApiClient, HttpApiMiddleware } from "effect/http-api"

import { baseUrl, CluenoriClient } from "./cluenori-client.ts"

const ios = ComponentKey.make("notes-ios")
const mac = ComponentKey.make("notes-mac")
const production = EnvironmentKey.make("production")
const storeUrl = "https://apps.apple.com/app/id6740000001"

// A UUIDv7 made at `millis`, the `n`th: IDs of signals, sessions and installations.
const uuidAt = (millis: number, n: number) => {
  const time = Math.floor(millis).toString(16).padStart(12, "0")
  return `${time.slice(0, 8)}-${time.slice(8)}-7000-8000-${n.toString(16).padStart(12, "0")}`
}

/** What an app's SDK sends: one session with a launch, a screen and an event, signed in as `user`. */
const batchOf = (at: number, installation: InstallationId, user: string, n: number, release = "0.3.0+20"): AppBatch => {
  const session = SessionId.make(uuidAt(at, n * 100))
  const signed = { session, user: AppUserId.make(user) }
  const signals: ReadonlyArray<AppSignal> = [
    { _tag: "session.started", id: AppSignalId.make(uuidAt(at, n * 100 + 1)), at: DateTime.makeUnsafe(at), ...signed },
    {
      _tag: "app.launched",
      id: AppSignalId.make(uuidAt(at, n * 100 + 2)),
      at: DateTime.makeUnsafe(at),
      start: "cold",
      prewarmed: false,
      firstFrameMs: 640,
      readyMs: 910,
      ...signed,
    },
    {
      _tag: "screen",
      id: AppSignalId.make(uuidAt(at + 1000, n * 100 + 3)),
      at: DateTime.makeUnsafe(at + 1000),
      screen: EnvelopeName.make("card"),
      ...signed,
    },
    {
      _tag: "event",
      id: AppSignalId.make(uuidAt(at + 2000, n * 100 + 4)),
      at: DateTime.makeUnsafe(at + 2000),
      name: EnvelopeName.make("card.flipped"),
      properties: { side: "back" },
      ...signed,
    },
  ]
  return {
    installation,
    environment: production,
    release: ReleaseVersion.make(release),
    device: { model: "iPhone17,2", platform: "iOS", osVersion: "27.2", locale: "uk-UA", timeZone: "Europe/Kyiv" },
    sdk: { name: "cluenori-swift", version: "0.1.0" },
    sentAt: DateTime.makeUnsafe(at + 3000),
    signals: [...signals],
  }
}

// The ingest API's typed client, as the Swift SDK's is generated from the same definition, sending
// `key` with every call.
const ingestClient = (key: SdkKey) =>
  HttpApiClient.make(CluenoriIngestApi, { baseUrl }).pipe(
    Effect.provide(
      HttpApiMiddleware.layerClient(SdkKeyAuthorization, ({ next, request }) =>
        next(HttpClientRequest.bearerToken(request, key)),
      ),
    ),
  )

// A batch POSTed as it is, with `authorization` when given: what a broken or foreign client sends.
const postBatch = Effect.fn("postBatch")(function* (body: string, authorization?: string) {
  const http = yield* HttpClient.HttpClient
  const request = HttpClientRequest.post(`${baseUrl}/ingest/v1/app/batch`).pipe(
    HttpClientRequest.bodyText(body, "application/json"),
  )
  const response = yield* http.execute(
    authorization === undefined ? request : HttpClientRequest.setHeader(request, "authorization", authorization),
  )
  return response.status
})

// A project with two apps, and an SDK key for each.
const projectWithApps = Effect.fn("projectWithApps")(function* (key: string) {
  const client = yield* CluenoriClient
  const project = ProjectKey.make(key)
  yield* client.projects.createProject({ payload: { key: project, name: ProjectName.make("Notes") } })
  for (const [component, name] of [
    [ios, "Notes for iPhone"],
    [mac, "Notes for Mac"],
  ] as const) {
    yield* client.projects.addComponent({
      params: { project },
      payload: { key: component, name: ComponentName.make(name) },
    })
  }
  const iosKey = yield* client.projects.issueSdkKey({ params: { project, component: ios } })
  const macKey = yield* client.projects.issueSdkKey({ params: { project, component: mac } })
  return { project, iosKey: iosKey.key, macKey: macKey.key }
})

// Real time: the Worker counts signals by when they happened, against its own clock.
layer(CluenoriClient.layer, { excludeTestServices: true })("apps", (it) => {
  it.effect(
    "an app sends what it recorded with its SDK key, and the founder reads usage, a person, and the manifest",
    () =>
      Effect.gen(function* () {
        const client = yield* CluenoriClient
        const started = yield* DateTime.now
        const now = DateTime.toEpochMillis(started)
        const period = { from: DateTime.makeUnsafe(now - 86_400_000), to: DateTime.makeUnsafe(now + 60_000) }

        // The founder makes a project with two apps, and an SDK key for each one's builds.
        const { project, iosKey, macKey } = yield* projectWithApps("apps-journey")
        const listed = yield* client.projects.sdkKeys({ params: { project, component: ios } })
        assert.deepStrictEqual(
          listed.keys.map((each) => each.key),
          [iosKey],
        )

        // Without a key, with something else, or with a key the deployment doesn't have: refused.
        const phone = InstallationId.make(uuidAt(now - 86_400_000, 1))
        const body = yield* Schema.encodeEffect(Schema.fromJsonString(AppBatch))(batchOf(now - 60_000, phone, "u-1", 1))
        const foreign = `cluenori-sdk.apps-journey.notes-ios.${"A".repeat(22)}`
        assert.deepStrictEqual(
          [
            yield* postBatch(body),
            yield* postBatch(body, "Bearer not-a-key"),
            yield* postBatch(body, `Bearer ${foreign}`),
          ],
          [401, 401, 401],
        )

        // The SDK sends a batch; sent again after a failure, nothing counts twice.
        const ingest = yield* ingestClient(iosKey)
        const batch = batchOf(now - 60_000, phone, "u-1", 1)
        const first = yield* ingest.appIngest.sendBatch({ payload: batch })
        const again = yield* ingest.appIngest.sendBatch({ payload: { ...batch, sentAt: DateTime.makeUnsafe(now) } })
        assert.deepStrictEqual(
          [first, again],
          [
            { accepted: 4, duplicates: 0 },
            { accepted: 0, duplicates: 4 },
          ],
        )
        // The same person on their iPad, an hour later in the day.
        const iPad = InstallationId.make(uuidAt(now - 86_400_000, 2))
        yield* ingest.appIngest.sendBatch({ payload: batchOf(now - 30_000, iPad, "u-1", 2) })

        // A body over 1 MB is refused before it is read.
        const oversized = yield* postBatch("x".repeat(1024 * 1024 + 1), `Bearer ${iosKey}`)
        assert.strictEqual(oversized, 413)
        // And one sent without its length is read only until it passes 1 MB.
        const chunk = new Uint8Array(64 * 1024).fill(120)
        let chunksLeft = 64
        const unmeasured = new ReadableStream<Uint8Array>({
          pull: (controller) => {
            if (chunksLeft === 0) {
              controller.close()
            } else {
              chunksLeft -= 1
              controller.enqueue(chunk)
            }
          },
        })
        const streamed = yield* Effect.promise(() =>
          exports.default.fetch(`${baseUrl}/ingest/v1/app/batch`, {
            method: "POST",
            headers: { authorization: `Bearer ${iosKey}`, "content-type": "application/json" },
            body: unmeasured,
          }),
        )
        assert.strictEqual(streamed.status, 413)
        assert.isAbove(chunksLeft, 0, "the Worker read all 4 MB")

        // The founder reads usage, the app's health, and what the person did, through the public API.
        const usage = yield* client.analytics.usage({ params: { project }, query: period })
        assert.deepStrictEqual([usage.people, usage.installations, usage.sessions], [1, 2, 2])
        assert.strictEqual(usage.days.at(-1)?.people, 1)
        const health = yield* client.analytics.appHealth({ params: { project }, query: period })
        assert.deepStrictEqual<unknown>(
          health.releases.map((row) => [row.release.release, row.verdict, row.health.cold?.launches]),
          [[ReleaseVersion.make("0.3.0+20"), "first", 2]],
        )
        const person = yield* client.analytics.personByUser({
          params: { project },
          query: { user: AppUserId.make("u-1") },
        })
        assert.deepStrictEqual(
          person.installations.map((each) => each.installation).toSorted(),
          [phone, iPad].toSorted(),
        )
        assert.deepStrictEqual(
          person.timeline.slice(0, 4).map((entry) => entry.signal._tag),
          ["event", "screen", "app.launched", "session.started"],
        )
        const byId = yield* client.analytics.person({ params: { project, person: person.person } })
        assert.deepStrictEqual(byId.users, [AppUserId.make("u-1")])
        const unknown = yield* client.analytics
          .personByUser({ params: { project }, query: { user: AppUserId.make("u-404") } })
          .pipe(Effect.flip)
        assert.strictEqual(unknown._tag, "PersonNotFound")

        // Cloudflare places where a batch came from by its address, which isn't kept.
        const abroad = InstallationId.make(uuidAt(now - 86_400_000, 3))
        const placedBody = yield* Schema.encodeEffect(Schema.fromJsonString(AppBatch))(
          batchOf(now - 20_000, abroad, "u-9", 9),
        )
        const placed = yield* Effect.promise(() =>
          exports.default.fetch(`${baseUrl}/ingest/v1/app/batch`, {
            method: "POST",
            headers: { authorization: `Bearer ${iosKey}`, "content-type": "application/json" },
            body: placedBody,
            cf: { country: "UA" },
          }),
        )
        assert.strictEqual(placed.status, 200)
        const placedPerson = yield* client.analytics.personByUser({
          params: { project },
          query: { user: AppUserId.make("u-9") },
        })
        assert.deepStrictEqual(
          placedPerson.installations.map((each) => each.country),
          [CountryCode.make("UA")],
        )

        // The founder sets the iPhone app's version policy: below 0.4.0 must update, below 0.4.1 is offered it.
        yield* client.releases.setVersionPolicy({
          params: { project, component: ios },
          payload: {
            minimum: StoreVersion.make("0.4.0"),
            recommended: StoreVersion.make("0.4.1"),
            storeUrl,
            words: [
              {
                locale: NoteLocale.make("uk-UA"),
                decision: "require",
                text: { title: "Оновіть Notes", message: "Ця версія більше не підтримується." },
              },
            ],
          },
        })
        const manifestOf = (release: string) =>
          ingest.appManifest.manifest({
            query: { environment: production, release: ReleaseVersion.make(release), locale: "uk-UA" },
          })
        const required = yield* manifestOf("0.3.0+20")
        assert.deepStrictEqual(required, {
          versionPolicy: {
            decision: "require",
            update: { version: StoreVersion.make("0.4.1"), storeUrl },
            text: { title: "Оновіть Notes", message: "Ця версія більше не підтримується." },
          },
          maxAgeSeconds: 300,
        })
        const recommended = yield* manifestOf("0.4.0+31")
        const current = yield* manifestOf("0.4.1+40")
        assert.deepStrictEqual(
          [recommended.versionPolicy.decision, current.versionPolicy.decision],
          ["recommend", "none"],
        )

        // The edge keeps each component's manifest apart: the Mac app, with no policy, asks for the
        // same release and gets none.
        const macIngest = yield* ingestClient(macKey)
        const ofMac = yield* macIngest.appManifest.manifest({
          query: { environment: production, release: ReleaseVersion.make("0.3.0+20"), locale: "uk-UA" },
        })
        assert.strictEqual(ofMac.versionPolicy.decision, "none")

        // A change reaches apps within the five minutes: until then the edge answers what it kept,
        // saying how long it may be used; a release not asked about yet sees the change at once.
        yield* client.releases.clearVersionPolicy({ params: { project, component: ios } })
        const kept = yield* manifestOf("0.3.0+20")
        const fresh = yield* manifestOf("0.3.9+29")
        assert.strictEqual(kept.versionPolicy.decision, "require")
        assert.isAtMost(kept.maxAgeSeconds, 300)
        assert.strictEqual(fresh.versionPolicy.decision, "none")

        // A revoked key's builds are refused from then on, and the SDK stops sending.
        yield* client.projects.revokeSdkKey({ params: { project, component: ios, key: iosKey } })
        const revoked = yield* ingest.appIngest
          .sendBatch({ payload: batchOf(now - 10_000, phone, "u-1", 3) })
          .pipe(Effect.flip)
        assert.strictEqual(revoked._tag, "SdkKeyRejected")
      }),
  )

  it.effect("an installation that sends too much in a minute is asked to send later", () =>
    Effect.gen(function* () {
      const started = yield* DateTime.now
      const now = DateTime.toEpochMillis(started)
      const { iosKey } = yield* projectWithApps("apps-limits")
      const ingest = yield* ingestClient(iosKey)
      const phone = InstallationId.make(uuidAt(now - 86_400_000, 1))
      // 20 batches a minute are taken from one installation. 41 are more than two minutes take, so
      // some are refused even when the sending crosses into the next minute.
      const answers = yield* Effect.forEach(
        Array.from({ length: 41 }, (_, n) => n),
        (n) =>
          ingest.appIngest.sendBatch({ payload: batchOf(now - 60_000 + n, phone, "u-1", n + 1) }).pipe(Effect.result),
      )
      const refusals = answers.flatMap((answer) =>
        answer._tag === "Failure" && answer.failure._tag === "TooManySignals" ? [answer.failure] : [],
      )
      assert.isAtLeast(answers.length - refusals.length, 20)
      assert.isAtLeast(refusals.length, 1)
      assert.isTrue(refusals.every((refusal) => refusal.retryAfterSeconds > 0 && refusal.retryAfterSeconds <= 60))
    }),
  )
})
