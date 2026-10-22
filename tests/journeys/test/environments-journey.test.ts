import { ComponentKey, EnvironmentKey, ProjectKey } from "@cluenori/foundation"
import { ComponentName, ProjectName } from "@cluenori/projects"
import { assert, layer } from "@effect/vitest"
import { runDurableObjectAlarm } from "cloudflare:test"
import { env } from "cloudflare:workers"
import { DateTime, Effect } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"

import { baseUrl, CluenoriClient } from "./cluenori-client.ts"
import { traceExport } from "./trace-export.ts"

const project = ProjectKey.make("environments")
const api = ComponentKey.make("notes-api")

// Real time: the Worker counts operations by the time they started, against its own clock.
layer(CluenoriClient.layer, { excludeTestServices: true })("environments", (it) => {
  it.effect("keeps dev out of Today until the project calls it production, and lists the environments seen", () =>
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      const http = yield* HttpClient.HttpClient
      yield* client.projects.createProject({ payload: { key: project, name: ProjectName.make("Notes") } })
      const added = yield* client.projects.addComponent({
        params: { project },
        payload: { key: api, name: ComponentName.make("Notes API") },
      })
      const now = DateTime.toEpochMillis(yield* DateTime.now)
      // The same component, with the same key, in dev, failing, and in production, as usual.
      const send = (environment: string, failed: boolean) =>
        http.execute(
          HttpClientRequest.post(`${baseUrl}/otlp/v1/traces`).pipe(
            HttpClientRequest.bearerToken(added.ingestKey),
            HttpClientRequest.bodyUint8Array(
              traceExport(
                { name: "notes-api", environment },
                Array.from({ length: 10 }, (_, index) => ({
                  name: failed ? "POST /api/export" : "GET /api/notes",
                  kind: "server" as const,
                  startMillis: now - 1_000 + index,
                  durationMillis: 40,
                  failed,
                })),
              ),
              "application/x-protobuf",
            ),
          ),
        )
      yield* send("dev", true)
      yield* send("Production", false)
      assert.isTrue(yield* Effect.promise(() => runDurableObjectAlarm(env.PROJECT.getByName(`main/${project}`))))

      const detail = yield* client.projects.project({ params: { project } })
      const before = yield* client.today.today()
      const incidents = yield* client.incidents.incidents({ params: { project } })

      assert.deepStrictEqual(detail.environments, [EnvironmentKey.make("production"), EnvironmentKey.make("dev")])
      assert.deepStrictEqual(
        detail.settings?.productionEnvironments,
        ["prod", "production", "live"].map((name) => EnvironmentKey.make(name)),
      )
      // Dev's incident opened, but Today leaves it out.
      assert.deepStrictEqual(
        incidents.open.map((incident) => incident.environment),
        [EnvironmentKey.make("dev")],
      )
      assert.isEmpty(before.items.filter((item) => item.project === project))

      const settings = yield* client.projects.updateSettings({
        params: { project },
        payload: { productionEnvironments: [EnvironmentKey.make("production"), EnvironmentKey.make("dev")] },
      })
      const after = yield* client.today.today()

      assert.deepStrictEqual(settings.productionEnvironments, [
        EnvironmentKey.make("production"),
        EnvironmentKey.make("dev"),
      ])
      assert.deepStrictEqual(
        after.items.filter((item) => item.project === project).map((item) => item._tag),
        ["incident"],
      )
    }),
  )
})
