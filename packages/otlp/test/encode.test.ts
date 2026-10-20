import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { Base64 } from "effect/encoding"

import type { AnyValue, ResourceLogs } from "../src/index.ts"
import { decodeLogs, decodeTraces, encodeLogs, encodeTraces } from "../src/index.ts"
import { dotnetLogs } from "./fixtures/dotnet-logs.ts"
import { dotnetTracesWithExceptions } from "./fixtures/dotnet-traces-with-exceptions.ts"
import { dotnetTraces } from "./fixtures/dotnet-traces.ts"

const bytesOf = (base64: string) => Effect.fromResult(Base64.decode(base64)).pipe(Effect.orDie)

describe("encodeTraces and encodeLogs", () => {
  it.effect("write traces that decode to the same data", () =>
    Effect.gen(function* () {
      for (const fixture of [dotnetTraces, dotnetTracesWithExceptions]) {
        const body = yield* bytesOf(fixture)
        const decoded = yield* decodeTraces(body)
        const again = yield* decodeTraces(encodeTraces(decoded))
        assert.deepStrictEqual(again, decoded)
      }
    }),
  )

  it.effect("write logs that decode to the same data", () =>
    Effect.gen(function* () {
      const body = yield* bytesOf(dotnetLogs)
      const decoded = yield* decodeLogs(body)
      const again = yield* decodeLogs(encodeLogs(decoded))
      assert.deepStrictEqual(again, decoded)
    }),
  )

  it.effect("keep every kind of value, empty ones included", () =>
    Effect.gen(function* () {
      const attributes = new Map<string, AnyValue>([
        ["empty", ""],
        ["zero", 0],
        ["false", false],
        ["ratio", 0.25],
        ["nothing", null],
        ["bytes", new Uint8Array([1, 2])],
        ["list", ["a", "b"]],
        ["nested", new Map<string, AnyValue>([["inner", 1]])],
      ])
      const logs: ReadonlyArray<ResourceLogs> = [
        {
          resource: new Map([["service.name", "notes-api"]]),
          scopeLogs: [
            {
              scope: { name: "Notes", version: "" },
              logRecords: [
                {
                  timeUnixNano: 1n,
                  observedTimeUnixNano: 0n,
                  severityNumber: 13,
                  severityText: "Warning",
                  body: "Careful",
                  attributes,
                  traceId: undefined,
                  spanId: undefined,
                  eventName: "",
                },
              ],
            },
          ],
        },
      ]
      const again = yield* decodeLogs(encodeLogs(logs))
      assert.deepStrictEqual(again, logs)
    }),
  )
})
