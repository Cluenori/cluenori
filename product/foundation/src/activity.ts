import { Schema } from "effect"

import type { FeatureKey } from "./feature-key.ts"
import type { AccountId, InstallationId, PersonId, SessionId } from "./ids.ts"
import { namePattern, nameRule } from "./patterns.ts"
import type { ReleaseVersion } from "./release-version.ts"
import type { ComponentKey, EnvironmentKey } from "./scope-keys.ts"

/**
 * An activity's name, `<record>.<past tense>` in snake_case: `release.published`,
 * `feedback.status_changed`. Up to 64 characters. A breaking change to a payload is a new name.
 */
export const ActivityName = Schema.String.check(
  Schema.isMaxLength(64),
  Schema.isPattern(namePattern, { expected: nameRule }),
).pipe(Schema.brand("ActivityName"))
export type ActivityName = typeof ActivityName.Type

/**
 * What an activity says happened: a value of a `Schema.TaggedStruct` whose tag is the activity's
 * name, which the emitting package exports in its contract. Its fields are JSON values (keys, IDs,
 * text, numbers, booleans, and times as ISO 8601 text), because activity is stored and delivered
 * as it is.
 *
 * ```ts
 * export const ReleasePublished = Schema.TaggedStruct("release.published", { release: ReleaseId })
 * ```
 */
export type ActivityPayload = { readonly _tag: `${string}.${string}` } & Schema.JsonObject

/**
 * One activity entry, as a write returns it: its payload, and the scope keys it belongs to beyond
 * its project, so that it shows in the timelines and filters of those keys.
 */
export interface ActivityEntry {
  readonly payload: ActivityPayload
  readonly component?: ComponentKey
  readonly environment?: EnvironmentKey
  readonly release?: ReleaseVersion
  readonly feature?: FeatureKey
  readonly person?: PersonId
  readonly installation?: InstallationId
  readonly account?: AccountId
  readonly session?: SessionId
}
