import { ComponentKey, ProjectKey } from "@cluenori/foundation"
import { AppVersion, ModelIdentifier, PairedPhone, PairingCode, SystemVersion } from "@cluenori/phones"
import { ComponentName, ProjectName } from "@cluenori/projects"
import { assert, layer } from "@effect/vitest"
import { runDurableObjectAlarm } from "cloudflare:test"
import { env } from "cloudflare:workers"
import { DateTime, Duration, Effect, Schedule, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"

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
      cluenori: Schema.Struct({ level: Schema.String, incident: Schema.optionalKey(Schema.String) }),
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
})
