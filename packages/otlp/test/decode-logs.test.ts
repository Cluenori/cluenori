import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { Base64 } from "effect/encoding"

import { countResourceMetrics, decodeLogs } from "../src/index.ts"
import { dotnetLogs } from "./fixtures/dotnet-logs.ts"
import { dotnetMetrics } from "./fixtures/dotnet-metrics.ts"

const bytesOf = (base64: string) => Effect.fromResult(Base64.decode(base64)).pipe(Effect.orDie)

describe("decodeLogs", () => {
  it.effect("reads a .NET export's resource, categories and records", () =>
    Effect.gen(function* () {
      const body = yield* bytesOf(dotnetLogs)
      const [resource, ...others] = yield* decodeLogs(body)

      assert.isEmpty(others)
      assert.strictEqual(resource?.resource.get("service.name"), "notes-api")
      assert.deepStrictEqual(
        resource?.scopeLogs.map((scope) => [scope.scope.name, scope.logRecords.length]),
        [
          ["Microsoft.Hosting.Lifetime", 4],
          ["ExportLog", 9],
          ["System.Net.Http.HttpClient.self.LogicalHandler", 6],
          ["System.Net.Http.HttpClient.self.ClientHandler", 6],
          ["Microsoft.AspNetCore.Server.Kestrel", 2],
        ],
      )
    }),
  )

  it.effect("reads a record's time, level, message, template, and trace", () =>
    Effect.gen(function* () {
      const body = yield* bytesOf(dotnetLogs)
      const [resource] = yield* decodeLogs(body)
      const started = resource?.scopeLogs[1]?.logRecords[0]
      const listening = resource?.scopeLogs[0]?.logRecords[0]

      assert.deepInclude(started, {
        timeUnixNano: 1792442983387373000n,
        severityNumber: 9,
        severityText: "Information",
        body: "Export exp-3760 started with 3 notes",
        traceId: "782b83a9114f7ebce1fce192e59a0f7f",
        spanId: "dddb13203348b70b",
      })
      assert.strictEqual(started?.attributes.get("NoteCount"), 3)
      assert.strictEqual(listening?.eventName, "ListeningOnAddress")
      assert.strictEqual(listening?.attributes.get("{OriginalFormat}"), "Now listening on: {address}")
    }),
  )

  it.effect("reads an error's exception", () =>
    Effect.gen(function* () {
      const body = yield* bytesOf(dotnetLogs)
      const [resource] = yield* decodeLogs(body)
      const failure = resource?.scopeLogs[4]?.logRecords[0]

      assert.strictEqual(failure?.severityNumber, 17)
      assert.strictEqual(failure?.eventName, "ApplicationError")
      assert.strictEqual(failure?.attributes.get("exception.type"), "InvalidOperationException")
      assert.strictEqual(failure?.attributes.get("exception.message"), "Note store is unavailable")
      const stack = failure?.attributes.get("exception.stacktrace")
      assert.isString(stack)
      assert.include(stack, "InvalidOperationException: Note store is unavailable")
    }),
  )

  it.effect("refuses a body cut short", () =>
    Effect.gen(function* () {
      const body = yield* bytesOf(dotnetLogs)
      const error = yield* decodeLogs(body.subarray(0, 40)).pipe(Effect.flip)
      assert.match(error.message, /too early/)
    }),
  )
})

describe("countResourceMetrics", () => {
  it.effect("counts a .NET metrics export's resources, and refuses one cut short", () =>
    Effect.gen(function* () {
      const body = yield* bytesOf(dotnetMetrics)
      const resources = yield* countResourceMetrics(body)
      const error = yield* countResourceMetrics(body.subarray(0, body.length - 3)).pipe(Effect.flip)

      assert.strictEqual(resources, 1)
      assert.match(error.message, /too early/)
    }),
  )
})
