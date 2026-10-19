import { Schema } from "effect"

import { keyPattern, keyRule } from "./patterns.ts"

const Key = Schema.String.check(Schema.isMaxLength(40), Schema.isPattern(keyPattern, { expected: keyRule }))

/**
 * The tenant: members, billing, settings. A self-hosted deployment has one, `main`. Up to 40
 * lowercase letters, digits and single hyphens, starting with a letter, like every key. Permanent.
 */
export const WorkspaceKey = Key.pipe(Schema.brand("WorkspaceKey"))
export type WorkspaceKey = typeof WorkspaceKey.Type

/**
 * A project: one product and one investment, such as `notes`. Permanent, because shipped builds of
 * the project's apps contain it; what people see is its name, which can change.
 */
export const ProjectKey = Key.pipe(Schema.brand("ProjectKey"))
export type ProjectKey = typeof ProjectKey.Type

/** A part of a project that ships separately, such as `notes-ios`. Unique in its project; permanent. */
export const ComponentKey = Key.pipe(Schema.brand("ComponentKey"))
export type ComponentKey = typeof ComponentKey.Type

/** Where a component runs: `production`, `staging`. */
export const EnvironmentKey = Key.pipe(Schema.brand("EnvironmentKey"))
export type EnvironmentKey = typeof EnvironmentKey.Type
