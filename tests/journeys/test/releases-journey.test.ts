import { ComponentKey, EnvelopeName, EnvironmentKey, ProjectKey, ReleaseVersion } from "@cluenori/foundation"
import { Repository } from "@cluenori/github"
import { ComponentName, ProjectName } from "@cluenori/projects"
import { assert, layer } from "@effect/vitest"
import { DateTime, Effect } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"

import { baseUrl, CluenoriClient } from "./cluenori-client.ts"
import type { ExportedSpan } from "./trace-export.ts"
import { traceExport } from "./trace-export.ts"

const minute = 60_000
const api = ComponentKey.make("notes-api")
const older = ReleaseVersion.make("2026.10.20-a1b2c3d")
const newer = ReleaseVersion.make("2026.10.21-e91f09c")

// `count` spans of `name`, each taking `durationMillis`, from `start`.
const spans = (name: string, start: number, count: number, durationMillis: number): ReadonlyArray<ExportedSpan> =>
  Array.from({ length: count }, (_, index) => ({ name, kind: "server", startMillis: start + index, durationMillis }))

// What a service's exporter does: POST the export with its component's key.
const send = Effect.fn("send")(function* (ingestKey: string, version: string, exported: ReadonlyArray<ExportedSpan>) {
  const http = yield* HttpClient.HttpClient
  const response = yield* http.execute(
    HttpClientRequest.post(`${baseUrl}/otlp/v1/traces`).pipe(
      HttpClientRequest.bearerToken(ingestKey),
      HttpClientRequest.bodyUint8Array(
        traceExport({ name: "notes-api", environment: "Production", version }, exported),
        "application/x-protobuf",
      ),
    ),
  )
  return response.status
})

// Real time: the Worker counts operations by the time they started, against its own clock.
layer(CluenoriClient.layer, { excludeTestServices: true })("releases", (it) => {
  it.effect("a release that made an operation slower shows as worse than the one before it", () =>
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      const project = ProjectKey.make("releases")
      yield* client.projects.createProject({ payload: { key: project, name: ProjectName.make("Notes") } })
      const { ingestKey } = yield* client.projects.addComponent({
        params: { project },
        payload: { key: api, name: ComponentName.make("Notes API") },
      })

      // The older release ran for an hour from three hours ago; the newer one for the last 70
      // minutes, its notes ten times slower.
      const now = DateTime.toEpochMillis(yield* DateTime.now)
      const statuses = [
        yield* send(ingestKey, older, spans("GET /api/notes/{id}", now - 180 * minute, 150, 20)),
        yield* send(ingestKey, older, spans("GET /api/notes/{id}", now - 120 * minute, 150, 20)),
        yield* send(ingestKey, newer, spans("GET /api/notes/{id}", now - 70 * minute, 150, 200)),
        yield* send(ingestKey, newer, spans("GET /api/notes/{id}", now - 2 * minute, 150, 200)),
      ]
      assert.deepStrictEqual(statuses, [200, 200, 200, 200])

      const { releases } = yield* client.releases.releases({
        params: { project },
        query: { from: DateTime.makeUnsafe(now - 6 * 60 * minute), to: DateTime.makeUnsafe(now + minute) },
      })
      assert.deepStrictEqual(
        releases.map((release) => [release.release, release.environment, release.verdict, release.count]),
        [
          [newer, EnvironmentKey.make("production"), "worse", 300],
          [older, EnvironmentKey.make("production"), "first", 300],
        ],
      )

      const detail = yield* client.releases.release({
        params: { project, component: api, release: newer },
        query: { environment: EnvironmentKey.make("production") },
      })
      assert.strictEqual(detail.summary.previous, older)
      assert.deepStrictEqual(
        detail.slower.map((operation) => operation.operation),
        [EnvelopeName.make("GET /api/notes/{id}")],
      )

      // A release the project never ran is not found.
      const unknown = yield* Effect.flip(
        client.releases.release({
          params: { project, component: api, release: ReleaseVersion.make("9.9.9") },
          query: {},
        }),
      )
      assert.strictEqual(unknown._tag, "ReleaseNotFound")
    }),
  )

  it.effect("a deploy reported from CI shows as a release with its commit, before its telemetry arrives", () =>
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      const http = yield* HttpClient.HttpClient
      const project = ProjectKey.make("deploys")
      yield* client.projects.createProject({ payload: { key: project, name: ProjectName.make("Notes") } })
      const { ingestKey } = yield* client.projects.addComponent({
        params: { project },
        payload: { key: api, name: ComponentName.make("Notes API") },
      })
      const linked = yield* client.projects.linkComponent({
        params: { project, component: api },
        payload: { repository: Repository.make("notes/notes-api") },
      })
      assert.strictEqual(linked.repository, "notes/notes-api")

      // What cluenori-release does: ask for the last deploy, then report this one.
      const write = (name: string, body: unknown) =>
        http.execute(
          HttpClientRequest.post(`${baseUrl}/ingest/v1/releases/${name}`).pipe(
            HttpClientRequest.bearerToken(ingestKey),
            HttpClientRequest.bodyJsonUnsafe(body),
          ),
        )
      const first = yield* write("last", { environment: "production" })
      assert.deepStrictEqual([first.status, yield* first.json], [200, {}])
      const commit = "e91f09c".padEnd(40, "0")
      const reported = yield* write("report", {
        release: newer,
        environment: "production",
        commit,
        tag: `prod-${newer}`,
      })
      assert.strictEqual(reported.status, 204)
      const since = yield* write("last", { environment: "production" })
      assert.deepStrictEqual(yield* since.json, { release: newer, commit })

      // A wrong key and a body that isn't a report are refused.
      const refused = yield* http.execute(
        HttpClientRequest.post(`${baseUrl}/ingest/v1/releases/report`).pipe(
          HttpClientRequest.bearerToken(`${ingestKey.slice(0, -1)}${ingestKey.endsWith("A") ? "B" : "A"}`),
          HttpClientRequest.bodyJsonUnsafe({ release: newer, commit }),
        ),
      )
      const invalid = yield* write("report", { release: newer })
      assert.deepStrictEqual([refused.status, invalid.status], [401, 400])

      const now = DateTime.toEpochMillis(yield* DateTime.now)
      const { releases } = yield* client.releases.releases({
        params: { project },
        query: { from: DateTime.makeUnsafe(now - 60 * minute), to: DateTime.makeUnsafe(now + minute) },
      })
      assert.deepStrictEqual(
        releases.map((release) => [release.release, release.verdict, release.commit?.tag, release.commit?.url]),
        [[newer, "unmeasured", `prod-${newer}`, `https://github.com/notes/notes-api/commit/${commit}`]],
      )
    }),
  )
})
