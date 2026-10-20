import { ComponentKey, EnvironmentKey, ProjectKey } from "@cluenori/foundation"
import { ComponentName, ProjectName } from "@cluenori/projects"
import { assert, layer } from "@effect/vitest"
import { DateTime, Effect } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"

import { baseUrl, CluenoriClient } from "./cluenori-client.ts"
import type { ExportedSpan } from "./trace-export.ts"
import { traceExport } from "./trace-export.ts"

const notesApi = { name: "notes-api", environment: "Production" }

// Creates a project with one component and returns the component's ingest key. Each test uses a
// project of its own.
const projectWithApi = Effect.fn("projectWithApi")(function* (key: string) {
  const client = yield* CluenoriClient
  const project = ProjectKey.make(key)
  yield* client.projects.createProject({ payload: { key: project, name: ProjectName.make("Notes") } })
  const added = yield* client.projects.addComponent({
    params: { project },
    payload: { key: ComponentKey.make("notes-api"), name: ComponentName.make("Notes API") },
  })
  return { project, ingestKey: added.ingestKey }
})

// What an OpenTelemetry exporter does: POST the export with the component's key.
const sendExport = Effect.fn("sendExport")(function* (ingestKey: string, body: Uint8Array) {
  const http = yield* HttpClient.HttpClient
  const response = yield* http.execute(
    HttpClientRequest.post(`${baseUrl}/otlp/v1/traces`).pipe(
      HttpClientRequest.bearerToken(ingestKey),
      HttpClientRequest.bodyUint8Array(body, "application/x-protobuf"),
    ),
  )
  const answer = yield* response.arrayBuffer
  return { status: response.status, contentType: response.headers["content-type"], answerBytes: answer.byteLength }
})

const lastHour = Effect.gen(function* () {
  const now = yield* DateTime.now
  return { from: DateTime.subtract(now, { hours: 1 }), to: DateTime.add(now, { minutes: 1 }) }
})

const requestsAt = (start: number): ReadonlyArray<ExportedSpan> => [
  ...[12, 18, 25, 31, 240].map((durationMillis, index) => ({
    name: "GET /api/notes/{id}",
    kind: "server" as const,
    startMillis: start + index * 10,
    durationMillis,
  })),
  { name: "GET /api/fail", kind: "server", startMillis: start + 60, durationMillis: 2, failed: true },
  { name: "GET /api/fail", kind: "server", startMillis: start + 70, durationMillis: 3, failed: true },
  { name: "GET", kind: "client", startMillis: start + 80, durationMillis: 9 },
]

// Real time: the Worker counts requests by the time they started, against its own clock.
layer(CluenoriClient.layer, { excludeTestServices: true })("telemetry", (it) => {
  it.effect("a service's requests become its project's endpoint table", () =>
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      // Set up: a project, and its API with an ingest key.
      const { project, ingestKey } = yield* projectWithApi("notes")

      // The API's exporter sends a batch: seven requests, and a client span that is no request.
      const now = yield* DateTime.now
      const body = traceExport(notesApi, requestsAt(DateTime.toEpochMillis(now) - 1_000))
      const sent = yield* sendExport(ingestKey, body)
      assert.deepStrictEqual(sent, { status: 200, contentType: "application/x-protobuf", answerBytes: 0 })

      // The endpoint table shows them, by endpoint, with their percentiles.
      const period = yield* lastHour
      const table = yield* client.signals.endpoints({ params: { project }, query: period })
      const [notes, fail] = table.rows
      assert.deepStrictEqual([table.requests, table.errors], [7, 2])
      assert.strictEqual(notes?.endpoint, "GET /api/notes/{id}")
      assert.strictEqual(notes?.environment, "production")
      assert.strictEqual(notes?.requests, 5)
      assert.closeTo(notes?.p50Ms ?? 0, 25, 25 * 0.02)
      assert.closeTo(notes?.p99Ms ?? 0, 240, 240 * 0.02)
      assert.strictEqual(fail?.errors, 2)

      // The exporter retries the same batch after a timeout: it counts once.
      const retried = yield* sendExport(ingestKey, body)
      const again = yield* client.signals.endpoints({ params: { project }, query: period })
      assert.strictEqual(retried.status, 200)
      assert.strictEqual(again.requests, 7)

      // The load over time, and the environment filter.
      const series = yield* client.signals.requests({ params: { project }, query: { ...period, step: "5m" } })
      const staging = yield* client.signals.endpoints({
        params: { project },
        query: { ...period, environment: EnvironmentKey.make("staging") },
      })
      assert.strictEqual(
        series.points.reduce((total, point) => total + point.requests, 0),
        7,
      )
      assert.strictEqual(staging.requests, 0)
    }),
  )

  it.effect("refuses an export without a key it knows, and says so in OTLP's terms", () =>
    Effect.gen(function* () {
      const { ingestKey } = yield* projectWithApi("wrong-keys")
      const now = yield* DateTime.now
      const body = traceExport(notesApi, requestsAt(DateTime.toEpochMillis(now)))
      const tampered = `${ingestKey.slice(0, -1)}${ingestKey.endsWith("A") ? "B" : "A"}`
      const otherProject = ingestKey.replace("cluenori.wrong-keys.", "cluenori.no-such-project.")

      const answers = yield* Effect.forEach([tampered, otherProject, "not-a-key"], (key) => sendExport(key, body))
      assert.deepStrictEqual(
        answers.map((answer) => answer.status),
        [401, 401, 401],
      )
    }),
  )

  it.effect("tells a sender that the export is not one it can read", () =>
    Effect.gen(function* () {
      const { ingestKey } = yield* projectWithApi("bad-exports")
      const http = yield* HttpClient.HttpClient
      const json = yield* http.execute(
        HttpClientRequest.post(`${baseUrl}/otlp/v1/traces`).pipe(
          HttpClientRequest.bearerToken(ingestKey),
          HttpClientRequest.bodyUint8Array(new Uint8Array([123, 125]), "application/json"),
        ),
      )
      const broken = yield* sendExport(ingestKey, new Uint8Array([0x0a, 0x7f]))
      const jsonMessage = yield* json.text

      assert.strictEqual(json.status, 415)
      assert.include(jsonMessage, "http/protobuf")
      assert.strictEqual(broken.status, 400)
    }),
  )

  it.effect("answers only to the deployment's API token", () =>
    Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient
      const projects = `${baseUrl}/api/projects`
      const without = yield* http.execute(HttpClientRequest.post(projects))
      const wrong = yield* http.execute(HttpClientRequest.post(projects).pipe(HttpClientRequest.bearerToken("guess")))

      assert.deepStrictEqual([without.status, wrong.status], [401, 401])
    }),
  )

  it.effect("says when a project doesn't exist, and creates nothing for it", () =>
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      const period = yield* lastHour
      const missing = yield* client.signals
        .endpoints({ params: { project: ProjectKey.make("never-created") }, query: period })
        .pipe(Effect.flip)
      const created = yield* client.projects
        .createProject({ payload: { key: ProjectKey.make("never-created"), name: ProjectName.make("Later") } })
        .pipe(Effect.map((project) => project.key))

      assert.strictEqual(missing._tag, "ProjectNotFound")
      assert.strictEqual(created, "never-created")
    }),
  )
})
