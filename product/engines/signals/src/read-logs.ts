import type { AnyValue, Attributes, LogRecord } from "@bagatka/otlp"
import { decodeLogs, encodeLogs } from "@bagatka/otlp"
import { TraceId } from "@cluenori/foundation"
import { Crypto, DateTime, Duration, Effect, Schema } from "effect"
import { Base64, Hex } from "effect/encoding"

import type { ErrorGroupShape, LogExport } from "./exports.ts"
import type { ErrorShape } from "./fingerprint.ts"
import { errorShapeOf } from "./fingerprint.ts"
import type { LogEntry, LogException, LogLevel } from "./log-entry.ts"
import { ErrorGroupId, SpanId } from "./log-entry.ts"
import type { Rejected } from "./read-traces.ts"
import { environmentOf, releaseOf } from "./read-traces.ts"
import { BatchDigest } from "./run-counts.ts"
import { scrubbedLogs } from "./scrubbed.ts"

/** How long warnings and errors are kept: older ones are refused at ingest, and removed after. */
export const logRetention = Duration.days(90)

// A record may be this far in the future, for a sender whose clock runs ahead.
const clockSkew = Duration.hours(1)

const levels: ReadonlyArray<LogLevel> = ["trace", "debug", "info", "warn", "error", "fatal"]

const levelNames: Readonly<Record<string, LogLevel>> = {
  trace: "trace",
  debug: "debug",
  info: "info",
  information: "info",
  warn: "warn",
  warning: "warn",
  error: "error",
  fatal: "fatal",
  critical: "fatal",
}

/**
 * A record's level: from OTLP's severity number in fours (1–4 trace up to 21–24 fatal), or, when it
 * has none, from its severity's name. Undefined when neither says.
 */
export const levelOf = (record: LogRecord): LogLevel | undefined =>
  record.severityNumber >= 1 && record.severityNumber <= 24
    ? levels[Math.floor((record.severityNumber - 1) / 4)]
    : levelNames[record.severityText.toLowerCase()]

const indexed = new Set<LogLevel>(["warn", "error", "fatal"])
const errors = new Set<LogLevel>(["error", "fatal"])

/** A log export, read, and the warnings and errors it held that Cluenori refused to index. */
export interface ReadLogs {
  readonly export: LogExport
  readonly rejected: Rejected | undefined
}

const isAttributes = (value: AnyValue): value is Attributes => value instanceof Map

/** An attribute's value as JSON: bytes become base64 text. */
export const jsonOf = (value: AnyValue): Schema.Json => {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value
  }
  if (value instanceof Uint8Array) {
    return Base64.encode(value)
  }
  if (isAttributes(value)) {
    return Object.fromEntries(Array.from(value, ([key, item]) => [key, jsonOf(item)] as const))
  }
  return value.map(jsonOf)
}

const textOf = (value: AnyValue | undefined) => (typeof value === "string" ? value : undefined)

// Kept apart from the other attributes, because the entry has a field for each.
const ownFields = new Set(["exception.type", "exception.message", "exception.stacktrace", "{OriginalFormat}"])

const exceptionOf = (attributes: Attributes): LogException | undefined => {
  const type = textOf(attributes.get("exception.type"))
  const message = textOf(attributes.get("exception.message")) ?? ""
  const stack = textOf(attributes.get("exception.stacktrace"))
  if (type === undefined) {
    return undefined
  }
  return stack === undefined ? { type, message } : { type, message, stack }
}

const encodeJsonText = Schema.encodeEffect(Schema.fromJsonString(Schema.Json))

/** What a record said, as text: its body, or the body as JSON when it isn't text. */
const messageOf = (body: AnyValue) =>
  typeof body === "string" ? Effect.succeed(body) : encodeJsonText(jsonOf(body)).pipe(Effect.orDie)

// Every runtime Cluenori runs on has it; declared here, in this module only, because the engine
// compiles without any platform's types.
declare const TextEncoder: new () => { readonly encode: (input: string) => Uint8Array }

const utf8 = new TextEncoder()

/**
 * A log record as an entry, without its error group: its message as text, its template and
 * exception apart from its other attributes, and its trace when the IDs are valid.
 */
export const entryOf = Effect.fn("entryOf")(function* (
  record: LogRecord,
  time: number,
  category: string,
  resource: Attributes,
) {
  const message = yield* messageOf(record.body)
  const template = textOf(record.attributes.get("{OriginalFormat}"))
  const exception = exceptionOf(record.attributes)
  const environment = environmentOf(resource)
  const release = releaseOf(resource)
  const attributes = Object.fromEntries(
    Array.from(record.attributes)
      .filter(([key]) => !ownFields.has(key))
      .map(([key, value]) => [key, jsonOf(value)] as const),
  )
  return {
    time: DateTime.makeUnsafe(time),
    category,
    message,
    ...(template === undefined ? {} : { template }),
    ...(environment === undefined ? {} : { environment }),
    ...(release === undefined ? {} : { release }),
    ...(Schema.is(TraceId)(record.traceId) ? { trace: record.traceId } : {}),
    ...(Schema.is(SpanId)(record.spanId) ? { span: record.spanId } : {}),
    ...(exception === undefined ? {} : { exception }),
    attributes,
  }
})

/** When a record happened, in Unix ms: its time, or when it was observed, or now when neither is sent. */
export const timeOf = (record: LogRecord, now: number) => {
  const reported = record.timeUnixNano === 0n ? record.observedTimeUnixNano : record.timeUnixNano
  return reported === 0n ? now : Number(reported / 1_000_000n)
}

/** The error group of an error record: the first 16 hex digits of its fingerprint's SHA-256. */
const errorIdOf = Effect.fn("errorIdOf")(function* (shape: ErrorShape | undefined) {
  if (shape === undefined) {
    return undefined
  }
  const crypto = yield* Crypto.Crypto
  const hash = yield* crypto.digest("SHA-256", utf8.encode(shape.fingerprint)).pipe(Effect.orDie)
  return ErrorGroupId.make(Hex.encode(hash).slice(0, 16))
})

/**
 * Reads the body of an OTLP/HTTP protobuf log export: removes credentials and personal data, writes
 * the file the archive keeps, and picks out its warnings and errors, grouping each error by what
 * makes it the same error. Other records are only archived. A warning or error older than the 90
 * days they are kept, or more than an hour in the future, is archived but not indexed, and counted
 * in `rejected`.
 */
export const readLogs = Effect.fn("readLogs")(function* (body: Uint8Array) {
  const crypto = yield* Crypto.Crypto
  const now = yield* DateTime.now
  const decoded = yield* decodeLogs(body)
  const resourceLogs = scrubbedLogs(decoded)
  const digest = yield* crypto.digest("SHA-256", body).pipe(Effect.orDie)
  const nowMillis = DateTime.toEpochMillis(now)

  const entries: Array<LogEntry> = []
  const shapes = new Map<string, ErrorGroupShape>()
  const traces = new Set<TraceId>()
  let records = 0
  let earliest = nowMillis
  let latest = 0
  let rejectedCount = 0
  let firstProblem: string | undefined
  for (const { resource, scopeLogs } of resourceLogs) {
    for (const { scope, logRecords } of scopeLogs) {
      for (const record of logRecords) {
        records += 1
        if (Schema.is(TraceId)(record.traceId)) {
          traces.add(record.traceId)
        }
        const time = timeOf(record, nowMillis)
        earliest = Math.min(earliest, time)
        latest = Math.max(latest, time)
        const level = levelOf(record)
        const tooOld = time < nowMillis - Duration.toMillis(logRetention)
        const tooNew = time > nowMillis + Duration.toMillis(clockSkew)
        const isIndexed = level !== undefined && indexed.has(level)
        if (isIndexed && (tooOld || tooNew)) {
          rejectedCount += 1
          firstProblem ??= tooOld
            ? "A warning or error is older than the 90 days they are kept"
            : "A warning or error is more than an hour from now; check the sender's clock"
        }
        if (level !== undefined && isIndexed && !tooOld && !tooNew) {
          const entry = yield* entryOf(record, time, scope.name, resource)
          const shape = errors.has(level) ? errorShapeOf(entry) : undefined
          const errorId = yield* errorIdOf(shape)
          if (shape !== undefined && errorId !== undefined && !shapes.has(errorId)) {
            shapes.set(errorId, { id: errorId, kind: shape.kind, title: shape.title, culprit: shape.culprit })
          }
          entries.push({ ...entry, level, ...(errorId === undefined ? {} : { error: errorId }) })
        }
      }
    }
  }
  const read: ReadLogs = {
    export: {
      digest: BatchDigest.make(Hex.encode(digest)),
      archive: encodeLogs(resourceLogs),
      from: DateTime.makeUnsafe(records === 0 ? nowMillis : earliest),
      to: DateTime.makeUnsafe(records === 0 ? nowMillis : latest),
      records,
      entries,
      errors: [...shapes.values()],
      traces: [...traces],
    },
    rejected: firstProblem === undefined ? undefined : { count: rejectedCount, problem: firstProblem },
  }
  return read
})
