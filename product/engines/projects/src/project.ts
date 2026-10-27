import { EnvironmentKey, Instant, ProjectKey } from "@cluenori/foundation"
import { Schema } from "effect"

/** What people call a project: 1 to 100 characters, without space at either end. */
export const ProjectName = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100), Schema.isTrimmed()).pipe(
  Schema.brand("ProjectName"),
)
export type ProjectName = typeof ProjectName.Type

/**
 * A project: one product and one investment. Its key is permanent; its name can change. `resetAt`
 * is when its data was last reset, absent until it is: what was known of it before is gone.
 */
export class Project extends Schema.Class<Project>("Project")({
  key: ProjectKey,
  name: ProjectName,
  createdAt: Instant,
  resetAt: Schema.optionalKey(Instant),
}) {}

/**
 * What a project decides for itself: the environments it calls production, where its incidents
 * alert and its views start, 1 to 20 of them. Until it chooses, `prod`, `production` and `live`.
 */
export const ProjectSettings = Schema.Struct({
  productionEnvironments: Schema.Array(EnvironmentKey).check(Schema.isMinLength(1), Schema.isMaxLength(20)),
}).annotate({ identifier: "ProjectSettings" })
export type ProjectSettings = typeof ProjectSettings.Type

/** A project's settings until it chooses. */
export const defaultProjectSettings: ProjectSettings = {
  productionEnvironments: [EnvironmentKey.make("prod"), EnvironmentKey.make("production"), EnvironmentKey.make("live")],
}

/**
 * Whether `environment` is production for `settings`: one of its production environments, or
 * unknown, so no alert is lost to a component that doesn't say its environment.
 */
export const isProduction = (settings: ProjectSettings, environment: EnvironmentKey | undefined) =>
  environment === undefined || settings.productionEnvironments.includes(environment)

export const CreateProject = Schema.Struct({ key: ProjectKey, name: ProjectName }).annotate({
  identifier: "CreateProject",
})
export type CreateProject = typeof CreateProject.Type

/** The project was created before, with this key. */
export class ProjectExists extends Schema.TaggedError<ProjectExists>()("ProjectExists", { project: ProjectKey }) {}

/** No project has this key. */
export class ProjectNotFound extends Schema.TaggedError<ProjectNotFound>()("ProjectNotFound", {
  project: ProjectKey,
}) {}
