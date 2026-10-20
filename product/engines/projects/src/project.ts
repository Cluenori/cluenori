import { ProjectKey } from "@cluenori/foundation"
import { Schema } from "effect"

/** What people call a project: 1 to 100 characters, without space at either end. */
export const ProjectName = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100), Schema.isTrimmed()).pipe(
  Schema.brand("ProjectName"),
)
export type ProjectName = typeof ProjectName.Type

/** A project: one product and one investment. Its key is permanent; its name can change. */
export class Project extends Schema.Class<Project>("Project")({
  key: ProjectKey,
  name: ProjectName,
  createdAt: Schema.DateTimeUtcFromString,
}) {}

export const CreateProject = Schema.Struct({ key: ProjectKey, name: ProjectName })
export type CreateProject = typeof CreateProject.Type

/** The project was created before, with this key. */
export class ProjectExists extends Schema.TaggedError<ProjectExists>()("ProjectExists", { project: ProjectKey }) {}

/** No project has this key. */
export class ProjectNotFound extends Schema.TaggedError<ProjectNotFound>()("ProjectNotFound", {
  project: ProjectKey,
}) {}
