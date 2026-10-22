import { ComponentKey, EnvironmentKey, NotAllowed, ProjectKey } from "@cluenori/foundation"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api"

import { AddComponent, Component, ComponentExists, ComponentLinks, ComponentNotFound } from "./component.ts"
import { IngestKey } from "./ingest-key.ts"
import { CreateProject, Project, ProjectExists, ProjectNotFound, ProjectSettings } from "./project.ts"

/** A component just added, with the ingest key its telemetry is sent with: shown this once. */
export const AddedComponentResponse = Schema.Struct({ component: Component, ingestKey: IngestKey }).annotate({
  identifier: "AddedComponentResponse",
})

/** The workspace's projects, by key. */
export const ProjectList = Schema.Struct({ projects: Schema.Array(Project) }).annotate({ identifier: "ProjectList" })
export type ProjectList = typeof ProjectList.Type

/**
 * One project and its components, by key; its settings; and the environments its telemetry named
 * in the last 30 days, production first. Settings and environments are absent from deployments
 * from before October 2026.
 */
export const ProjectDetail = Schema.Struct({
  project: Project,
  components: Schema.Array(Component),
  settings: Schema.optionalKey(ProjectSettings),
  environments: Schema.optionalKey(Schema.Array(EnvironmentKey)),
}).annotate({ identifier: "ProjectDetail" })
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
  )
  .add(
    HttpApiEndpoint.put("updateSettings", "/projects/:project/settings", {
      params: { project: ProjectKey },
      payload: ProjectSettings,
      success: ProjectSettings,
      error: ProjectNotFound.pipe(HttpApiSchema.status(404)),
    }).annotate(
      OpenApi.Description,
      "Replaces the project's settings: `productionEnvironments`, the 1 to 20 environments it calls production, where its incidents alert and its views start. Telemetry without an environment counts as production, so no alert is lost. Until a project chooses, prod, production and live.",
    ),
  )
  .add(
    HttpApiEndpoint.put("linkComponent", "/projects/:project/components/:component/links", {
      params: { project: ProjectKey, component: ComponentKey },
      payload: ComponentLinks,
      success: Component,
      error: [ProjectNotFound.pipe(HttpApiSchema.status(404)), ComponentNotFound.pipe(HttpApiSchema.status(404))],
    }).annotate(
      OpenApi.Description,
      "Replaces a component's links: `repository`, its GitHub repository as owner/name, whose commits its releases are; and `deployTargets`, where its releases go in each environment: the GitHub Actions workflow that builds and deploys a release there, started with the inputs `release`, `environment`, `commit` and `runner`, and, for an app, the App Store Connect app its builds go to, for TestFlight only or through to the App Store; and `shipsWith`, another of the project's components whose deploys deploy this one too, from the same commit with the same release, for a part such as a background service. One left out is unlinked. 404 for a component the project lacks, or one it ships with that the project lacks or that is itself. Returns the component.",
    ),
  ) {}
