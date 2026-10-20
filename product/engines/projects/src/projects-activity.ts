import { ComponentKey, ProjectKey } from "@cluenori/foundation"
import { Schema } from "effect"

import { ComponentName } from "./component.ts"
import { ProjectName } from "./project.ts"

/** A project was created. */
export const ProjectCreated = Schema.TaggedStruct("project.created", { project: ProjectKey, name: ProjectName })

/** A component was added to a project, with its ingest key. */
export const ComponentAdded = Schema.TaggedStruct("component.added", { component: ComponentKey, name: ComponentName })
