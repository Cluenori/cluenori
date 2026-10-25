import type { Attributes, Span } from "@bagatka/otlp-protobuf"
import { decodeTraces, encodeTraces } from "@bagatka/otlp-protobuf"
import { sketchOf } from "@bagatka/quantile-sketch"
import { EnvelopeName, EnvironmentKey, ReleaseVersion, TraceId } from "@cluenori/foundation"
import { Crypto, DateTime, Duration, Effect, Schema } from "effect"
import { Hex } from "effect/encoding"

import type { TraceExport } from "./exports.ts"
import type { KeptTrace } from "./kept-trace.ts"
import { HttpStatus, keptPerHour } from "./kept-trace.ts"
import type { OperationCounts } from "./operation-counts.ts"
import { BatchDigest } from "./operation-counts.ts"
import { scrubbedTraces, unarchivable } from "./scrubbed.ts"

/**
 * How long operations are counted by the minute: older spans are refused at ingest, and counts
 * removed after.
 */
export const countRetention = Duration.days(14)

/** Operations are counted in buckets of one minute, by when they started. */
export const bucketMillis = 60_000

// Traces are kept by the hour their operation started in.
const hourMillis = 3_600_000

// A span may start this far in the future, for a sender whose clock runs ahead.
const clockSkew = Duration.hours(1)

/** Records an export held that Cluenori counted nothing for, and the first reason. */
export interface Rejected {
  readonly count: number
  readonly problem: string
}

/** A trace export, read, and the spans it refused. */
export interface ReadTraces {
  readonly export: TraceExport
  readonly rejected: Rejected | undefined
}

/** The release a resource reports in `service.version`, when it is a release version. */
export const releaseOf = (resource: Attributes): ReleaseVersion | undefined => {
  const reported = resource.get("service.version")
  return Schema.is(ReleaseVersion)(reported) ? reported : undefined
}

/**
 * The environment a resource reports, in `deployment.environment.name` or the older
 * `deployment.environment`. Environments are lowercase keys, so `Production` is `production`; a
 * value that is no key after that is unknown.
 */
export const environmentOf = (resource: Attributes): EnvironmentKey | undefined => {
  const reported = resource.get("deployment.environment.name") ?? resource.get("deployment.environment")
  const lowercase = typeof reported === "string" ? reported.toLowerCase() : undefined
  return Schema.is(EnvironmentKey)(lowercase) ? lowercase : undefined
}

const problemOf = (span: Span, now: number): string | undefined => {
  const start = Number(span.startTimeUnixNano / 1_000_000n)
  if (!Schema.is(EnvelopeName)(span.name)) {
    return "A span has no name of 1 to 256 characters without control characters"
  }
  if (span.endTimeUnixNano < span.startTimeUnixNano) {
    return "A span ends before it starts"
  }
  if (start < now - Duration.toMillis(countRetention)) {
    return "A span is older than the 14 days operations are counted"
  }
  if (start > now + Duration.toMillis(clockSkew)) {
    return "A span starts more than an hour from now; check the sender's clock"
  }
  return undefined
}

// The HTTP status a server span answered with, under its current name or the older one.
const statusOf = (span: Span): HttpStatus | undefined => {
  const reported = span.attributes.get("http.response.status_code") ?? span.attributes.get("http.status_code")
  // An integer, as the semantic conventions say; a double, as some exporters send, is taken too.
  const status = typeof reported === "bigint" ? Number(reported) : reported
  return Schema.is(HttpStatus)(status) ? status : undefined
}

// Of each hour's traces of one operation and environment, those that may be kept: the slowest, and
// the slowest that failed. The project's object keeps them against those it kept before.
const toKeep = (traces: ReadonlyArray<KeptTrace>) => {
  const slowestFirst = traces.toSorted((left, right) => right.durationMs - left.durationMs)
  return [
    ...new Set([
      ...slowestFirst.slice(0, keptPerHour),
      ...slowestFirst.filter((trace) => trace.failed).slice(0, keptPerHour),
    ]),
  ]
}

/**
 * Whether a span is counted under its operation, as one unit of work in a service. A server span
 * answers a call, a consumer span a message; an internal span that starts its trace is work the
 * service started itself, such as a scheduled job. A span of unspecified kind counts as internal,
 * as OpenTelemetry says receivers may assume.
 */
const isOperationSpan = (span: Span) =>
  span.kind === "server" ||
  span.kind === "consumer" ||
  ((span.kind === "internal" || span.kind === "unspecified") && span.parentSpanId === undefined)

interface Group {
  readonly bucket: number
  readonly operation: EnvelopeName
  readonly environment: EnvironmentKey | undefined
  readonly release: ReleaseVersion | undefined
  count: number
  errors: number
  totalMs: number
  readonly durations: Array<number>
}

/**
 * Reads the body of an OTLP/HTTP protobuf trace export: removes credentials and personal data,
 * writes the file the archive keeps, counts its operations by name, environment, release, and minute, and
 * picks the traces that may be kept. An operation's span is a server or consumer span, or an
 * internal span that starts its trace, a job (`isOperationSpan`); its name is the operation's
 * (`GET /api/notes/{id}`, `cleanup.run`); it failed when its status is an error. Pure apart from
 * the clock and the digest; runs where the export arrives, so a project's object only stores. Fails
 * with `OtlpInvalid` when the body isn't an export, or when its scrubbed archive couldn't be read
 * back (`unarchivable`).
 */
export const readTraces = Effect.fn("readTraces")(function* (body: Uint8Array) {
  const crypto = yield* Crypto.Crypto
  const now = yield* DateTime.now
  const decoded = yield* decodeTraces(body)
  const resourceSpans = scrubbedTraces(decoded)
  const digest = yield* crypto.digest("SHA-256", body).pipe(Effect.orDie)
  const nowMillis = DateTime.toEpochMillis(now)

  const groups = new Map<string, Group>()
  const hours = new Map<string, Array<KeptTrace>>()
  let rejectedCount = 0
  let firstProblem: string | undefined
  for (const { resource, scopeSpans } of resourceSpans) {
    const environment = environmentOf(resource.attributes)
    const release = releaseOf(resource.attributes)
    for (const { spans } of scopeSpans) {
      for (const span of spans) {
        const counted = isOperationSpan(span)
        const problem = counted ? problemOf(span, nowMillis) : undefined
        if (problem !== undefined) {
          rejectedCount += 1
          firstProblem ??= problem
        }
        if (counted && problem === undefined) {
          const start = Number(span.startTimeUnixNano / 1_000_000n)
          const bucket = start - (start % bucketMillis)
          const operation = EnvelopeName.make(span.name)
          // Names and keys hold no control characters, so NUL separates them unambiguously.
          const key = [bucket, operation, environment ?? "", release ?? ""].join("\u0000")
          const group = groups.get(key) ?? {
            bucket,
            operation,
            environment,
            release,
            count: 0,
            errors: 0,
            totalMs: 0,
            durations: [],
          }
          const durationMs = Number(span.endTimeUnixNano - span.startTimeUnixNano) / 1_000_000
          const failed = span.status.code === "error"
          group.count += 1
          group.errors += failed ? 1 : 0
          group.totalMs += durationMs
          group.durations.push(durationMs)
          groups.set(key, group)
          if (Schema.is(TraceId)(span.traceId)) {
            const status = statusOf(span)
            const hourKey = [start - (start % hourMillis), operation, environment ?? ""].join("\u0000")
            const inHour = hours.get(hourKey) ?? []
            inHour.push({
              trace: span.traceId,
              operation,
              ...(environment === undefined ? {} : { environment }),
              ...(release === undefined ? {} : { release }),
              start: DateTime.makeUnsafe(start),
              durationMs,
              failed,
              ...(status === undefined ? {} : { status }),
            })
            hours.set(hourKey, inHour)
          }
        }
      }
    }
  }

  const counts: ReadonlyArray<OperationCounts> = Array.from(groups.values(), (group) => ({
    bucket: DateTime.makeUnsafe(group.bucket),
    operation: group.operation,
    ...(group.environment === undefined ? {} : { environment: group.environment }),
    ...(group.release === undefined ? {} : { release: group.release }),
    count: group.count,
    errors: group.errors,
    totalMs: group.totalMs,
    // `problemOf` refused spans that end before they start, so the sketch refuses none.
    durations: sketchOf(group.durations).sketch,
  }))
  const spans = resourceSpans.flatMap((resource) => resource.scopeSpans.flatMap((scope) => scope.spans))
  const earliest = spans.reduce(
    (least, span) => Math.min(least, Number(span.startTimeUnixNano / 1_000_000n)),
    nowMillis,
  )
  const latest = spans.reduce((most, span) => Math.max(most, Number(span.endTimeUnixNano / 1_000_000n)), 0)
  const traces = new Set(spans.map((span) => span.traceId).filter((trace) => Schema.is(TraceId)(trace)))
  const archive = yield* encodeTraces(resourceSpans)
  yield* decodeTraces(archive).pipe(Effect.mapError(unarchivable))
  const read: ReadTraces = {
    export: {
      digest: BatchDigest.make(Hex.encode(digest)),
      archive,
      from: DateTime.makeUnsafe(spans.length === 0 ? nowMillis : earliest),
      to: DateTime.makeUnsafe(spans.length === 0 ? nowMillis : latest),
      spans: spans.length,
      counts,
      kept: [...hours.values()].flatMap(toKeep),
      traces: [...traces],
    },
    rejected: firstProblem === undefined ? undefined : { count: rejectedCount, problem: firstProblem },
  }
  return read
})
