import { Repository } from "@bagatka/github"
import { ComponentKey, EnvironmentKey, ProjectKey } from "@cluenori/foundation"
import { Schema } from "effect"

import { BundleId, ComponentName } from "./component.ts"
import { ProjectName } from "./project.ts"

/** A project was created. */
export const ProjectCreated = Schema.TaggedStruct("project.created", { project: ProjectKey, name: ProjectName })

/** A component was added to a project, with its ingest key. */
export const ComponentAdded = Schema.TaggedStruct("component.added", { component: ComponentKey, name: ComponentName })

/** A component's links changed: its repository and App Store bundle ID, each absent when unlinked. */
export const ComponentLinked = Schema.TaggedStruct("component.linked", {
  component: ComponentKey,
  repository: Schema.optionalKey(Repository),
  appStoreBundleId: Schema.optionalKey(BundleId),
})

/** The project's settings changed: the environments it calls production. */
export const ProjectSettingsChanged = Schema.TaggedStruct("project.settings_changed", {
  productionEnvironments: Schema.Array(EnvironmentKey),
})
