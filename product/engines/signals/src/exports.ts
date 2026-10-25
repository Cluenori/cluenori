import { Instant, TraceId } from "@cluenori/foundation"
import { Schema } from "effect"

import { KeptTrace } from "./kept-trace.ts"
import { ErrorGroupId, LogEntry } from "./log-entry.ts"
import { BatchDigest, OperationCounts } from "./operation-counts.ts"

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

const archived = {
  digest: BatchDigest,
  /** The export as it is kept in the archive: OTLP protobuf, with secrets and personal data removed. */
  archive: Schema.Uint8ArrayFromBase64,
  /** When the earliest and the latest of its records happened. */
  from: Instant,
  to: Instant,
}

/**
 * A trace export, as ingest sends it to the project's object: its archive file, its operations
 * counted, and the traces it has that may be kept.
 */
export const TraceExport = Schema.Struct({
  ...archived,
  spans: Count,
  counts: Schema.Array(OperationCounts),
  /** Of each operation, environment and hour, its slowest traces and its slowest failed ones. */
  kept: Schema.Array(KeptTrace),
  /** The traces it holds spans of, each once: how a trace's files are found. */
  traces: Schema.Array(TraceId),
})
export type TraceExport = typeof TraceExport.Type

/** How an error group is named, from the first occurrence that made it. */
export const ErrorGroupShape = Schema.Struct({
  id: ErrorGroupId,
  kind: Schema.Literals(["exception", "log"]),
  title: Schema.String,
  culprit: Schema.String,
})
export type ErrorGroupShape = typeof ErrorGroupShape.Type

/**
 * A log export, as ingest sends it to the project's object: its archive file, its warnings and
 * errors (other records are only archived), and the error groups they belong to.
 */
export const LogExport = Schema.Struct({
  ...archived,
  records: Count,
  entries: Schema.Array(LogEntry),
  errors: Schema.Array(ErrorGroupShape),
  /** The traces it holds records of, each once: how a trace's files are found. */
  traces: Schema.Array(TraceId),
})
export type LogExport = typeof LogExport.Type

/** A metrics export, archived as it arrived until Cluenori reads metrics. */
export const MetricsExport = Schema.Struct({
  ...archived,
  resources: Count,
})
export type MetricsExport = typeof MetricsExport.Type

/** Which kind of export a file of the archive holds. */
export const ExportSignal = Schema.Literals(["traces", "logs", "metrics"])
export type ExportSignal = typeof ExportSignal.Type
