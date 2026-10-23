import type { ModuleActions, ModuleIngests, ModuleQueries } from "@cluenori/foundation"
import { Actor, ComponentKey, Instant, TraceId } from "@cluenori/foundation"
import {
  AddMonitor,
  Incident,
  IncidentId,
  IncidentList,
  IncidentNotFound,
  Monitor,
  MonitorExists,
  MonitorId,
  MonitorLimitReached,
  MonitorList,
  MonitorNotFound,
} from "@cluenori/incidents"
import { ManifestQuery, VersionPolicy } from "@cluenori/manifest"
import {
  AddComponent,
  AddedComponentResponse,
  Component,
  ComponentExists,
  ComponentLinks,
  ComponentNotFound,
  IngestKey,
  IngestKeyRejected,
  IssuedSdkKey,
  Project,
  ProjectDetail,
  ProjectExists,
  ProjectName,
  ProjectNotFound,
  ProjectSettings,
  SdkKey,
  SdkKeyList,
  SdkKeyNotFound,
} from "@cluenori/projects"
import {
  AppBatch,
  AppBatchAccepted,
  ArchiveUnavailable,
  CountryCode,
  OperationTable,
  ErrorDetail,
  ErrorGroupId,
  ErrorGroupNotFound,
  ErrorQuery,
  ErrorTable,
  KeptTraces,
  LogCountQuery,
  LogCounts,
  LogExport,
  LogPage,
  LogQuery,
  MetricsExport,
  OperationQuery,
  LoadSeries,
  SeriesStep,
  SdkKeyRejected,
  TooManySignals,
  TraceExport,
  TraceView,
} from "@cluenori/signals"
import { ProjectToday } from "@cluenori/today"
import { Schema } from "effect"

import type { ObjectCall, PlainSchema } from "./object-calls.ts"
import { objectCall } from "./object-calls.ts"

/** The calls an engine answers, each on a line of `projectCalls`. */
export type EngineCallName =
  | "createProject"
  | "detail"
  | "addComponent"
  | "linkComponent"
  | "updateSettings"
  | "issueSdkKey"
  | "sdkKeys"
  | "revokeSdkKey"
  | "ingestTraces"
  | "ingestLogs"
  | "ingestMetrics"
  | "ingestAppBatch"
  | "appManifest"
  | "operations"
  | "loadOverTime"
  | "keptTraces"
  | "errors"
  | "error"
  | "logs"
  | "logCounts"
  | "trace"
  | "incidents"
  | "acknowledge"
  | "monitors"
  | "addMonitor"
  | "removeMonitor"
  | "today"

/** A module's query, as its object serves it: `<module>.<query>`, such as `releases.list`. */
export type ModuleCallName = `${string}.${string}`

export type ProjectCallName = EngineCallName | ModuleCallName

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
  name: EngineCallName,
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
  updateSettings: projectCall(
    "updateSettings",
    Schema.Struct({ actor: Actor, settings: ProjectSettings }),
    ProjectSettings,
    ProjectNotFound,
  ),
  linkComponent: projectCall(
    "linkComponent",
    Schema.Struct({ actor: Actor, component: ComponentKey, links: ComponentLinks }),
    Component,
    Schema.Union([ProjectNotFound, ComponentNotFound]),
  ),
  issueSdkKey: projectCall(
    "issueSdkKey",
    Schema.Struct({ actor: Actor, component: ComponentKey }),
    IssuedSdkKey,
    Schema.Union([ProjectNotFound, ComponentNotFound]),
  ),
  sdkKeys: projectCall(
    "sdkKeys",
    Schema.Struct({ component: ComponentKey }),
    SdkKeyList,
    Schema.Union([ProjectNotFound, ComponentNotFound]),
  ),
  revokeSdkKey: projectCall(
    "revokeSdkKey",
    Schema.Struct({ actor: Actor, component: ComponentKey, key: SdkKey }),
    IssuedSdkKey,
    Schema.Union([ProjectNotFound, SdkKeyNotFound]),
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
  ingestAppBatch: projectCall(
    "ingestAppBatch",
    Schema.Struct({ key: SdkKey, country: Schema.optionalKey(CountryCode), batch: AppBatch }),
    AppBatchAccepted,
    Schema.Union([SdkKeyRejected, TooManySignals, ArchiveUnavailable]),
  ),
  appManifest: projectCall(
    "appManifest",
    Schema.Struct({ key: SdkKey, query: ManifestQuery }),
    VersionPolicy,
    SdkKeyRejected,
  ),
  operations: projectCall("operations", OperationQuery, OperationTable, ProjectNotFound),
  loadOverTime: projectCall(
    "loadOverTime",
    Schema.Struct({ query: OperationQuery, step: SeriesStep }),
    LoadSeries,
    ProjectNotFound,
  ),
  keptTraces: projectCall("keptTraces", OperationQuery, KeptTraces, ProjectNotFound),
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
    Schema.Struct({ trace: TraceId, around: Schema.optionalKey(Instant) }),
    TraceView,
    Schema.Union([ProjectNotFound, ArchiveUnavailable]),
  ),
  incidents: projectCall("incidents", Schema.Void, IncidentList, ProjectNotFound),
  acknowledge: projectCall(
    "acknowledge",
    Schema.Struct({ actor: Actor, incident: IncidentId }),
    Incident,
    Schema.Union([ProjectNotFound, IncidentNotFound]),
  ),
  monitors: projectCall("monitors", Schema.Void, MonitorList, ProjectNotFound),
  addMonitor: projectCall(
    "addMonitor",
    Schema.Struct({ actor: Actor, monitor: AddMonitor }),
    Monitor,
    Schema.Union([ProjectNotFound, ComponentNotFound, MonitorExists, MonitorLimitReached]),
  ),
  removeMonitor: projectCall(
    "removeMonitor",
    Schema.Struct({ actor: Actor, monitor: MonitorId }),
    Schema.Void,
    Schema.Union([ProjectNotFound, MonitorNotFound]),
  ),
  today: projectCall("today", Schema.Void, ProjectToday, ProjectNotFound),
}

/**
 * The call that runs `module`'s query `name` in a project's object, under `<module>.<query>`: its
 * failures are the query's, and `ProjectNotFound` for a project that doesn't exist.
 */
export const moduleCall = <Queries extends ModuleQueries<Queries>, K extends keyof Queries & string>(
  module: { readonly id: string; readonly queries: Queries },
  name: K,
): ProjectCall<
  Queries[K]["input"],
  Queries[K]["success"],
  Schema.Union<readonly [typeof ProjectNotFound, Queries[K]["error"]]>
> => {
  const query: Queries[K] = module.queries[name]
  return objectCall(`${module.id}.${name}`, query.input, query.success, Schema.Union([ProjectNotFound, query.error]))
}

/**
 * The call that runs `module`'s ingest write `name` in a project's object, under
 * `<module>.ingest.<name>`, for the component whose ingest key comes with it: its failures are the
 * write's, and `IngestKeyRejected` for a key that isn't one of the project's.
 */
export const moduleIngestCall = <Ingests extends ModuleIngests<Ingests>, K extends keyof Ingests & string>(
  module: { readonly id: string; readonly ingest: Ingests },
  name: K,
): ProjectCall<
  Schema.Struct<{ readonly ingestKey: typeof IngestKey; readonly input: Ingests[K]["input"] }>,
  Ingests[K]["success"],
  Schema.Union<readonly [typeof IngestKeyRejected, Ingests[K]["error"]]>
> => {
  const ingest: Ingests[K] = module.ingest[name]
  return objectCall(
    `${module.id}.ingest.${name}`,
    Schema.Struct({ ingestKey: IngestKey, input: ingest.input }),
    ingest.success,
    Schema.Union([IngestKeyRejected, ingest.error]),
  )
}

/**
 * The call that runs `module`'s action `name` in a project's object, under `<module>.action.<name>`,
 * for the actor who asks: its failures are the action's, and `ProjectNotFound` for a project that
 * doesn't exist.
 */
export const moduleActionCall = <Actions extends ModuleActions<Actions>, K extends keyof Actions & string>(
  module: { readonly id: string; readonly actions: Actions },
  name: K,
): ProjectCall<
  Schema.Struct<{ readonly actor: typeof Actor; readonly input: Actions[K]["input"] }>,
  Actions[K]["success"],
  Schema.Union<readonly [typeof ProjectNotFound, Actions[K]["error"]]>
> => {
  const action: Actions[K] = module.actions[name]
  return objectCall(
    `${module.id}.action.${name}`,
    Schema.Struct({ actor: Actor, input: action.input }),
    action.success,
    Schema.Union([ProjectNotFound, action.error]),
  )
}
