import { Actor } from "@cluenori/foundation"
import {
  AddComponent,
  AddedComponentResponse,
  ComponentExists,
  IngestKey,
  IngestKeyRejected,
  Project,
  ProjectExists,
  ProjectName,
  ProjectNotFound,
} from "@cluenori/projects"
import { EndpointTable, RequestBatch, RequestQuery, RequestSeries, SeriesStep } from "@cluenori/signals"
import { Schema } from "effect"

/** A Schema that needs no services to encode or decode, as every call's do. */
export type PlainSchema = Schema.Top & { readonly DecodingServices: never; readonly EncodingServices: never }

export type ProjectCallName = "createProject" | "addComponent" | "ingestRequests" | "endpoints" | "requestsOverTime"

/** One thing the Worker asks a project's Durable Object: its input, its answer, and how it fails. */
export interface ProjectCall<I extends PlainSchema, S extends PlainSchema, F extends PlainSchema> {
  readonly name: ProjectCallName
  readonly input: I
  readonly success: S
  readonly error: F
}

const projectCall = <I extends PlainSchema, S extends PlainSchema, F extends PlainSchema>(
  name: ProjectCallName,
  input: I,
  success: S,
  error: F,
): ProjectCall<I, S, F> => ({ name, input, success, error })

/** What the Worker asks a project's Durable Object, one entry per call. */
export const projectCalls = {
  createProject: projectCall(
    "createProject",
    Schema.Struct({ actor: Actor, name: ProjectName }),
    Project,
    ProjectExists,
  ),
  addComponent: projectCall(
    "addComponent",
    Schema.Struct({ actor: Actor, component: AddComponent }),
    AddedComponentResponse,
    Schema.Union([ProjectNotFound, ComponentExists]),
  ),
  ingestRequests: projectCall(
    "ingestRequests",
    Schema.Struct({ ingestKey: IngestKey, batch: RequestBatch }),
    Schema.Literals(["recorded", "duplicate"]),
    IngestKeyRejected,
  ),
  endpoints: projectCall("endpoints", RequestQuery, EndpointTable, ProjectNotFound),
  requestsOverTime: projectCall(
    "requestsOverTime",
    Schema.Struct({ query: RequestQuery, step: SeriesStep }),
    RequestSeries,
    ProjectNotFound,
  ),
}

// Both sides encode with these, as JSON text, so typed values and tagged errors cross the Durable
// Object's RPC boundary, which carries only plain data.

/** A call's input as JSON text. */
export const inputText = <I extends PlainSchema>(input: I) => Schema.fromJsonString(Schema.toCodecJson(input))

/** A call's exit, its answer or its failure, as JSON text. */
export const exitText = <S extends PlainSchema, F extends PlainSchema>(success: S, error: F) =>
  Schema.fromJsonString(Schema.toCodecJson(Schema.Exit(success, error, Schema.Defect())))
