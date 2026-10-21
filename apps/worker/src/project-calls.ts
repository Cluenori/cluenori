import { Actor, TraceId } from "@cluenori/foundation"
import {
  AddComponent,
  AddedComponentResponse,
  ComponentExists,
  IngestKey,
  IngestKeyRejected,
  Project,
  ProjectDetail,
  ProjectExists,
  ProjectName,
  ProjectNotFound,
} from "@cluenori/projects"
import {
  ArchiveUnavailable,
  EndpointTable,
  ErrorDetail,
  ErrorGroupId,
  ErrorGroupNotFound,
  ErrorQuery,
  ErrorTable,
  KeptRequests,
  LogCountQuery,
  LogCounts,
  LogExport,
  LogPage,
  LogQuery,
  MetricsExport,
  RequestQuery,
  RequestSeries,
  SeriesStep,
  TraceExport,
  TraceView,
} from "@cluenori/signals"
import { Schema } from "effect"

import type { ObjectCall, PlainSchema } from "./object-calls.ts"
import { objectCall } from "./object-calls.ts"

export type ProjectCallName =
  | "createProject"
  | "detail"
  | "addComponent"
  | "ingestTraces"
  | "ingestLogs"
  | "ingestMetrics"
  | "endpoints"
  | "requestsOverTime"
  | "keptRequests"
  | "errors"
  | "error"
  | "logs"
  | "logCounts"
  | "trace"

const recorded = Schema.Literals(["recorded", "duplicate"])
const ingestFailure = Schema.Union([IngestKeyRejected, ArchiveUnavailable])

/** One thing the Worker asks a project's Durable Object: its input, its answer, and how it fails. */
export type ProjectCall<I extends PlainSchema, S extends PlainSchema, F extends PlainSchema> = ObjectCall<
  ProjectCallName,
  I,
  S,
  F
>

const projectCall = <I extends PlainSchema, S extends PlainSchema, F extends PlainSchema>(
  name: ProjectCallName,
  input: I,
  success: S,
  error: F,
): ProjectCall<I, S, F> => objectCall(name, input, success, error)

/** What the Worker asks a project's Durable Object, one entry per call. */
export const projectCalls = {
  createProject: projectCall(
    "createProject",
    Schema.Struct({ actor: Actor, name: ProjectName }),
    Project,
    ProjectExists,
  ),
  detail: projectCall("detail", Schema.Void, ProjectDetail, ProjectNotFound),
  addComponent: projectCall(
    "addComponent",
    Schema.Struct({ actor: Actor, component: AddComponent }),
    AddedComponentResponse,
    Schema.Union([ProjectNotFound, ComponentExists]),
  ),
  ingestTraces: projectCall(
    "ingestTraces",
    Schema.Struct({ ingestKey: IngestKey, export: TraceExport }),
    recorded,
    ingestFailure,
  ),
  ingestLogs: projectCall(
    "ingestLogs",
    Schema.Struct({ ingestKey: IngestKey, export: LogExport }),
    recorded,
    ingestFailure,
  ),
  ingestMetrics: projectCall(
    "ingestMetrics",
    Schema.Struct({ ingestKey: IngestKey, export: MetricsExport }),
    recorded,
    ingestFailure,
  ),
  endpoints: projectCall("endpoints", RequestQuery, EndpointTable, ProjectNotFound),
  requestsOverTime: projectCall(
    "requestsOverTime",
    Schema.Struct({ query: RequestQuery, step: SeriesStep }),
    RequestSeries,
    ProjectNotFound,
  ),
  keptRequests: projectCall("keptRequests", RequestQuery, KeptRequests, ProjectNotFound),
  errors: projectCall("errors", ErrorQuery, ErrorTable, ProjectNotFound),
  error: projectCall(
    "error",
    Schema.Struct({ id: ErrorGroupId, query: ErrorQuery }),
    ErrorDetail,
    Schema.Union([ProjectNotFound, ErrorGroupNotFound]),
  ),
  logs: projectCall("logs", LogQuery, LogPage, ProjectNotFound),
  logCounts: projectCall("logCounts", LogCountQuery, LogCounts, ProjectNotFound),
  trace: projectCall(
    "trace",
    Schema.Struct({ trace: TraceId, around: Schema.optionalKey(Schema.DateTimeUtcFromString) }),
    TraceView,
    Schema.Union([ProjectNotFound, ArchiveUnavailable]),
  ),
}
