import type { AnyValue, LogRecord, Span, SpanKind } from "@bagatka/otlp-protobuf"
import { encodeLogs, encodeTraces, SpanId, TraceId } from "@bagatka/otlp-protobuf"
import type { ComponentKey, EnvironmentKey, ReleaseVersion } from "@cluenori/foundation"
import {
  Cause,
  Clock,
  Context,
  Duration,
  Effect,
  Exit,
  Layer,
  Logger,
  Option,
  Redacted,
  References,
  Schema,
  Tracer,
} from "effect"
import type { HttpServerResponse } from "effect/http"
import { HttpServerRequest } from "effect/http"
import { OtlpSerialization } from "effect/observability"

import { selfTelemetryAttribute, selfTelemetryHeader, selfTelemetryValue, telemetryRouteOf } from "./self-telemetry.ts"

// The deployment's own telemetry: its spans, warnings and errors, recorded in memory while it
// works, and sent to itself as OTLP exports when the host says, at the end of each request, alarm
// or queue batch. A Worker can't rely on work after its response unless it hands it to the
// platform, so nothing here runs in the background: the host calls `flush` and gives it to
// `waitUntil`. Its loss is harmless; it is telemetry.

/** Where an export of the deployment's own telemetry goes: its own OTLP routes. */
export type SelfTelemetryPath = "/otlp/v1/traces" | "/otlp/v1/logs" | "/otlp/v1/metrics"

/** What the deployment's own telemetry needs: values, never where they come from. */
export interface SelfTelemetrySettings {
  /** The ingest key of the component the deployment reports itself as, such as `worker`. */
  readonly ingestKey: Redacted.Redacted
  /** That component: its `service.name`. */
  readonly component: ComponentKey
  /** The deployment's release, its `service.version`; absent when the deploy didn't say. */
  readonly release: ReleaseVersion | undefined
  readonly environment: EnvironmentKey
  /** Which isolate or object sends, `service.instance.id`, so its counts since it started are told apart. */
  readonly instance: string
  /**
   * Sends one export to the deployment's own OTLP route, as an exporter would, with these headers;
   * succeeds with the HTTP status it answered. A failure to reach it is a defect, which the
   * exporter logs and forgets.
   */
  readonly send: (
    path: SelfTelemetryPath,
    body: Uint8Array,
    headers: Readonly<Record<string, string>>,
  ) => Effect.Effect<number>
}

/** At most this many spans and log records wait to be sent; past it, new ones are dropped and counted. */
export const selfTelemetryLimits = { spans: 2_000, logs: 500 } as const

// The count of ingest is sent at most this often, whatever arrives.
const countEvery = Duration.minutes(1)

/** The deployment's own telemetry, recorded as it works. */
export class SelfTelemetry extends Context.Service<
  SelfTelemetry,
  {
    /**
     * Sends what was recorded since the last flush: its spans, and its warnings and errors, each
     * kind as one export; and the count of telemetry received, at most once a minute and only when
     * it changed. With `olderThan`, only when what waits is at least that old, so an object that
     * works every minute sends every few. One at a time: called while another sends, it returns at
     * once and leaves what waits to the next. Never fails: an export the deployment refuses or
     * can't take is dropped, and logged to the console alone.
     */
    readonly flush: (options?: { readonly olderThan?: Duration.Duration }) => Effect.Effect<void>
    /**
     * Counts one request that brought telemetry, by its route and the status it was answered with:
     * the only telemetry receiving makes, sent as a sum by `flush`.
     */
    readonly countIngest: (route: string, status: number) => Effect.Effect<void>
  }
>()("@cluenori/signals/self-telemetry-exporter/SelfTelemetry") {
  /**
   * Records the deployment's own spans (the tracer of every effect it provides), its warnings and
   * errors (a logger beside the others), and the count of ingest, to send with `flush`. Spans and
   * logs of a fiber whose tracing is off, such as receiving telemetry, aren't recorded.
   */
  static readonly layer = (settings: SelfTelemetrySettings) => {
    const recorder = Layer.effect(Recorder, makeRecorder(settings))
    return Layer.mergeAll(
      Layer.effect(
        SelfTelemetry,
        Effect.map(Recorder, (recorded) =>
          SelfTelemetry.of({ flush: recorded.flush, countIngest: recorded.countIngest }),
        ),
      ),
      Layer.effect(
        Tracer.Tracer,
        Effect.map(Recorder, (recorded) => recorded.tracer),
      ),
      Logger.layer([Effect.map(Recorder, (recorded) => recorded.logger)], { mergeWithExisting: true }),
    ).pipe(Layer.provide(recorder), Layer.provide(OtlpSerialization.layerProtobuf))
  }

  /** No telemetry of its own: a deployment that doesn't report itself. */
  static readonly layerOff = Layer.succeed(
    SelfTelemetry,
    SelfTelemetry.of({ flush: () => Effect.void, countIngest: () => Effect.void }),
  )
}

/**
 * The host's middleware for every route, inside `telemetryUntraced`: counts each request that brought
 * telemetry by its route and the status it was answered with.
 */
export const telemetryCounted = <E, R>(
  app: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R | HttpServerRequest.HttpServerRequest>,
): Effect.Effect<HttpServerResponse.HttpServerResponse, E, R | HttpServerRequest.HttpServerRequest | SelfTelemetry> =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const route = telemetryRouteOf(request.url)
    if (route === undefined) {
      return yield* app
    }
    const telemetry = yield* SelfTelemetry
    const response = yield* app
    yield* telemetry.countIngest(route, response.status)
    return response
  })

interface Recorded {
  readonly tracer: Tracer.Tracer
  readonly logger: Logger.Logger<unknown, void>
  readonly flush: (options?: { readonly olderThan?: Duration.Duration }) => Effect.Effect<void>
  readonly countIngest: (route: string, status: number) => Effect.Effect<void>
}

// What the layer builds once, and its three faces share: the buffers, the tracer, the logger.
class Recorder extends Context.Service<Recorder, Recorded>()("@cluenori/signals/self-telemetry-exporter/Recorder") {}

// Effect's span kinds are OTLP's, but for the unspecified kind OTLP has.
const kinds: Readonly<Record<Tracer.SpanKind, SpanKind>> = {
  internal: "internal",
  server: "server",
  client: "client",
  producer: "producer",
  consumer: "consumer",
}

// OTLP's severity numbers: the first of each level's four.
const severities: Readonly<Partial<Record<string, number>>> = { Warn: 13, Error: 17, Fatal: 21 }

/** An attribute's value as OTLP holds it: integers as `bigint`, other numbers as doubles; others as text. */
const anyValueOf = (value: unknown): AnyValue | undefined => {
  if (typeof value === "string" || typeof value === "boolean" || typeof value === "bigint") {
    return value
  }
  if (typeof value === "number") {
    if (Number.isSafeInteger(value)) {
      return BigInt(value)
    }
    return Number.isFinite(value) ? value : undefined
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const converted = anyValueOf(item)
      return converted === undefined ? [] : [converted]
    })
  }
  return undefined
}

const attributesOf = (entries: Iterable<readonly [string, unknown]>): ReadonlyMap<string, AnyValue> =>
  new Map(
    Array.from(entries).flatMap(([key, value]) => {
      const converted = anyValueOf(value)
      return converted === undefined ? [] : [[key, converted] as const]
    }),
  )

/**
 * A server span's name as OpenTelemetry names one: its method and route, `GET /api/projects/{project}`,
 * once the router has said the route; Effect names it by its method alone.
 */
export const serverSpanName = (name: string, attributes: ReadonlyMap<string, unknown>): string => {
  const route = attributes.get("http.route")
  const method = attributes.get("http.request.method") ?? name
  if (typeof route !== "string" || typeof method !== "string") {
    return name
  }
  return `${method} ${route.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, "{$1}")}`
}

// The first line of a failure, as a span's status says it.
const failureOf = (cause: Cause.Cause<unknown>) => (Cause.pretty(cause).split("\n")[0] ?? "").slice(0, 1024)

// What made the telemetry: Cluenori, by the logger's or the work's name.
const scopeOf = (name: string) => ({ name, version: "", attributes: new Map(), droppedAttributesCount: 0 })

// One ended span as OTLP has it; undefined for one whose IDs aren't OTLP's.
const otlpSpanOf = (span: Tracer.NativeSpan): Span | undefined => {
  if (span.status._tag !== "Ended") {
    return undefined
  }
  const parent = Option.getOrUndefined(span.parent)
  const traceId = span.traceId
  const spanId = span.spanId
  const parentSpanId = parent?.spanId
  const valid =
    Schema.is(TraceId)(traceId) &&
    Schema.is(SpanId)(spanId) &&
    (parentSpanId === undefined || Schema.is(SpanId)(parentSpanId))
  if (!valid) {
    return undefined
  }
  const { exit, endTime } = span.status
  const failed = Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)
  return {
    traceId,
    spanId,
    traceState: "",
    parentSpanId,
    flags: 1,
    name: span.kind === "server" ? serverSpanName(span.name, span.attributes) : span.name,
    kind: kinds[span.kind],
    startTimeUnixNano: span.startTime,
    endTimeUnixNano: endTime < span.startTime ? span.startTime : endTime,
    attributes: attributesOf(span.attributes),
    droppedAttributesCount: 0,
    events: span.events.map(([name, time, attributes]) => ({
      timeUnixNano: time,
      name,
      attributes: attributesOf(Object.entries(attributes)),
      droppedAttributesCount: 0,
    })),
    droppedEventsCount: 0,
    links: [],
    droppedLinksCount: 0,
    status: failed
      ? { code: "error", message: Exit.isFailure(exit) ? failureOf(exit.cause) : "" }
      : { code: "unset", message: "" },
  }
}

// What a log line said: its text parts, and the cause among them, if any.
const textOf = (message: unknown): string => {
  const parts = Array.isArray(message) ? message : [message]
  return parts
    .filter((part) => typeof part === "string" || typeof part === "number" || typeof part === "boolean")
    .map(String)
    .join(" ")
}

interface WaitingLog {
  readonly category: string
  readonly record: LogRecord
}

const makeRecorder = (settings: SelfTelemetrySettings) =>
  Effect.gen(function* () {
    const clock = yield* Clock.Clock
    const serialization = yield* OtlpSerialization.OtlpSerialization
    let spans: Array<Tracer.NativeSpan> = []
    let logs: Array<WaitingLog> = []
    // When the oldest of what waits was recorded, in ms; undefined while nothing waits.
    let waitingSince: number | undefined
    let droppedSpans = 0
    let droppedLogs = 0
    // The count of ingest since this started, by route and status, sent as cumulative sums.
    const ingest = new Map<string, { readonly route: string; readonly status: number; count: number }>()
    const startedAt = clock.currentTimeNanosUnsafe()
    let ingestChanged = false
    let countSentAt: number | undefined

    const waiting = () => {
      waitingSince ??= clock.currentTimeMillisUnsafe()
    }

    const tracer = Tracer.make({
      span(options) {
        const span = new Tracer.NativeSpan(options)
        const end = span.end.bind(span)
        // Recorded as it ends, so a span is sent once, whole.
        span.end = (endTime, exit) => {
          end(endTime, exit)
          if (!span.sampled) {
            return
          }
          if (spans.length >= selfTelemetryLimits.spans) {
            droppedSpans += 1
            return
          }
          spans.push(span)
          waiting()
        }
        return span
      },
    })

    const logger = Logger.make((options) => {
      const severity = severities[options.logLevel]
      // Below a warning, or in a fiber whose tracing is off, as receiving telemetry is: not recorded.
      if (severity === undefined || !options.fiber.getRef(References.TracerEnabled)) {
        return
      }
      if (logs.length >= selfTelemetryLimits.logs) {
        droppedLogs += 1
        return
      }
      const annotations = options.fiber.getRef(References.CurrentLogAnnotations)
      const span = Context.getOrUndefined(options.fiber.context, Tracer.ParentSpan)
      const [error] = Cause.prettyErrors(options.cause)
      const exception =
        error === undefined
          ? []
          : [
              ["exception.type", error.name] as const,
              ["exception.message", error.message] as const,
              ...(error.stack === undefined ? [] : [["exception.stacktrace", error.stack] as const]),
            ]
      const time = BigInt(options.date.getTime()) * 1_000_000n
      const traceId = span?.traceId
      const spanId = span?.spanId
      logs.push({
        category: span?._tag === "Span" ? span.name : "cluenori",
        record: {
          timeUnixNano: time,
          observedTimeUnixNano: time,
          severityNumber: severity,
          severityText: options.logLevel.toUpperCase(),
          body: textOf(options.message),
          attributes: attributesOf([...Object.entries(annotations), ...exception]),
          droppedAttributesCount: 0,
          flags: 0,
          traceId: Schema.is(TraceId)(traceId) ? traceId : undefined,
          spanId: Schema.is(SpanId)(spanId) ? spanId : undefined,
          eventName: "",
        },
      })
      waiting()
    })

    const resourceEntries: ReadonlyArray<readonly [string, string | boolean]> = [
      ["service.name", settings.component],
      ...(settings.release === undefined ? [] : [["service.version", settings.release] as const]),
      ["deployment.environment.name", settings.environment],
      ["service.instance.id", settings.instance],
      [selfTelemetryAttribute, true],
    ]
    const resource = { attributes: attributesOf(resourceEntries), droppedAttributesCount: 0 }
    const headers = {
      authorization: `Bearer ${settings.ingestKey.pipe(Redacted.value)}`,
      "content-type": "application/x-protobuf",
      [selfTelemetryHeader]: selfTelemetryValue,
    }

    const send = Effect.fnUntraced(function* (path: SelfTelemetryPath, body: Uint8Array) {
      const status = yield* settings
        .send(path, body, headers)
        .pipe(
          Effect.catchDefect((defect) =>
            Effect.logWarning("The deployment's own telemetry couldn't be sent", defect).pipe(Effect.as(0)),
          ),
        )
      if (status !== 0 && (status < 200 || status >= 300)) {
        yield* Effect.logWarning("The deployment refused its own telemetry").pipe(Effect.annotateLogs({ path, status }))
      }
    })

    // The count of ingest as one cumulative sum, with what was dropped, in Effect's OTLP encoding.
    const countBody = () => {
      const now = String(clock.currentTimeNanosUnsafe())
      const start = String(startedAt)
      const point = (attributes: ReadonlyArray<readonly [string, string | number]>, value: number) => ({
        attributes: attributes.map(([key, item]) => ({
          key,
          value: typeof item === "string" ? { stringValue: item } : { intValue: item },
        })),
        startTimeUnixNano: start,
        timeUnixNano: now,
        asInt: value,
      })
      const sum = (name: string, unit: string, points: ReadonlyArray<ReturnType<typeof point>>) => ({
        name,
        unit,
        sum: { dataPoints: [...points], aggregationTemporality: 2 as const, isMonotonic: true },
      })
      const body = serialization.metrics({
        resourceMetrics: [
          {
            resource: {
              attributes: resourceEntries.map(([key, value]) => ({
                key,
                value: typeof value === "boolean" ? { boolValue: value } : { stringValue: value },
              })),
              droppedAttributesCount: 0,
            },
            scopeMetrics: [
              {
                scope: { name: "cluenori" },
                metrics: [
                  sum(
                    "cluenori.ingest.requests",
                    "{request}",
                    Array.from(ingest.values(), (counted) =>
                      point(
                        [
                          ["route", counted.route],
                          ["http.response.status_code", counted.status],
                        ],
                        counted.count,
                      ),
                    ),
                  ),
                  sum("cluenori.self_telemetry.dropped", "{item}", [
                    point([["signal", "spans"]], droppedSpans),
                    point([["signal", "logs"]], droppedLogs),
                  ]),
                ],
              },
            ],
          },
        ],
      })
      return body._tag === "Uint8Array" ? body.body : undefined
    }

    const sendWaiting = (options?: { readonly olderThan?: Duration.Duration }) =>
      Effect.gen(function* () {
        const now = clock.currentTimeMillisUnsafe()
        const due =
          waitingSince !== undefined &&
          (options?.olderThan === undefined || now - waitingSince >= Duration.toMillis(options.olderThan))
        if (due) {
          const sending = spans
          const sendingLogs = logs
          spans = []
          logs = []
          waitingSince = undefined
          const ended = sending.flatMap((span) => {
            const converted = otlpSpanOf(span)
            return converted === undefined ? [] : [converted]
          })
          if (ended.length > 0) {
            const body = yield* encodeTraces([
              { resource, scopeSpans: [{ scope: scopeOf("cluenori"), spans: ended, schemaUrl: "" }], schemaUrl: "" },
            ])
            yield* send("/otlp/v1/traces", body)
          }
          if (sendingLogs.length > 0) {
            const categories = Map.groupBy(sendingLogs, (log) => log.category)
            const body = yield* encodeLogs([
              {
                resource,
                scopeLogs: Array.from(categories, ([category, records]) => ({
                  scope: scopeOf(category),
                  logRecords: records.map((log) => log.record),
                  schemaUrl: "",
                })),
                schemaUrl: "",
              },
            ])
            yield* send("/otlp/v1/logs", body)
          }
        }
        const countDue = countSentAt === undefined || now - countSentAt >= Duration.toMillis(countEvery)
        if (ingestChanged && countDue) {
          ingestChanged = false
          countSentAt = now
          const body = countBody()
          if (body !== undefined) {
            yield* send("/otlp/v1/metrics", body)
          }
        }
      }).pipe(Effect.withTracerEnabled(false))

    // One flush sends at a time: one called while another sends returns at once, and what was
    // recorded meanwhile waits in the bounded buffers for the next, so a slow receiver holds one
    // export of each kind in memory, never one per request.
    let flushing = false
    const flush = (options?: { readonly olderThan?: Duration.Duration }) =>
      Effect.suspend(() => {
        if (flushing) {
          return Effect.void
        }
        flushing = true
        return sendWaiting(options).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              flushing = false
            }),
          ),
        )
      })

    const countIngest = (route: string, status: number) =>
      Effect.sync(() => {
        const key = `${route} ${status}`
        const counted = ingest.get(key) ?? { route, status, count: 0 }
        counted.count += 1
        ingest.set(key, counted)
        ingestChanged = true
      })

    return Recorder.of({ tracer, logger, flush, countIngest })
  })
