import { Project, ProjectList } from "@cluenori/projects"
import { Schema } from "effect"

import type { ObjectCall, PlainSchema } from "./object-calls.ts"
import { objectCall } from "./object-calls.ts"

export type WorkspaceCallName = "recordProject" | "projects"

/** One thing the Worker asks the workspace's Durable Object: its input, its answer, and how it fails. */
export type WorkspaceCall<I extends PlainSchema, S extends PlainSchema, F extends PlainSchema> = ObjectCall<
  WorkspaceCallName,
  I,
  S,
  F
>

/** What the Worker asks the workspace's Durable Object, one entry per call. */
export const workspaceCalls = {
  recordProject: objectCall<WorkspaceCallName, typeof Project, typeof Schema.Void, typeof Schema.Never>(
    "recordProject",
    Project,
    Schema.Void,
    Schema.Never,
  ),
  projects: objectCall<WorkspaceCallName, typeof Schema.Void, typeof ProjectList, typeof Schema.Never>(
    "projects",
    Schema.Void,
    ProjectList,
    Schema.Never,
  ),
}
