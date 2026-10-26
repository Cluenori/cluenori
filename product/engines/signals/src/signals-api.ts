import {
  ComponentKey,
  EnvelopeName,
  EnvironmentKey,
  Instant,
  ProjectKey,
  ReleaseVersion,
  TraceId,
} from "@cluenori/foundation"
import { ProjectNotFound } from "@cluenori/projects"
import { DateTime, Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api"

import { ArchiveUnavailable } from "./archive-store.ts"
import {
  ErrorDetail,
  ErrorGroupNotFound,
  ErrorTable,
  IndexedLevel,
  LogCounts,
  LogCountsBy,
  LogLineNotFound,
  LogPage,
} from "./error-groups.ts"
import { ErrorGroupId, LogLine } from "./log-entry.ts"
import { OperationTable, KeptTraces, LoadSeries, SeriesStep } from "./operation-queries.ts"
import { TraceView } from "./trace-view.ts"

// Every question can be narrowed to one environment, component, or release, as its component reports
// it in `service.version`.
const filters = {
  from: Instant,
  to: Instant,
  environment: Schema.optionalKey(EnvironmentKey),
  component: Schema.optionalKey(ComponentKey),
  release: Schema.optionalKey(ReleaseVersion),
}

const fromBeforeTo = Schema.makeFilter(
  (query: { readonly from: DateTime.Utc; readonly to: DateTime.Utc }) => DateTime.isLessThan(query.from, query.to),
  { expected: "a period whose from is before its to" },
)

// A question about operations can also be narrowed to one, by its name: `GET /api/notes/{id}`.
const operationFilters = { ...filters, operation: Schema.optionalKey(EnvelopeName) }

/** The filters of a question about operations, as query parameters: `from` and `to` are ISO 8601 UTC. */
export const OperationFilters = Schema.Struct(operationFilters).check(fromBeforeTo)

/** The filters of a series, with how wide each point is. */
export const SeriesFilters = Schema.Struct({ ...operationFilters, step: SeriesStep }).check(fromBeforeTo)

/** The filters of a search of warnings and errors; `before` continues an earlier answer's page. */
export const LogFilters = Schema.Struct({
  ...filters,
  level: Schema.optionalKey(IndexedLevel),
  search: Schema.optionalKey(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200))),
  category: Schema.optionalKey(Schema.String),
  trace: Schema.optionalKey(TraceId),
  error: Schema.optionalKey(ErrorGroupId),
  before: Schema.optionalKey(Schema.Int),
}).check(fromBeforeTo)

/** The filters of counts of warnings and errors over time: how wide each point is, and what each series is. */
export const LogCountFilters = Schema.Struct({
  ...filters,
  step: SeriesStep,
  by: LogCountsBy,
  level: Schema.optionalKey(IndexedLevel),
  error: Schema.optionalKey(ErrorGroupId),
}).check(fromBeforeTo)

/**
 * When the trace happened, ISO 8601 UTC, when it is known: of a trace with more files than are read,
 * those nearest to `around` are read first, else the newest.
 */
export const TraceFilters = Schema.Struct({ around: Schema.optionalKey(Instant) })

/** The signals of a project's services: the public API's part for this engine. */
export class SignalsGroup extends HttpApiGroup.make("signals")
  .add(
    HttpApiEndpoint.get("operations", "/projects/:project/operations", {
      params: { project: ProjectKey },
      query: OperationFilters,
      success: OperationTable,
      error: ProjectNotFound.pipe(HttpApiSchema.status(404)),
    }).annotate(
      OpenApi.Description,
      "Every operation in a period, the most counted first, or one with `operation`: how many times it ran, how many failed, and their average, p50, p80, p95 and p99 durations. Counted by the minute for periods of two days or less (kept 14 days), by the hour beyond (kept 15 months); `covered` says which part of the period the counts cover.",
    ),
  )
  .add(
    HttpApiEndpoint.get("load", "/projects/:project/load", {
      params: { project: ProjectKey },
      query: SeriesFilters,
      success: LoadSeries,
      error: ProjectNotFound.pipe(HttpApiSchema.status(404)),
    }).annotate(
      OpenApi.Description,
      "The load over a period: how many operations ran and failed, one point per step that had any, with their p50, p80, p95 and p99 durations, on a project's services, or on one operation with `operation`. A step without a point had nothing reported. Past two days the counts are hourly, so a finer step becomes an hour; `step` says which was used.",
    ),
  )
  .add(
    HttpApiEndpoint.get("keptTraces", "/projects/:project/kept-traces", {
      params: { project: ProjectKey },
      query: OperationFilters,
      success: KeptTraces,
      error: ProjectNotFound.pipe(HttpApiSchema.status(404)),
    }).annotate(
      OpenApi.Description,
      "Traces worth opening in a period, or one operation's with `operation`: the slowest, slowest first, and the failed, newest first, at most 20 of each, each with its ID, which opens it with the traces endpoint. Of each operation, environment and hour, the five slowest traces and the five slowest failed ones are kept, 14 days; `covered` says which part of the period that covers.",
    ),
  )
  .add(
    HttpApiEndpoint.get("errors", "/projects/:project/errors", {
      params: { project: ProjectKey },
      query: OperationFilters,
      success: ErrorTable,
      error: ProjectNotFound.pipe(HttpApiSchema.status(404)),
    }).annotate(
      OpenApi.Description,
      "The errors of a period, most frequent first: each error log grouped by its exception's type and stack, or by its logger and message, with when it was first and last seen. Kept 90 days.",
    ),
  )
  .add(
    HttpApiEndpoint.get("error", "/projects/:project/errors/:error", {
      params: { project: ProjectKey, error: ErrorGroupId },
      query: OperationFilters,
      success: ErrorDetail,
      error: [ProjectNotFound.pipe(HttpApiSchema.status(404)), ErrorGroupNotFound.pipe(HttpApiSchema.status(404))],
    }).annotate(
      OpenApi.Description,
      "One error, found whatever the period: what it is, when it was first and last seen, how often it happened in the period, and its latest occurrences there, with their messages, stack traces, and trace IDs: where an investigation starts. Each occurrence's ID opens it with the log line endpoint, and its trace ID and time its trace with the traces endpoint.",
    ),
  )
  .add(
    HttpApiEndpoint.get("logLine", "/projects/:project/logs/lines/:line", {
      params: { project: ProjectKey, line: Schema.FiniteFromString.pipe(Schema.decodeTo(Schema.Int)) },
      success: LogLine,
      error: [ProjectNotFound.pipe(HttpApiSchema.status(404)), LogLineNotFound.pipe(HttpApiSchema.status(404))],
    }).annotate(
      OpenApi.Description,
      "One warning or error by its ID, whenever it happened: an occurrence of an error or a line of the logs, with its message, exception, stack, trace ID, and attributes. Kept 90 days.",
    ),
  )
  .add(
    HttpApiEndpoint.get("logs", "/projects/:project/logs", {
      params: { project: ProjectKey },
      query: LogFilters,
      success: LogPage,
      error: ProjectNotFound.pipe(HttpApiSchema.status(404)),
    }).annotate(
      OpenApi.Description,
      "Warnings and errors, newest first, 100 at a time: filtered by level, text, logger, trace, or error. Kept 90 days. Records below warning are in the archive, which the traces endpoint reads for one trace.",
    ),
  )
  .add(
    HttpApiEndpoint.get("logCounts", "/projects/:project/logs/counts", {
      params: { project: ProjectKey },
      query: LogCountFilters,
      success: LogCounts,
      error: ProjectNotFound.pipe(HttpApiSchema.status(404)),
    }).annotate(
      OpenApi.Description,
      "Warnings and errors counted over time: a series for each level, component, or error group (`by`), at `level` or above (warn when absent), with a point for each step that had any. By error group, the 100 most frequent. Kept 90 days; `covered` says which part of the period the counts cover.",
    ),
  )
  .add(
    HttpApiEndpoint.get("trace", "/projects/:project/traces/:trace", {
      params: { project: ProjectKey, trace: TraceId },
      query: TraceFilters,
      success: TraceView,
      error: [ProjectNotFound.pipe(HttpApiSchema.status(404)), ArchiveUnavailable],
    }).annotate(
      OpenApi.Description,
      "One trace across services, from the archive, found by its ID: its spans as a tree, with their durations and attributes, and its logs at every level. `around`, the time it happened, is optional: of a trace with more archive files than are read, those nearest to it are read first. Kept 90 days.",
    ),
  ) {}
