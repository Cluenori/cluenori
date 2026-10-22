import { Repository } from "@bagatka/github"
import { ComponentKey, Instant } from "@cluenori/foundation"
import { Schema } from "effect"

/** What people call a component: 1 to 100 characters, without space at either end. */
export const ComponentName = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(100),
  Schema.isTrimmed(),
).pipe(Schema.brand("ComponentName"))
export type ComponentName = typeof ComponentName.Type

/** An app's bundle ID, as Apple's stores know it, such as `com.example.notes`. */
export const BundleId = Schema.String.check(
  Schema.isMaxLength(155),
  Schema.isPattern(/^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/, {
    expected: "letters, digits and hyphens in parts joined by dots, such as com.example.notes",
  }),
).pipe(Schema.brand("BundleId"))
export type BundleId = typeof BundleId.Type

/**
 * Where a component's releases come from beside its telemetry: its repository on GitHub, whose tags
 * and commits name them, and, for an app, its bundle ID in App Store Connect. Each absent until
 * linked.
 */
export const ComponentLinks = Schema.Struct({
  repository: Schema.optionalKey(Repository),
  appStoreBundleId: Schema.optionalKey(BundleId),
}).annotate({ identifier: "ComponentLinks" })
export type ComponentLinks = typeof ComponentLinks.Type

/** A part of a project that ships separately, such as `notes-api`. Its key is permanent. */
export class Component extends Schema.Class<Component>("Component")({
  key: ComponentKey,
  name: ComponentName,
  createdAt: Instant,
  ...ComponentLinks.fields,
}) {}

export const AddComponent = Schema.Struct({ key: ComponentKey, name: ComponentName }).annotate({
  identifier: "AddComponent",
})
export type AddComponent = typeof AddComponent.Type

/** The project has no component with this key. */
export class ComponentNotFound extends Schema.TaggedError<ComponentNotFound>()("ComponentNotFound", {
  component: ComponentKey,
}) {}

/** The project already has a component with this key. */
export class ComponentExists extends Schema.TaggedError<ComponentExists>()("ComponentExists", {
  component: ComponentKey,
}) {}
