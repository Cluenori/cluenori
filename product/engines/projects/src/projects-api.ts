import { ProjectKey } from "@cluenori/foundation"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api"

import { AddComponent, Component, ComponentExists } from "./component.ts"
import { IngestKey } from "./ingest-key.ts"
import { CreateProject, Project, ProjectExists, ProjectNotFound } from "./project.ts"

/** A component just added, with the ingest key its telemetry is sent with: shown this once. */
export const AddedComponentResponse = Schema.Struct({ component: Component, ingestKey: IngestKey })

/** Projects and their components: the public API's part for this engine. */
export class ProjectsGroup extends HttpApiGroup.make("projects")
  .add(
    HttpApiEndpoint.post("createProject", "/projects", {
      payload: CreateProject,
      success: Project.pipe(HttpApiSchema.status(201)),
      error: ProjectExists.pipe(HttpApiSchema.status(409)),
    }).annotate(
      OpenApi.Description,
      "Creates a project: one product, with the components that ship separately. Its key is permanent.",
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
