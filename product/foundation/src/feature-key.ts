import { Schema } from "effect"

import { dottedKeyPattern, dottedKeyRule } from "./patterns.ts"

/**
 * A capability of a project, across its components: `editor.export`. Keys joined by dots, up to 100
 * characters. A filter on `editor` includes `editor.export`.
 */
export const FeatureKey = Schema.String.check(
  Schema.isMaxLength(100),
  Schema.isPattern(dottedKeyPattern, { expected: dottedKeyRule }),
).pipe(Schema.brand("FeatureKey"))
export type FeatureKey = typeof FeatureKey.Type
