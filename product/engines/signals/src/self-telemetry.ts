import { Effect, Layer } from "effect"
import { HttpMiddleware, HttpServerRequest } from "effect/http"
import type { HttpServerResponse } from "effect/http"

// Cluenori sends its own telemetry to itself. Ingesting telemetry is work that could make telemetry
// of its own, which, sent to the same deployment, would be ingested in turn, without end. So the
// deployment's own exports are marked, and ingesting a marked one makes none: telemetry about
// telemetry goes one hop at most.

/**
 * The header a deployment's own telemetry is sent with, `cluenori-telemetry: self`: its own
 * exports, such as the Worker's traces of ingesting others'. A request that carries it makes no
 * telemetry while it is handled.
 */
export const selfTelemetryHeader = "cluenori-telemetry"

/** The header's value that marks self-telemetry. */
export const selfTelemetryValue = "self"

/**
 * The resource attribute a deployment's own exports carry, `cluenori.self = true`, so what was
 * archived of them says so too.
 */
export const selfTelemetryAttribute = "cluenori.self"

// The routes that take telemetry, the only ones the header turns tracing off on: OTLP exports, and
// apps' batches. Anyone may send the header, so it can't hide any other route's work, such as a
// sign-in, from the deployment's traces; on these, it hides only the trace of ingesting, whose
// outcome is in what was ingested and its counts.
const takesTelemetry = (path: string) => path.startsWith("/otlp/v1/") || path === "/ingest/v1/app/batch"

/** Whether a request is the deployment's own telemetry: its header, on a route that takes telemetry. */
export const isSelfTelemetry = (request: HttpServerRequest.HttpServerRequest): boolean =>
  request.headers[selfTelemetryHeader] === selfTelemetryValue && takesTelemetry(request.url.split("?")[0] ?? "")

/**
 * The host's middleware for every route: a request of self-telemetry is handled with tracing off,
 * its own server span and every span inside it. With `selfTelemetryUntracedServer`, which turns off
 * the server span the platform makes around the middleware.
 */
export const selfTelemetryUntraced = <E, R>(
  app: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R | HttpServerRequest.HttpServerRequest>,
): Effect.Effect<HttpServerResponse.HttpServerResponse, E, R | HttpServerRequest.HttpServerRequest> =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    if (!isSelfTelemetry(request)) {
      return yield* app
    }
    return yield* app.pipe(Effect.withTracerEnabled(false))
  })

/** Turns off the server span of a request of self-telemetry, which the platform makes outside any middleware. */
export const selfTelemetryUntracedServer = Layer.succeed(HttpMiddleware.TracerDisabledWhen, isSelfTelemetry)
