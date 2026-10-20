import type { Attributes, Span } from "@bagatka/otlp"
import { decodeTraces, encodeTraces } from "@bagatka/otlp"
import type { SketchValue } from "@bagatka/quantile-sketch"
import { SketchValue as SketchValueSchema, sketchOf } from "@bagatka/quantile-sketch"
import { EnvelopeName, EnvironmentKey, ReleaseVersion } from "@cluenori/foundation"
import { Crypto, DateTime, Duration, Effect, Schema } from "effect"
import { Hex } from "effect/encoding"

import type { TraceExport } from "./exports.ts"
import type { RequestCounts } from "./request-counts.ts"
import { BatchDigest } from "./request-counts.ts"
import { scrubbedTraces } from "./scrubbed.ts"

/** How long requests are counted for: older ones are refused at ingest and removed after. */
export const requestRetention = Duration.days(14)

/** Requests are counted in buckets of one minute, by when they started. */
export const bucketMillis = 60_000

// A request may start this far in the future, for a sender whose clock runs ahead.
const clockSkew = Duration.hours(1)

/** Records an export held that Cluenori counted nothing for, and the first reason. */
export interface Rejected {
  readonly count: number
  readonly problem: string
}

/** A trace export, read, and the request spans it refused. */
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
    return "A request has no name of 1 to 256 characters without control characters"
  }
  if (span.endTimeUnixNano < span.startTimeUnixNano) {
    return "A request ends before it starts"
  }
  if (start < now - Duration.toMillis(requestRetention)) {
    return "A request is older than the 14 days requests are kept"
  }
  if (start > now + Duration.toMillis(clockSkew)) {
    return "A request starts more than an hour from now; check the sender's clock"
  }
  return undefined
}

interface Group {
  readonly bucket: number
  readonly endpoint: EnvelopeName
  readonly environment: EnvironmentKey | undefined
  requests: number
  errors: number
  totalMs: number
  readonly durations: Array<SketchValue>
}

/**
 * Reads the body of an OTLP/HTTP protobuf trace export: removes credentials and personal data,
 * writes the file the archive keeps, and adds its requests up by endpoint, environment, and minute.
 * A request is a server or consumer span, named by the span's name (`GET /api/notes/{id}`); it
 * failed when its status is an error. Pure apart from the clock and the digest; runs where the
 * export arrives, so a project's object only stores.
 */
export const readTraces = Effect.fn("readTraces")(function* (body: Uint8Array) {
  const crypto = yield* Crypto.Crypto
  const now = yield* DateTime.now
  const decoded = yield* decodeTraces(body)
  const resourceSpans = scrubbedTraces(decoded)
  const digest = yield* crypto.digest("SHA-256", body).pipe(Effect.orDie)
  const nowMillis = DateTime.toEpochMillis(now)

  const groups = new Map<string, Group>()
  let rejectedCount = 0
  let firstProblem: string | undefined
  for (const { resource, scopeSpans } of resourceSpans) {
    const environment = environmentOf(resource)
    for (const { spans } of scopeSpans) {
      for (const span of spans) {
        const isRequest = span.kind === "server" || span.kind === "consumer"
        const problem = isRequest ? problemOf(span, nowMillis) : undefined
        if (problem !== undefined) {
          rejectedCount += 1
          firstProblem ??= problem
        }
        if (isRequest && problem === undefined) {
          const start = Number(span.startTimeUnixNano / 1_000_000n)
          const bucket = start - (start % bucketMillis)
          const endpoint = EnvelopeName.make(span.name)
          // Names and keys hold no control characters, so NUL separates them unambiguously.
          const key = [bucket, endpoint, environment ?? ""].join("\u0000")
          const group = groups.get(key) ?? {
            bucket,
            endpoint,
            environment,
            requests: 0,
            errors: 0,
            totalMs: 0,
            durations: [],
          }
          const durationMs = Number(span.endTimeUnixNano - span.startTimeUnixNano) / 1_000_000
          group.requests += 1
          group.errors += span.status.code === "error" ? 1 : 0
          group.totalMs += durationMs
          group.durations.push(SketchValueSchema.make(durationMs))
          groups.set(key, group)
        }
      }
    }
  }

  const counts: ReadonlyArray<RequestCounts> = Array.from(groups.values(), (group) => ({
    bucket: DateTime.makeUnsafe(group.bucket),
    endpoint: group.endpoint,
    ...(group.environment === undefined ? {} : { environment: group.environment }),
    requests: group.requests,
    errors: group.errors,
    totalMs: group.totalMs,
    durations: sketchOf(group.durations),
  }))
  const spans = resourceSpans.flatMap((resource) => resource.scopeSpans.flatMap((scope) => scope.spans))
  const earliest = spans.reduce(
    (least, span) => Math.min(least, Number(span.startTimeUnixNano / 1_000_000n)),
    nowMillis,
  )
  const latest = spans.reduce((most, span) => Math.max(most, Number(span.endTimeUnixNano / 1_000_000n)), 0)
  const read: ReadTraces = {
    export: {
      digest: BatchDigest.make(Hex.encode(digest)),
      archive: encodeTraces(resourceSpans),
      from: DateTime.makeUnsafe(spans.length === 0 ? nowMillis : earliest),
      to: DateTime.makeUnsafe(spans.length === 0 ? nowMillis : latest),
      spans: spans.length,
      counts,
    },
    rejected: firstProblem === undefined ? undefined : { count: rejectedCount, problem: firstProblem },
  }
  return read
})
