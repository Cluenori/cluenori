import { ComponentKey, ProjectKey } from "@cluenori/foundation"
import { IncidentId, MonitorUrl } from "@cluenori/incidents"
import { ComponentName, ProjectName } from "@cluenori/projects"
import { assert, layer } from "@effect/vitest"
import { runDurableObjectAlarm } from "cloudflare:test"
import { env } from "cloudflare:workers"
import { DateTime, Effect } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"

import { baseUrl, CluenoriClient } from "./cluenori-client.ts"
import { traceExport } from "./trace-export.ts"

const notesApi = { name: "notes-api", environment: "Production" }

// A name that never resolves, so its checks fail the same way on every machine. Locally, workerd
// logs an "internal error" for each fetch of it, even one whose failure is handled.
const unreachable = MonitorUrl.make("https://notes-api.invalid/health")

// The minute's check the project's object runs on its alarm.
const runCheck = (project: ProjectKey) =>
  Effect.promise(() => runDurableObjectAlarm(env.PROJECT.getByName(`main/${project}`)))

// Real time: the Worker counts operations by the time they started, against its own clock.
layer(CluenoriClient.layer, { excludeTestServices: true })("incidents", (it) => {
  it.effect("a failing operation and a monitor that can't connect open incidents; someone acknowledges one", () =>
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      const http = yield* HttpClient.HttpClient
      // Set up: a project, its API with an ingest key, and a monitor of its health endpoint.
      const project = ProjectKey.make("watched")
      const api = ComponentKey.make("notes-api")
      yield* client.projects.createProject({ payload: { key: project, name: ProjectName.make("Notes") } })
      const added = yield* client.projects.addComponent({
        params: { project },
        payload: { key: api, name: ComponentName.make("Notes API") },
      })
      const monitor = yield* client.incidents.addMonitor({
        params: { project },
        payload: { component: api, url: unreachable },
      })

      // The API's exporter sends ten exports that all failed.
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
          HttpClientRequest.bodyUint8Array(traceExport(notesApi, failed), "application/x-protobuf"),
        ),
      )

      // The next check opens an incident for the export; the monitor has failed once.
      assert.isTrue(yield* runCheck(project))
      const first = yield* client.incidents.incidents({ params: { project } })
      assert.deepStrictEqual(
        first.open.map((incident) => [incident.evidence._tag, incident.title]),
        [["failing", "POST /api/export: 100% failed, usually none"]],
      )
      assert.isDefined(first.checkedAt)

      // The one after opens one for the monitor, down two checks in a row.
      assert.isTrue(yield* runCheck(project))
      const second = yield* client.incidents.incidents({ params: { project } })
      assert.deepStrictEqual(second.open.map((incident) => incident.title).toSorted(), [
        "POST /api/export: 100% failed, usually none",
        "https://notes-api.invalid/health is down: Could not connect",
      ])
      const monitors = yield* client.incidents.monitors({ params: { project } })
      assert.strictEqual(monitors.monitors[0]?.lastCheck?.problem, "Could not connect")

      // Someone is on the failing export.
      const exporting = second.open.find((incident) => incident.evidence._tag === "failing")
      if (exporting === undefined) {
        return assert.fail("The failing export's incident is gone")
      }
      const acknowledged = yield* client.incidents.acknowledge({ params: { project, incident: exporting.id } })
      assert.isDefined(acknowledged.acknowledgedAt)

      // The incident opens by its ID with its life; the monitor with its failed checks and its incident.
      const life = yield* client.incidents.incident({ params: { project, incident: exporting.id } })
      assert.deepStrictEqual(
        life.updates.map((update) => [update.change, update.title]),
        [
          ["opened", "POST /api/export: 100% failed, usually none"],
          ["acknowledged", undefined],
        ],
      )
      const watched = yield* client.incidents.monitor({ params: { project, monitor: monitor.id } })
      assert.deepStrictEqual(
        watched.failures.map((check) => check.problem),
        ["Could not connect", "Could not connect"],
      )
      assert.deepStrictEqual(
        watched.incidents.map((incident) => incident.title),
        ["https://notes-api.invalid/health is down: Could not connect"],
      )
      // Two checks, both failed, on the UTC day they ran in (or two, around midnight).
      assert.deepStrictEqual(
        watched.state.days.reduce(
          (sum, day) => ({ checks: sum.checks + day.checks, failed: sum.failed + day.failed }),
          { checks: 0, failed: 0 },
        ),
        { checks: 2, failed: 2 },
      )

      // Removing the monitor resolves its incident.
      yield* client.incidents.removeMonitor({ params: { project, monitor: monitor.id } })
      const third = yield* client.incidents.incidents({ params: { project } })
      assert.deepStrictEqual(
        third.resolved.map((incident) => incident.title),
        ["https://notes-api.invalid/health is down: Could not connect"],
      )

      // An incident that isn't the project's, and a project that doesn't exist, are not found.
      const unknown = yield* Effect.flip(
        client.incidents.acknowledge({
          params: { project, incident: IncidentId.make("0199f7a2-5c1e-7d3a-9b2f-4e8a1c6d0f53") },
        }),
      )
      const missing = yield* Effect.flip(
        client.incidents.incidents({ params: { project: ProjectKey.make("never-made") } }),
      )
      const removed = yield* Effect.flip(client.incidents.monitor({ params: { project, monitor: monitor.id } }))
      assert.strictEqual(removed._tag, "MonitorNotFound")
      assert.strictEqual(unknown._tag, "IncidentNotFound")
      assert.strictEqual(missing._tag, "ProjectNotFound")
    }),
  )
})
