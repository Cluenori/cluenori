import { ComponentKey, ProjectKey } from "@cluenori/foundation"
import { ComponentName, ProjectName } from "@cluenori/projects"
import { assert, layer } from "@effect/vitest"
import { runDurableObjectAlarm } from "cloudflare:test"
import { env } from "cloudflare:workers"
import { DateTime, Effect } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"

import { baseUrl, CluenoriClient } from "./cluenori-client.ts"
import { traceExport } from "./trace-export.ts"

const failing = ProjectKey.make("today-failing")
const quiet = ProjectKey.make("today-quiet")

// Real time: the Worker counts operations by the time they started, against its own clock.
layer(CluenoriClient.layer, { excludeTestServices: true })("today", (it) => {
  it.effect("puts a failing operation's incident first, names a project that sends nothing, and has pulses", () =>
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      const http = yield* HttpClient.HttpClient
      // Two projects, each with an API: one fails, one never sends anything.
      for (const project of [failing, quiet]) {
        yield* client.projects.createProject({ payload: { key: project, name: ProjectName.make(project) } })
      }
      const api = ComponentKey.make("notes-api")
      const added = yield* client.projects.addComponent({
        params: { project: failing },
        payload: { key: api, name: ComponentName.make("Notes API") },
      })
      yield* client.projects.addComponent({
        params: { project: quiet },
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
      // The minute's check opens an incident for the failing export.
      assert.isTrue(yield* Effect.promise(() => runDurableObjectAlarm(env.PROJECT.getByName(`main/${failing}`))))

      const today = yield* client.today.today()

      const ours = today.items.filter((item) => item.project === failing || item.project === quiet)
      assert.deepStrictEqual(
        ours.map((item) =>
          item._tag === "incident" ? `incident: ${item.incident.title}` : `${item._tag}: ${item.project}`,
        ),
        ["incident: POST /api/export: 100% failed, usually none", `silent: ${quiet}`],
      )
      assert.includeMembers(
        today.projects.map((project) => project.key),
        [failing, quiet],
      )
      assert.deepStrictEqual(today.unanswered, [])

      // Each project's pulse, in the projects' order: the failing one's 10 operations, all failed, in
      // the hour they ran; the quiet one's nothing, and neither has apps' people.
      const pulseOf = (project: ProjectKey) => today.pulses?.find((pulse) => pulse.project === project)
      assert.deepStrictEqual(
        today.pulses?.map((pulse) => pulse.project),
        today.projects.map((project) => project.key),
      )
      assert.deepStrictEqual(
        pulseOf(failing)?.load.map((hour) => [DateTime.toEpochMillis(hour.start), hour.count, hour.errors]),
        [[Math.floor((now - 1_000) / 3_600_000) * 3_600_000, 10, 10]],
      )
      assert.isUndefined(pulseOf(failing)?.people)
      assert.deepStrictEqual(pulseOf(quiet), { project: quiet, load: [] })
    }),
  )
})
