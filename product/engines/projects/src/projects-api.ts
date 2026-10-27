import { ComponentKey, EnvironmentKey, NotAllowed, ProjectKey } from "@cluenori/foundation"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api"

import { AddComponent, Component, ComponentExists, ComponentLinks, ComponentNotFound } from "./component.ts"
import { IngestKey } from "./ingest-key.ts"
import {
  AddedIngestKey,
  AddIngestKey,
  IngestKeyId,
  IngestKeyInfo,
  IngestKeyList,
  IngestKeyNotFound,
  IngestKeyRefused,
  RevokeIngestKey,
} from "./issued-ingest-key.ts"
import { IssuedSdkKey, SdkKeyList, SdkKeyNotFound, TooManySdkKeys } from "./issued-sdk-key.ts"
import { CreateProject, Project, ProjectExists, ProjectNotFound, ProjectSettings } from "./project.ts"
import { SdkKey } from "./sdk-key.ts"

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
  )
  .add(
    HttpApiEndpoint.get("ingestKeys", "/projects/:project/components/:component/ingest-keys", {
      params: { project: ProjectKey, component: ComponentKey },
      success: IngestKeyList,
      error: [
        ProjectNotFound.pipe(HttpApiSchema.status(404)),
        ComponentNotFound.pipe(HttpApiSchema.status(404)),
        NotAllowed.pipe(HttpApiSchema.status(403)),
      ],
    }).annotate(
      OpenApi.Description,
      "A component's ingest keys, newest first, never the keys themselves: each one's ID, name, when it was created, `lastUsedAt`, the start of the UTC hour it was last used in (absent until used), and `expiresAt` and `revokedAt` when it has them. A key works until the earlier of those two; a revocation may be scheduled, so `revokedAt` may be in the future. Keys that ended are listed 30 days, then forgotten. Owners only.",
    ),
  )
  .add(
    HttpApiEndpoint.post("addIngestKey", "/projects/:project/components/:component/ingest-keys", {
      params: { project: ProjectKey, component: ComponentKey },
      payload: AddIngestKey,
      success: AddedIngestKey.pipe(HttpApiSchema.status(201)),
      error: [
        ProjectNotFound.pipe(HttpApiSchema.status(404)),
        ComponentNotFound.pipe(HttpApiSchema.status(404)),
        IngestKeyRefused.pipe(HttpApiSchema.status(409)),
        NotAllowed.pipe(HttpApiSchema.status(403)),
      ],
    }).annotate(
      OpenApi.Description,
      "Adds an ingest key to a component, named by where it is used, optionally expiring at `expiresAt`, and returns it: the key is shown only in this answer. The component's other keys keep working, so a deploy can move to the new key with no gap; revoke the old one once its `lastUsedAt` stops moving. Owners can always add a key, so a lost key never loses a component. 409 `IngestKeyRefused`: `tooMany` when 10 of its keys work, `expiryPast` when `expiresAt` isn't in the future. Owners only.",
    ),
  )
  .add(
    HttpApiEndpoint.post("revokeIngestKey", "/projects/:project/components/:component/ingest-keys/:key/revoke", {
      params: { project: ProjectKey, component: ComponentKey, key: IngestKeyId },
      payload: RevokeIngestKey,
      success: IngestKeyInfo,
      error: [
        ProjectNotFound.pipe(HttpApiSchema.status(404)),
        IngestKeyNotFound.pipe(HttpApiSchema.status(404)),
        NotAllowed.pipe(HttpApiSchema.status(403)),
      ],
    }).annotate(
      OpenApi.Description,
      "Revokes one of a component's ingest keys: it stops working at `at`, or at once when `at` is absent or past, such as in 24 hours, while the deploys that use it move to another. A revocation only moves earlier: one later than the key already stops changes nothing and returns it. 404 for a key the component doesn't list. Owners only.",
    ),
  )
  .add(
    HttpApiEndpoint.post("issueSdkKey", "/projects/:project/components/:component/sdk-keys", {
      params: { project: ProjectKey, component: ComponentKey },
      success: IssuedSdkKey.pipe(HttpApiSchema.status(201)),
      error: [
        ProjectNotFound.pipe(HttpApiSchema.status(404)),
        ComponentNotFound.pipe(HttpApiSchema.status(404)),
        TooManySdkKeys.pipe(HttpApiSchema.status(409)),
      ],
    }).annotate(
      OpenApi.Description,
      "Issues a new SDK key for a component: the key its app's builds carry, in the app's SDK configuration, so the SDK can send the component's signals and read its manifest. It is public, as anything shipped in an app is, and grants nothing else. The component's other keys stay active until revoked, so a new build can carry the new key while older builds keep working. Listed again with sdkKeys. 404 for a project or a component that doesn't exist; 409 when 20 of the component's keys are active, so one must be revoked first.",
    ),
  )
  .add(
    HttpApiEndpoint.get("sdkKeys", "/projects/:project/components/:component/sdk-keys", {
      params: { project: ProjectKey, component: ComponentKey },
      success: SdkKeyList,
      error: [ProjectNotFound.pipe(HttpApiSchema.status(404)), ComponentNotFound.pipe(HttpApiSchema.status(404))],
    }).annotate(
      OpenApi.Description,
      "A component's SDK keys, newest first, revoked ones too: each key, when it was issued, and `revokedAt` once it is revoked. Active keys are those without `revokedAt`. 404 for a project or a component that doesn't exist.",
    ),
  )
  .add(
    HttpApiEndpoint.post("revokeSdkKey", "/projects/:project/components/:component/sdk-keys/:key/revoke", {
      params: { project: ProjectKey, component: ComponentKey, key: SdkKey },
      success: IssuedSdkKey,
      error: [ProjectNotFound.pipe(HttpApiSchema.status(404)), SdkKeyNotFound.pipe(HttpApiSchema.status(404))],
    }).annotate(
      OpenApi.Description,
      "Revokes one of a component's SDK keys: builds that carry it are refused from then on, so issue its replacement and ship it first. Revoking a key revoked before changes nothing and returns it. 404 for a project that doesn't exist, or a key that isn't one of the component's. Returns the key, with `revokedAt`.",
    ),
  ) {}
