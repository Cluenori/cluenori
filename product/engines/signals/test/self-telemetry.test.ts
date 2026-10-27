import { decodeLogs, decodeTraces } from "@bagatka/otlp-protobuf"
import { ComponentKey, EnvironmentKey, ReleaseVersion } from "@cluenori/foundation"
import { assert, describe, it } from "@effect/vitest"
import { Effect, Layer, ManagedRuntime, Redacted } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/http"

import type { SelfTelemetryPath } from "../src/index.ts"
import {
  fromBaggage,
  SelfTelemetry,
  selfTelemetryHeader,
  selfTelemetryValue,
  telemetryCounted,
  telemetryUntraced,
  telemetryUntracedServer,
} from "../src/index.ts"

// A deployment that sends its own telemetry to itself, as the Worker does: routes that take
// telemetry and routes that do work for someone, each making spans and a warning; the real
// exporter, whose every export is sent to the same deployment, as its own; and a flush after each
// request, as the host hands one to `waitUntil`. The question is what N requests of each make.

const archive = Effect.fn("ingest.archive")(function* () {})

const receive = Effect.fn("ingest.record")(function* () {
  yield* archive()
  yield* Effect.logWarning("an export arrived")
  return HttpServerResponse.text("ok")
})

const lookUp = Effect.fn("projects.lookUp")(function* () {
  yield* Effect.logWarning("looked a project up")
  return HttpServerResponse.text("ok")
})

interface Sent {
  readonly path: SelfTelemetryPath
  readonly body: Uint8Array
  readonly headers: Readonly<Record<string, string>>
}

const deployment = () => {
  const sent: Array<Sent> = []
  const holder: { handler?: (request: Request) => Promise<Response> } = {}
  const telemetry = SelfTelemetry.layer({
    ingestKey: Redacted.make("cluenori.cluenori.worker.secret"),
    component: ComponentKey.make("worker"),
    release: ReleaseVersion.make("0.4.0+12"),
    environment: EnvironmentKey.make("production"),
    instance: Effect.succeed("test"),
    send: (path, body, headers) =>
      Effect.gen(function* () {
        sent.push({ path, body, headers })
        const handler = holder.handler
        if (handler === undefined) {
          return 0
        }
        const response = yield* Effect.promise(() =>
          handler(new Request(`https://cluenori.test${path}`, { method: "POST", headers, body })),
        )
        return response.status
      }),
  })
  const routes = Layer.mergeAll(
    HttpRouter.add("POST", "/otlp/v1/traces", receive()),
    HttpRouter.add("POST", "/otlp/v1/logs", receive()),
    HttpRouter.add("POST", "/ingest/v1/app/batch", receive()),
    HttpRouter.add("GET", "/api/projects/:project", lookUp()),
  )
  const memoMap = Layer.makeMemoMapUnsafe()
  const app = HttpRouter.toWebHandler(Layer.mergeAll(routes, telemetry, telemetryUntracedServer), {
    middleware: (handled) => fromBaggage(telemetryUntraced(telemetryCounted(handled))),
    disableLogger: true,
    memoMap,
  })
  holder.handler = (request) => app.handler(request)
  // The host's flush, on the same layer built once.
  const runtime = ManagedRuntime.make(telemetry, { memoMap })
  const flush = Effect.promise(() => runtime.runPromise(SelfTelemetry.use((recorded) => recorded.flush())))
  // One request, as the platform hands it to the Worker, and the flush the Worker hands to `waitUntil`.
  const invoke = (request: Request) =>
    Effect.gen(function* () {
      const response = yield* Effect.promise(() => app.handler(request))
      yield* flush
      return response.status
    })
  return { invoke, flush, sent, dispose: () => app.dispose() }
}

const spansIn = (sent: ReadonlyArray<Sent>) =>
  Effect.forEach(
    sent.filter((each) => each.path === "/otlp/v1/traces"),
    (each) => decodeTraces(each.body),
  ).pipe(
    Effect.map((exports) => exports.flat().flatMap((resource) => resource.scopeSpans.flatMap((scope) => scope.spans))),
  )

const pathsOf = (sent: ReadonlyArray<Sent>) => sent.map((each) => each.path)

describe("self-telemetry", () => {
  it.effect("N exports and app batches received make no telemetry but one count", () =>
    Effect.gen(function* () {
      const { invoke, flush, sent, dispose } = deployment()
      for (let index = 0; index < 30; index++) {
        // Each route also as the router reads it: with a trailing slash, doubled slashes, or escaped.
        for (const path of [
          "/otlp/v1/traces",
          "/otlp/v1/logs",
          "/ingest/v1/app/batch",
          "/otlp/v1/traces/",
          "/otlp//v1/logs",
          "/ingest/v1/app/%62atch",
        ]) {
          const status = yield* invoke(new Request(`https://cluenori.test${path}`, { method: "POST" }))
          assert.strictEqual(status, 200)
        }
      }
      // 180 requests of others' telemetry: their spans and warnings were never recorded; their count
      // is one sum, sent once in the minute.
      assert.deepStrictEqual(pathsOf(sent), ["/otlp/v1/metrics"])
      yield* flush
      assert.deepStrictEqual(pathsOf(sent), ["/otlp/v1/metrics"])
      yield* Effect.promise(dispose)
    }),
  )

  it.effect("N requests of work are sent as N exports, and receiving them makes none", () =>
    Effect.gen(function* () {
      const { invoke, flush, sent, dispose } = deployment()
      for (let index = 0; index < 5; index++) {
        const status = yield* invoke(new Request("https://cluenori.test/api/projects/notes"))
        assert.strictEqual(status, 200)
      }
      // Each request: its spans, then its warning; and the count of the exports it received, once.
      const sentOfWork = pathsOf(sent)
      assert.strictEqual(sentOfWork.filter((path) => path === "/otlp/v1/traces").length, 5)
      assert.strictEqual(sentOfWork.filter((path) => path === "/otlp/v1/logs").length, 5)
      assert.strictEqual(sentOfWork.filter((path) => path === "/otlp/v1/metrics").length, 1)
      // Receiving them was untraced, so nothing waits: flushing again, and again, sends nothing.
      yield* flush
      yield* flush
      assert.strictEqual(sent.length, sentOfWork.length)

      // What was sent: the server span by its method and route, the handler's span inside it, as
      // the deployment's own, with its key.
      const spans = yield* spansIn(sent)
      assert.deepStrictEqual(
        spans.slice(0, 2).map((span) => [span.name, span.kind]),
        [
          ["projects.lookUp", "internal"],
          ["GET /api/projects/{project}", "server"],
        ],
      )
      assert.strictEqual(spans.length, 10)
      const first = sent[0]
      assert.strictEqual(first?.headers[selfTelemetryHeader], selfTelemetryValue)
      assert.strictEqual(first?.headers["authorization"], "Bearer cluenori.cluenori.worker.secret")
      const [traces] = yield* decodeTraces(first?.body ?? new Uint8Array())
      assert.strictEqual(traces?.resource.attributes.get("service.name"), "worker")
      assert.strictEqual(traces?.resource.attributes.get("service.version"), "0.4.0+12")
      assert.strictEqual(traces?.resource.attributes.get("cluenori.self"), true)
      const logs = sent.find((each) => each.path === "/otlp/v1/logs")
      const [logged] = yield* decodeLogs(logs?.body ?? new Uint8Array())
      const record = logged?.scopeLogs[0]?.logRecords[0]
      assert.strictEqual(record?.body, "looked a project up")
      assert.strictEqual(record?.severityText, "WARN")
      yield* Effect.promise(dispose)
    }),
  )

  it.effect("a request's baggage names its feature and origin on its operation and logs", () =>
    Effect.gen(function* () {
      const { invoke, sent, dispose } = deployment()
      yield* invoke(
        new Request("https://cluenori.test/api/projects/notes", {
          headers: {
            baggage:
              "other=1,cluenori.feature=tech.errors,cluenori.origin.component=ios;p=1,cluenori.origin.release=0.3.0+20,cluenori.origin.component=Not A Key",
          },
        }),
      )
      const spans = yield* spansIn(sent)
      const server = spans.find((span) => span.kind === "server")
      assert.strictEqual(server?.attributes.get("cluenori.feature"), "tech.errors")
      // An entry whose value keeps no rule is ignored.
      assert.strictEqual(server?.attributes.get("cluenori.origin.component"), "ios")
      assert.strictEqual(server?.attributes.get("cluenori.origin.release"), "0.3.0+20")
      const logs = sent.find((each) => each.path === "/otlp/v1/logs")
      const [logged] = yield* decodeLogs(logs?.body ?? new Uint8Array())
      assert.strictEqual(logged?.scopeLogs[0]?.logRecords[0]?.attributes.get("cluenori.feature"), "tech.errors")
      yield* Effect.promise(dispose)
    }),
  )

  it.effect("building it asks for nothing until the first flush, as a Worker's global scope requires", () =>
    Effect.gen(function* () {
      // A Worker builds its layers when its module loads, where workerd refuses random values and
      // I/O: a build that made the instance's ID failed every request after.
      let asked = 0
      const telemetry = SelfTelemetry.layer({
        ingestKey: Redacted.make("cluenori.cluenori.worker.secret"),
        component: ComponentKey.make("worker"),
        release: undefined,
        environment: EnvironmentKey.make("production"),
        instance: Effect.sync(() => {
          asked += 1
          return "test"
        }),
        send: () => Effect.succeed(200),
      })
      const runtime = ManagedRuntime.make(telemetry)
      yield* Effect.promise(() => runtime.runPromise(Effect.void.pipe(Effect.withSpan("api.request"))))
      assert.strictEqual(asked, 0)
      yield* Effect.promise(() => runtime.runPromise(SelfTelemetry.use((recorded) => recorded.flush())))
      yield* Effect.promise(() => runtime.runPromise(Effect.void.pipe(Effect.withSpan("api.request"))))
      yield* Effect.promise(() => runtime.runPromise(SelfTelemetry.use((recorded) => recorded.flush())))
      assert.strictEqual(asked, 1)
      yield* Effect.promise(() => runtime.dispose())
    }),
  )

  it.effect("a slow receiver holds one export in memory, however many requests flush meanwhile", () =>
    Effect.gen(function* () {
      // A receiver that answers nothing until the end: each send waits.
      let waiting = 0
      const answers: Array<() => void> = []
      const telemetry = SelfTelemetry.layer({
        ingestKey: Redacted.make("cluenori.cluenori.worker.secret"),
        component: ComponentKey.make("worker"),
        release: undefined,
        environment: EnvironmentKey.make("production"),
        instance: Effect.succeed("test"),
        send: () =>
          Effect.callback<number>((resume) => {
            waiting += 1
            answers.push(() => resume(Effect.succeed(200)))
          }),
      })
      const runtime = ManagedRuntime.make(telemetry)
      const flushes: Array<Promise<void>> = []
      for (let index = 0; index < 50; index++) {
        yield* Effect.promise(() => runtime.runPromise(Effect.void.pipe(Effect.withSpan("api.request"))))
        flushes.push(runtime.runPromise(SelfTelemetry.use((recorded) => recorded.flush())))
      }
      // Time for every flush to reach the receiver, on the runtime's own clock.
      yield* Effect.promise(() => runtime.runPromise(Effect.sleep("20 millis")))
      assert.strictEqual(waiting, 1)
      for (const answer of answers) {
        answer()
      }
      yield* Effect.promise(() => Promise.all(flushes))
      yield* Effect.promise(() => runtime.dispose())
    }),
  )

  it.effect("the mark turns tracing off on no route but those that take telemetry", () =>
    Effect.gen(function* () {
      const { invoke, sent, dispose } = deployment()
      yield* invoke(
        new Request("https://cluenori.test/api/projects/notes", {
          headers: { [selfTelemetryHeader]: selfTelemetryValue },
        }),
      )
      // A request of work sent with the mark is traced like any other.
      const spans = yield* spansIn(sent)
      assert.strictEqual(spans.length, 2)
      yield* Effect.promise(dispose)
    }),
  )
})
