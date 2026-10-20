import { ComponentKey } from "@cluenori/foundation"
import { Schema } from "effect"

/** What people call a component: 1 to 100 characters, without space at either end. */
export const ComponentName = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(100),
  Schema.isTrimmed(),
).pipe(Schema.brand("ComponentName"))
export type ComponentName = typeof ComponentName.Type

/** A part of a project that ships separately, such as `notes-api`. Its key is permanent. */
export class Component extends Schema.Class<Component>("Component")({
  key: ComponentKey,
  name: ComponentName,
  createdAt: Schema.DateTimeUtcFromString,
}) {}

export const AddComponent = Schema.Struct({ key: ComponentKey, name: ComponentName })
export type AddComponent = typeof AddComponent.Type

/** The project already has a component with this key. */
export class ComponentExists extends Schema.TaggedError<ComponentExists>()("ComponentExists", {
  component: ComponentKey,
}) {}
