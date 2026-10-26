import {
  ComponentKey,
  EnvelopeName,
  EnvironmentKey,
  InstallationId,
  ProjectKey,
  ReleaseVersion,
  SessionId,
} from "@cluenori/foundation"
import { AppVersion, ModelIdentifier, PairedPhone, PairingCode, SystemVersion } from "@cluenori/phones"
import type { SdkKey } from "@cluenori/projects"
import { ComponentName, ProjectName } from "@cluenori/projects"
import type { AppBatch } from "@cluenori/signals"
import { AppSignalId } from "@cluenori/signals"
import { CluenoriIngestApi, SdkKeyAuthorization } from "@cluenori/worker"
import { assert, layer } from "@effect/vitest"
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test"
import { env } from "cloudflare:workers"
import { DateTime, Duration, Effect, Schedule, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { HttpApiClient, HttpApiMiddleware } from "effect/http-api"

import { baseUrl, CluenoriClient } from "./cluenori-client.ts"
import { traceExport } from "./trace-export.ts"

// The token iOS gives the app, for the APNs of a build Xcode installed.
const pushToken = "a1b2c3d4".repeat(8)

// What the journey reads of each push the fake APNs took (vitest.alerts.config.ts).
const Received = Schema.Array(
  Schema.Struct({
    host: Schema.String,
    path: Schema.String,
    payload: Schema.Struct({
      aps: Schema.Struct({
        alert: Schema.Struct({ title: Schema.String, body: Schema.optionalKey(Schema.String) }),
        "interruption-level": Schema.String,
      }),
      cluenori: Schema.Struct({
        level: Schema.String,
        incident: Schema.optionalKey(Schema.String),
        feed: Schema.optionalKey(Schema.String),
      }),
    }),
  }),
)

// The binding the alerts journey's Worker has besides wrangler.jsonc's: it answers every request
// with the pushes the fake APNs took, as JSON (vitest.alerts.config.ts).
const FakeApnsBinding = Schema.Struct({
  APNS_PUSHES: Schema.declare(
    (value: unknown): value is Fetcher => typeof value === "object" && value !== null && "fetch" in value,
  ),
})

// The pushes APNs took so far, waiting up to 10 seconds for there to be `count`: the queue hands its
// consumer a batch within a second.
const receivedPushes = (count: number) =>
  Effect.gen(function* () {
    const { APNS_PUSHES: apns } = yield* Schema.decodeUnknownEffect(FakeApnsBinding)(env).pipe(
      Effect.mapError(() => "The alerts journey runs with its fake APNs: vitest.alerts.config.ts"),
      Effect.orDie,
    )
    const response = yield* Effect.promise(() => apns.fetch("https://apns.test/"))
    const pushes = yield* Effect.promise(() => response.json()).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Received)),
      Effect.orDie,
    )
    if (pushes.length < count) {
      return yield* Effect.fail(`APNs has taken ${pushes.length} pushes, not ${count}`)
    }
    return pushes
  }).pipe(
    Effect.retry(Schedule.spaced(Duration.millis(200)).pipe(Schedule.upTo({ duration: Duration.seconds(10) }))),
    Effect.orDie,
  )

const pair = Effect.fn("pair")(function* (link: string) {
  const http = yield* HttpClient.HttpClient
  const request = yield* HttpClientRequest.post(`${baseUrl}/api/phones`).pipe(
    HttpClientRequest.bodyJson({
      code: PairingCode.make(new URL(link).searchParams.get("code") ?? ""),
      model: ModelIdentifier.make("iPhone19,3"),
      systemVersion: SystemVersion.make("27.0"),
      appVersion: AppVersion.make("1.0 (1)"),
    }),
    Effect.orDie,
  )
  return yield* http.execute(request).pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(PairedPhone)), Effect.orDie)
})

// The phone registering its push token, with `credential` as its bearer token: the status answered.
const registerPush = Effect.fn("registerPush")(function* (credential: string) {
  const http = yield* HttpClient.HttpClient
  const request = yield* HttpClientRequest.put(`${baseUrl}/api/phones/push`).pipe(
    HttpClientRequest.bearerToken(credential),
    HttpClientRequest.bodyJson({ token: pushToken, environment: "development" }),
    Effect.orDie,
  )
  return (yield* http.execute(request)).status
})

const runCheck = (project: ProjectKey) =>
  Effect.promise(() => runDurableObjectAlarm(env.PROJECT.getByName(`main/${project}`)))

// A UUIDv7 made at `millis`, the `n`th.
const uuidAt = (millis: number, n: number) => {
  const time = Math.floor(millis).toString(16).padStart(12, "0")
  return `${time.slice(0, 8)}-${time.slice(8)}-7000-8000-${n.toString(16).padStart(12, "0")}`
}

// What an app's SDK sends from `environment`: events named `names`, the `n`th signals, at `at`.
const eventsOf = (environment: string, at: number, names: ReadonlyArray<string>, n: number): AppBatch => ({
  installation: InstallationId.make(uuidAt(at, n * 100)),
  environment: EnvironmentKey.make(environment),
  release: ReleaseVersion.make("2.4.0+12"),
  device: { model: "iPhone17,2", platform: "iOS", osVersion: "27.2", locale: "de-DE", timeZone: "Europe/Berlin" },
  sdk: { name: "cluenori-swift", version: "0.1.0" },
  sentAt: DateTime.makeUnsafe(at),
  signals: names.map((name, index) => ({
    _tag: "event" as const,
    id: AppSignalId.make(uuidAt(at, n * 100 + index + 1)),
    at: DateTime.makeUnsafe(at),
    session: SessionId.make(uuidAt(at, n * 100 + 99)),
    name: EnvelopeName.make(name),
  })),
})

// A project with an iPhone app, `<key>-ios`, and its SDK key.
const projectWithApp = Effect.fn("projectWithApp")(function* (key: string, name: string) {
  const client = yield* CluenoriClient
  const project = ProjectKey.make(key)
  const component = ComponentKey.make(`${key}-ios`)
  yield* client.projects.createProject({ payload: { key: project, name: ProjectName.make(name) } })
  yield* client.projects.addComponent({
    params: { project },
    payload: { key: component, name: ComponentName.make(name) },
  })
  const issued = yield* client.projects.issueSdkKey({ params: { project, component } })
  return { project, key: issued.key }
})

// Sends `batch` as an app's SDK does, with `key`.
const send = Effect.fn("send")(function* (key: SdkKey, batch: AppBatch) {
  const ingest = yield* HttpApiClient.make(CluenoriIngestApi, { baseUrl }).pipe(
    Effect.provide(
      HttpApiMiddleware.layerClient(SdkKeyAuthorization, ({ next, request }) =>
        next(HttpClientRequest.bearerToken(request, key)),
      ),
    ),
  )
  return yield* ingest.appIngest.sendBatch({ payload: batch })
})

// Real time: the Worker counts operations by the time they started, and the queue runs on its own.
layer(CluenoriClient.layer, { excludeTestServices: true })("alerts", (it) => {
  it.effect("a phone registers for pushes and rings with a test alarm, then with a failing export's", () =>
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      const http = yield* HttpClient.HttpClient

      // A phone pairs, and registers its push token with its own key; the API token can't.
      const { phone, key } = yield* pair((yield* client.phones.startPairing()).link)
      assert.strictEqual(yield* registerPush("journey-api-token"), 401)
      assert.strictEqual(yield* registerPush(key), 204)

      // The site names the app its passkeys sign in to, for iOS, by the app's ID push was set up with.
      const association = yield* http
        .execute(HttpClientRequest.get(`${baseUrl}/.well-known/apple-app-site-association`))
        .pipe(
          Effect.flatMap(
            HttpClientResponse.schemaBodyJson(
              Schema.Struct({ webcredentials: Schema.Struct({ apps: Schema.Array(Schema.String) }) }),
            ),
          ),
          Effect.orDie,
        )
      assert.deepStrictEqual(association.webcredentials.apps, ["JOURNEYTEA.com.example.cluenori"])

      // Its owner rings it with a test alarm.
      yield* client.notifications.testAlert({ params: { phone: phone.id } })
      const [test] = yield* receivedPushes(1)
      assert.deepStrictEqual(
        [test?.host, test?.path, test?.payload.aps.alert.title],
        ["api.sandbox.push.apple.com", `/3/device/${pushToken}`, "Cluenori · Test alarm"],
      )

      // A project's export fails, and the next check opens an incident: the phone rings.
      const project = ProjectKey.make("alerted")
      const api = ComponentKey.make("notes-api")
      yield* client.projects.createProject({ payload: { key: project, name: ProjectName.make("Notes") } })
      const added = yield* client.projects.addComponent({
        params: { project },
        payload: { key: api, name: ComponentName.make("Notes API") },
      })
      const now = DateTime.toEpochMillis(yield* DateTime.now)
      const failed = Array.from({ length: 10 }, (_, index) => ({
        name: "POST /api/export",
        kind: "server" as const,
        startMillis: now - 1_000 + index,
        durationMillis: 40,
        failed: true,
      }))
      yield* http.execute(
        HttpClientRequest.post(`${baseUrl}/otlp/v1/traces`).pipe(
          HttpClientRequest.bearerToken(added.ingestKey),
          HttpClientRequest.bodyUint8Array(
            traceExport({ name: "notes-api", environment: "Production" }, failed),
            "application/x-protobuf",
          ),
        ),
      )
      assert.isTrue(yield* runCheck(project))
      const [, alarm] = yield* receivedPushes(2)
      const [failing] = (yield* client.incidents.incidents({ params: { project } })).open
      if (failing === undefined) {
        return assert.fail("The failing export opened no incident")
      }
      assert.deepStrictEqual(
        [
          alarm?.payload.aps.alert.title,
          alarm?.payload.aps.alert.body,
          alarm?.payload.cluenori.level,
          alarm?.payload.cluenori.incident,
        ],
        ["Notes · Failing", "POST /api/export: 100% failed, usually none", "alarm", failing.id],
      )

      // Someone acknowledges it: the next check tells the phone quietly, which stops its alarm.
      yield* client.incidents.acknowledge({ params: { project, incident: failing.id } })
      assert.isTrue(yield* runCheck(project))
      const [, , acknowledged] = yield* receivedPushes(3)
      assert.deepStrictEqual(
        [acknowledged?.payload.aps.alert.title, acknowledged?.payload.aps["interruption-level"]],
        ["Notes · Acknowledged", "passive"],
      )
    }),
  )

  it.effect("a feed lists registrations from two projects, each naming them its own way, and alerts a phone", () =>
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      const now = DateTime.toEpochMillis(yield* DateTime.now)
      const earlier = (yield* receivedPushes(0)).length
      const { key: phoneKey } = yield* pair((yield* client.phones.startPairing()).link)
      assert.strictEqual(yield* registerPush(phoneKey), 204)

      // Folio tracks a registration as `user.registered`, Atlas as `signup_completed`.
      const folio = yield* projectWithApp("folio", "Folio")
      const atlas = yield* projectWithApp("atlas", "Atlas")
      const feed = yield* client.feeds.createFeed({
        payload: {
          name: "Registrations",
          level: "timeSensitive",
          sources: [
            { project: folio.project, event: EnvelopeName.make("user.registered") },
            { project: atlas.project, event: EnvelopeName.make("signup_completed") },
          ],
        },
      })
      const nowhere = yield* client.feeds
        .createFeed({
          payload: {
            name: "Nowhere",
            level: "none",
            sources: [{ project: ProjectKey.make("ghost"), event: EnvelopeName.make("x") }],
          },
        })
        .pipe(Effect.flip)
      assert.strictEqual(nowhere._tag, "ProjectNotFound")

      // Someone registers in Folio's production app; a tester in staging and another event don't count.
      yield* send(folio.key, eventsOf("production", now - 2_000, ["user.registered", "card.flipped"], 1))
      yield* send(folio.key, eventsOf("staging", now - 1_000, ["user.registered"], 2))
      // The project's next check delivers its activity; the queue takes it to the feed, which alerts.
      assert.isTrue(yield* runCheck(folio.project))
      const told = (yield* receivedPushes(earlier + 1)).filter((push) => push.payload.cluenori.feed === feed.id)
      assert.deepStrictEqual(
        told.map((push) => [
          push.payload.aps.alert.title,
          push.payload.aps.alert.body,
          push.payload.aps["interruption-level"],
        ]),
        [["Folio · Registrations", "folio-ios 2.4.0+12", "time-sensitive"]],
      )

      // Two register in Atlas within the minute: the feed lists them now, and their alert waits.
      yield* send(atlas.key, eventsOf("production", now, ["signup_completed", "signup_completed"], 3))
      assert.isTrue(yield* runCheck(atlas.project))
      const page = yield* client.feeds.feed({ params: { feed: feed.id }, query: {} }).pipe(
        Effect.filterOrFail(
          (answer) => answer.entries.length === 3,
          (answer) => `The feed has ${answer.entries.length} entries, not 3`,
        ),
        Effect.retry(Schedule.spaced(Duration.millis(200)).pipe(Schedule.upTo({ duration: Duration.seconds(10) }))),
      )
      assert.deepStrictEqual(
        page.entries.map((entry) => [entry.project, entry.event, entry.environment]),
        [
          [atlas.project, "signup_completed", "production"],
          [atlas.project, "signup_completed", "production"],
          [folio.project, "user.registered", "production"],
        ],
      )
      assert.deepStrictEqual(
        [page.summary.lastDay, page.summary.byProject],
        [
          3,
          [
            { project: atlas.project, lastWeek: 2 },
            { project: folio.project, lastWeek: 1 },
          ],
        ],
      )
      const alarm = yield* Effect.promise(() =>
        runInDurableObject(env.WORKSPACE.getByName("main"), (_object, state) => state.storage.getAlarm()),
      )
      assert.isTrue(alarm !== null && alarm > now && alarm <= now + 70_000, `The held alert is due at ${alarm}`)

      // Deleted, it lists nothing, and its projects stop forwarding.
      yield* client.feeds.removeFeed({ params: { feed: feed.id } })
      assert.deepStrictEqual((yield* client.feeds.feeds()).feeds, [])
    }),
  )
})
