import { Effect, Layer } from "effect"
import { FindMyWay, HttpMiddleware, HttpServerRequest } from "effect/http"
import type { HttpServerResponse } from "effect/http"

// Cluenori sends its own telemetry to itself. Receiving telemetry is work that could make telemetry
// of its own, which, sent to the same deployment, would be received in turn, without end; and even
// one hop makes telemetry for every export received, which grows with what others send. So
// receiving telemetry is never traced: its outcome is in what was received and its counts, and the
// deployment's own telemetry about it is at most a count (`SelfTelemetry.countIngest`).

/**
 * The header a deployment's own telemetry is sent with, `cluenori-telemetry: self`: its own
 * exports, such as the Worker's traces of the API's requests.
 */
export const selfTelemetryHeader = "cluenori-telemetry"

/** The header's value that marks self-telemetry. */
export const selfTelemetryValue = "self"

/**
 * The resource attribute a deployment's own exports carry, `cluenori.self = true`, so what was
 * archived of them says so too.
 */
export const selfTelemetryAttribute = "cluenori.self"

type TelemetryRoute = "otlp.traces" | "otlp.logs" | "otlp.metrics" | "app.batch"

// The routes that take telemetry, matched as the Worker's router matches them (FindMyWay with its
// defaults): so `/otlp/v1/traces/`, `/otlp//v1/traces` and `/otlp/v1/%74races`, which reach the
// same handler, are the same route here too. A host that configures its router otherwise must
// configure this one alike.
const telemetryRoutes = FindMyWay.make<TelemetryRoute>()
telemetryRoutes.all("/otlp/v1/traces", "otlp.traces")
telemetryRoutes.all("/otlp/v1/logs", "otlp.logs")
telemetryRoutes.all("/otlp/v1/metrics", "otlp.metrics")
telemetryRoutes.all("/ingest/v1/app/batch", "app.batch")

/**
 * The route a request brings telemetry to, by its path, however the router would read it: OTLP's
 * exports and apps' batches; undefined for every other route, the API's, the manifest's and
 * modules' ingest writes, which are work done for someone and traced like it.
 */
export const telemetryRouteOf = (path: string): TelemetryRoute | undefined =>
  telemetryRoutes.find("POST", path)?.handler

/** Whether a request brings telemetry: to a route of `telemetryRouteOf`, whoever sent it. */
export const takesTelemetry = (request: HttpServerRequest.HttpServerRequest): boolean =>
  telemetryRouteOf(request.url) !== undefined

/**
 * The host's middleware for every route: a request that brings telemetry is handled with tracing
 * off, its own server span and every span and log inside it, so receiving N exports or batches
 * makes no telemetry of its own. With `telemetryUntracedServer`, which turns off the server span the
 * platform makes around the middleware.
 */
export const telemetryUntraced = <E, R>(
  app: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R | HttpServerRequest.HttpServerRequest>,
): Effect.Effect<HttpServerResponse.HttpServerResponse, E, R | HttpServerRequest.HttpServerRequest> =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    if (!takesTelemetry(request)) {
      return yield* app
    }
    return yield* app.pipe(Effect.withTracerEnabled(false))
  })

/** Turns off the server span of a request that brings telemetry, which the platform makes outside any middleware. */
export const telemetryUntracedServer = Layer.succeed(HttpMiddleware.TracerDisabledWhen, takesTelemetry)
