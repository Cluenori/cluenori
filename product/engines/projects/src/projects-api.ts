import { NotAllowed, ProjectKey } from "@cluenori/foundation"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api"

import { AddComponent, Component, ComponentExists } from "./component.ts"
import { IngestKey } from "./ingest-key.ts"
import { CreateProject, Project, ProjectExists, ProjectNotFound } from "./project.ts"

/** A component just added, with the ingest key its telemetry is sent with: shown this once. */
export const AddedComponentResponse = Schema.Struct({ component: Component, ingestKey: IngestKey }).annotate({
  identifier: "AddedComponentResponse",
})

/** The workspace's projects, by key. */
export const ProjectList = Schema.Struct({ projects: Schema.Array(Project) }).annotate({ identifier: "ProjectList" })
export type ProjectList = typeof ProjectList.Type

/** One project and its components, by key. */
export const ProjectDetail = Schema.Struct({ project: Project, components: Schema.Array(Component) }).annotate({
  identifier: "ProjectDetail",
})
export type ProjectDetail = typeof ProjectDetail.Type

/** Projects and their components: the public API's part for this engine. */
export class ProjectsGroup extends HttpApiGroup.make("projects")
  .add(
    HttpApiEndpoint.get("listProjects", "/projects", { success: ProjectList }).annotate(
      OpenApi.Description,
      "The workspace's projects, by key: each one's key, name, and when it was created.",
    ),
  )
  .add(
    HttpApiEndpoint.get("project", "/projects/:project", {
      params: { project: ProjectKey },
      success: ProjectDetail,
      error: ProjectNotFound.pipe(HttpApiSchema.status(404)),
    }).annotate(OpenApi.Description, "One project and its components, by key."),
  )
  .add(
    HttpApiEndpoint.post("createProject", "/projects", {
      payload: CreateProject,
      success: Project.pipe(HttpApiSchema.status(201)),
      error: [ProjectExists.pipe(HttpApiSchema.status(409)), NotAllowed.pipe(HttpApiSchema.status(403))],
    }).annotate(
      OpenApi.Description,
      "Creates a project: one product, with the components that ship separately. Its key is permanent. Owners only.",
    ),
  )
  .add(
    HttpApiEndpoint.post("addComponent", "/projects/:project/components", {
      params: { project: ProjectKey },
      payload: AddComponent,
      success: AddedComponentResponse.pipe(HttpApiSchema.status(201)),
      error: [ProjectNotFound.pipe(HttpApiSchema.status(404)), ComponentExists.pipe(HttpApiSchema.status(409))],
    }).annotate(
      OpenApi.Description,
      "Adds a component to a project and returns its ingest key, which its telemetry is sent with. The key is shown only in this answer.",
    ),
  ) {}
