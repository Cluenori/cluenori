import { assert, describe, it } from "@effect/vitest"
import { Effect, Layer, Tracer } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/http"

import {
  selfTelemetryHeader,
  selfTelemetryUntraced,
  selfTelemetryUntracedServer,
  selfTelemetryValue,
} from "../src/index.ts"

// A deployment that sends its own traces to itself: an ingest route whose handling makes spans, a
// tracer whose every ended span is exported, and each export sent to the same route again, marked
// as the deployment's own, as its exporter sends them. The question is whether that settles.

const archive = Effect.fn("ingest.archive")(function* () {})

const ingestWork = Effect.fn("ingest.record")(function* () {
  yield* archive()
  return HttpServerResponse.text("ok")
})

const deployment = (guarded: boolean, path: `/${string}` = "/otlp/v1/traces") => {
  const ended: Array<string> = []
  const tracer = Tracer.make({
    span(options) {
      const span = new Tracer.NativeSpan(options)
      const end = span.end.bind(span)
      span.end = (endTime, exit) => {
        ended.push(span.name)
        end(endTime, exit)
      }
      return span
    },
  })
  const route = HttpRouter.add("POST", path, ingestWork())
  const app = HttpRouter.toWebHandler(
    Layer.mergeAll(route, Layer.succeed(Tracer.Tracer, tracer), guarded ? selfTelemetryUntracedServer : Layer.empty),
    guarded ? { middleware: selfTelemetryUntraced, disableLogger: true } : { disableLogger: true },
  )
  return { app, ended }
}

const post = (marked: boolean) =>
  new Request("https://cluenori.test/otlp/v1/traces", {
    method: "POST",
    headers: marked ? { [selfTelemetryHeader]: selfTelemetryValue } : {},
  })

/**
 * Sends `n` exports of others, then, round after round, one marked export for each span the round
 * before made, as the deployment's exporter would; the spans each round made.
 */
const run = (guarded: boolean, n: number, rounds: number) =>
  Effect.gen(function* () {
    const { app, ended } = deployment(guarded)
    const made: Array<number> = []
    let waiting = 0
    for (let round = 0; round <= rounds; round++) {
      const before = ended.length
      const count = round === 0 ? n : waiting
      for (let index = 0; index < count; index++) {
        const response = yield* Effect.promise(() => app.handler(post(round > 0)))
        assert.strictEqual(response.status, 200)
      }
      waiting = ended.length - before
      made.push(waiting)
    }
    yield* Effect.promise(() => app.dispose())
    return made
  })

describe("self-telemetry", () => {
  it.effect("N exports of others make telemetry once, and ingesting it makes none", () =>
    Effect.gen(function* () {
      const made = yield* run(true, 25, 4)
      // Each export: its server span and the two spans of its handling; then nothing, ever.
      assert.deepStrictEqual(made, [75, 0, 0, 0, 0])
    }),
  )

  it.effect("the mark turns tracing off only on routes that take telemetry", () =>
    Effect.gen(function* () {
      const { app, ended } = deployment(true, "/api/sign-in")
      const response = yield* Effect.promise(() =>
        app.handler(
          new Request("https://cluenori.test/api/sign-in", {
            method: "POST",
            headers: { [selfTelemetryHeader]: selfTelemetryValue },
          }),
        ),
      )
      assert.strictEqual(response.status, 200)
      yield* Effect.promise(() => app.dispose())
      // A sign-in sent with the mark is traced like any other.
      assert.deepStrictEqual(ended.toSorted(), ["POST", "ingest.archive", "ingest.record"].toSorted())
    }),
  )

  it.effect("without the mark honored, telemetry about telemetry grows every round", () =>
    Effect.gen(function* () {
      const made = yield* run(false, 2, 3)
      assert.deepStrictEqual(made, [6, 18, 54, 162])
    }),
  )
})
