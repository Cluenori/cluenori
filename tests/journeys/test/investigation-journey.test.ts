import { ComponentKey, ProjectKey, TraceId } from "@cluenori/foundation"
import { ComponentName, ProjectName } from "@cluenori/projects"
import { assert, layer } from "@effect/vitest"
import { DateTime, Effect } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"

import { baseUrl, CluenoriClient } from "./cluenori-client.ts"
import { logExport, traceExport } from "./trace-export.ts"

const service = { name: "notes-api", environment: "Production" }
const failedTrace = "5e3a1c9f0d2b4a6e8c7f1e2d3c4b5a69"

const stack = [
  "System.TimeoutException: Notification service did not answer",
  "   at Notes.Exports.Notifier.SendAsync(Export export) in /src/Notes/Exports/Notifier.cs:line 42",
  "   at Notes.Exports.ExportEndpoint.Handle(ExportRequest request) in /src/Notes/Exports/ExportEndpoint.cs:line 18",
].join("\n")

const sendTo = Effect.fn("sendTo")(function* (path: string, ingestKey: string, body: Uint8Array) {
  const http = yield* HttpClient.HttpClient
  const response = yield* http.execute(
    HttpClientRequest.post(`${baseUrl}/otlp/v1/${path}`).pipe(
      HttpClientRequest.bearerToken(ingestKey),
      HttpClientRequest.bodyUint8Array(body, "application/x-protobuf"),
    ),
  )
  return response.status
})

// Real time: the Worker keeps logs by the time they happened, against its own clock.
layer(CluenoriClient.layer, { excludeTestServices: true })("investigation", (it) => {
  it.effect("an error leads from its group to its request's spans and logs", () =>
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      const project = ProjectKey.make("investigation")
      yield* client.projects.createProject({ payload: { key: project, name: ProjectName.make("Notes") } })
      const { ingestKey } = yield* client.projects.addComponent({
        params: { project },
        payload: { key: ComponentKey.make("notes-api"), name: ComponentName.make("Notes API") },
      })

      // The service exports one failing request's spans and its logs, info included.
      const now = yield* DateTime.now
      const start = DateTime.toEpochMillis(now) - 2_000
      const traces = traceExport(service, [
        {
          name: "POST /api/export",
          kind: "server",
          startMillis: start,
          durationMillis: 520,
          failed: true,
          trace: failedTrace,
        },
        { name: "POST", kind: "client", startMillis: start + 10, durationMillis: 500, trace: failedTrace, parent: 0 },
      ])
      const logs = logExport(service, [
        {
          timeMillis: start + 5,
          severity: 9,
          category: "Notes.Exports",
          message: "Export started for anna@example.com",
          trace: failedTrace,
        },
        {
          timeMillis: start + 300,
          severity: 13,
          category: "Notes.Exports",
          message: "Notifier is slow",
          trace: failedTrace,
        },
        {
          timeMillis: start + 515,
          severity: 17,
          category: "Notes.Exports",
          message: "Export failed for anna@example.com",
          trace: failedTrace,
          exception: { type: "TimeoutException", message: "Notification service did not answer", stack },
        },
      ])
      const tracesStatus = yield* sendTo("traces", ingestKey, traces)
      const logsStatus = yield* sendTo("logs", ingestKey, logs)
      assert.deepStrictEqual([tracesStatus, logsStatus], [200, 200])

      // The error shows, grouped, with where it happened.
      const period = { from: DateTime.subtract(now, { hours: 1 }), to: DateTime.add(now, { minutes: 1 }) }
      const errors = yield* client.signals.errors({ params: { project }, query: period })
      const [timeout] = errors.groups
      if (timeout === undefined) {
        return yield* Effect.die("The failed export made no error group")
      }
      assert.strictEqual(timeout.title, "TimeoutException: Notification service did not answer")
      assert.strictEqual(timeout.culprit, "Notes.Exports.Notifier.SendAsync(Export export)")
      assert.strictEqual(timeout.occurrences, 1)

      // Its latest occurrence has the stack and the trace, and no email.
      const detail = yield* client.signals.error({ params: { project, error: timeout.id }, query: period })
      const [occurrence] = detail.latest
      assert.strictEqual(occurrence?.message, "Export failed for [email]")
      assert.include(occurrence?.exception?.stack ?? "", "Notifier.cs:line 42")
      assert.strictEqual(occurrence?.trace, failedTrace)

      // Warnings and errors can be searched; the info line is only in the archive.
      const warnings = yield* client.signals.logs({ params: { project }, query: { ...period, search: "slow" } })
      assert.deepStrictEqual(
        warnings.lines.map((line) => line.message),
        ["Notifier is slow"],
      )

      // The request, from the archive: its spans as a tree, and its logs at every level.
      const trace = yield* client.signals.trace({
        params: { project, trace: TraceId.make(failedTrace) },
        query: { around: occurrence?.time ?? now },
      })
      assert.deepStrictEqual(
        trace.spans.map((span) => [span.depth, span.name, span.failed]),
        [
          [0, "POST /api/export", true],
          [1, "POST", false],
        ],
      )
      assert.deepStrictEqual(
        trace.logs.map((log) => [log.level, log.message]),
        [
          ["info", "Export started for [email]"],
          ["warn", "Notifier is slow"],
          ["error", "Export failed for [email]"],
        ],
      )
    }),
  )

  it.effect("keeps metrics exports, so exporters that send everything to one address succeed", () =>
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      const project = ProjectKey.make("metrics")
      yield* client.projects.createProject({ payload: { key: project, name: ProjectName.make("Metrics") } })
      const { ingestKey } = yield* client.projects.addComponent({
        params: { project },
        payload: { key: ComponentKey.make("notes-api"), name: ComponentName.make("Notes API") },
      })
      // One ResourceMetrics with an empty resource: a well-formed export with nothing in it.
      const accepted = yield* sendTo("metrics", ingestKey, Uint8Array.from([0x0a, 0x02, 0x0a, 0x00]))
      const broken = yield* sendTo("metrics", ingestKey, Uint8Array.from([0x0a, 0x7f]))

      assert.deepStrictEqual([accepted, broken], [200, 400])
    }),
  )
})
