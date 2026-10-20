import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { Base64 } from "effect/encoding"

import type { Span } from "../src/index.ts"
import { decodeTraces, exportResponse } from "../src/index.ts"
import { dotnetTracesWithExceptions } from "./fixtures/dotnet-traces-with-exceptions.ts"
import { dotnetTraces } from "./fixtures/dotnet-traces.ts"
import { field, text, varint } from "./protobuf-writer.ts"

const bytesOf = (base64: string) => Effect.fromResult(Base64.decode(base64)).pipe(Effect.orDie)

const spansOf = (base64: string) =>
  bytesOf(base64).pipe(
    Effect.flatMap(decodeTraces),
    Effect.map((resources) => resources.flatMap((resource) => resource.scopeSpans.flatMap((scope) => scope.spans))),
  )

const named = (spans: ReadonlyArray<Span>, spanId: string) => spans.find((span) => span.spanId === spanId)

describe("decodeTraces", () => {
  it.effect("reads the resource and scopes of a .NET export", () =>
    Effect.gen(function* () {
      const body = yield* bytesOf(dotnetTraces)
      const [resource, ...others] = yield* decodeTraces(body)

      assert.isEmpty(others)
      assert.strictEqual(resource?.resource.get("service.name"), "notes-api")
      assert.strictEqual(resource?.resource.get("service.version"), "2.4.0+312")
      assert.strictEqual(resource?.resource.get("deployment.environment.name"), "Production")
      assert.deepStrictEqual(
        resource?.scopeSpans.map((scope) => [scope.scope.name, scope.spans.length]),
        [
          ["Microsoft.AspNetCore", 16],
          ["System.Net.Http", 3],
        ],
      )
    }),
  )

  it.effect("reads a request's IDs, times, attributes and status exactly", () =>
    Effect.gen(function* () {
      const spans = yield* spansOf(dotnetTraces)
      const first = named(spans, "6ca9ea5436af6a02")

      assert.deepInclude(first, {
        traceId: "3d4a2030aab208ac7e247302407bdefb",
        parentSpanId: undefined,
        name: "GET /api/notes/{id}",
        kind: "server",
        startTimeUnixNano: 1792442983314811000n,
        endTimeUnixNano: 1792442983346922000n,
        status: { code: "unset", message: "" },
      })
      assert.strictEqual(first?.attributes.get("http.route"), "/api/notes/{id}")
      assert.strictEqual(first?.attributes.get("http.response.status_code"), 200)
      assert.strictEqual(first?.attributes.get("server.port"), 5099)
    }),
  )

  it.effect("reads failed requests, nested calls, and client spans", () =>
    Effect.gen(function* () {
      const spans = yield* spansOf(dotnetTraces)
      const failed = named(spans, "82e53fac96886def")
      const nested = named(spans, "62aeca2afa2c82b5")
      const client = named(spans, "c9fd60eb7e99a00d")

      assert.deepStrictEqual(failed?.status, { code: "error", message: "" })
      assert.strictEqual(failed?.attributes.get("error.type"), "System.InvalidOperationException")
      assert.strictEqual(nested?.parentSpanId, "c9fd60eb7e99a00d")
      assert.strictEqual(client?.kind, "client")
      assert.strictEqual(client?.parentSpanId, "dddb13203348b70b")
      assert.strictEqual(spans.length, 19)
    }),
  )

  it.effect("reads the exception events of failed requests", () =>
    Effect.gen(function* () {
      const spans = yield* spansOf(dotnetTracesWithExceptions)
      const events = spans.filter((span) => span.status.code === "error").flatMap((span) => span.events)

      assert.strictEqual(events.length, 2)
      assert.strictEqual(events[0]?.name, "exception")
      assert.strictEqual(events[0]?.attributes.get("exception.type"), "System.InvalidOperationException")
    }),
  )

  it.effect("skips fields it doesn't know, as protobuf requires", () =>
    Effect.gen(function* () {
      const body = yield* bytesOf(dotnetTraces)
      const unknownField = [...varint(99 * 8), ...varint(7)]
      const withUnknown = Uint8Array.from([...unknownField, ...body])
      const spans = yield* decodeTraces(withUnknown)

      assert.strictEqual(spans.length, 1)
    }),
  )

  it.effect("refuses a body cut short, saying where", () =>
    Effect.gen(function* () {
      const body = yield* bytesOf(dotnetTraces)
      const error = yield* decodeTraces(body.subarray(0, body.length - 10)).pipe(Effect.flip)

      assert.strictEqual(error._tag, "OtlpInvalid")
      assert.match(error.message, /ends \d+ bytes too early, at byte \d+/)
    }),
  )

  it.effect("refuses a wire type protobuf 3 doesn't use", () =>
    Effect.gen(function* () {
      const error = yield* decodeTraces(Uint8Array.from([0x0b])).pipe(Effect.flip)
      assert.include(error.message, "Wire type 3")
    }),
  )

  it.effect("refuses attribute values nested deeper than 16 levels", () =>
    Effect.gen(function* () {
      // AnyValue { array_value (5): ArrayValue { values (1): AnyValue { ... } } }, 20 levels down.
      const nested = Array.from({ length: 20 }).reduce<Array<number>>(
        (inner) => field(5, field(1, inner)),
        field(1, text("deep")),
      )
      const attribute = field(1, [...field(1, text("k")), ...field(2, nested)])
      const body = Uint8Array.from(field(1, field(1, attribute)))
      const error = yield* decodeTraces(body).pipe(Effect.flip)

      assert.include(error.message, "nest deeper than 16 levels")
    }),
  )

  it.effect("reads an empty body as no spans", () =>
    Effect.gen(function* () {
      const resources = yield* decodeTraces(new Uint8Array(0))
      assert.isEmpty(resources)
    }),
  )
})

describe("exportResponse", () => {
  it("says everything was accepted with an empty message", () => {
    assert.strictEqual(exportResponse().length, 0)
  })

  it("says how many items were refused and why", () => {
    const message = "A request ends before it starts"
    const expected = field(1, [...varint(8), ...varint(3), ...field(2, text(message))])
    assert.deepStrictEqual([...exportResponse({ count: 3, message })], expected)
  })
})
