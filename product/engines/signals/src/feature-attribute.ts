import { FeatureKey } from "@cluenori/foundation"
import { Schema } from "effect"

/**
 * The attribute a service's spans and logs name their feature in, as the Cluenori helpers copy it
 * from baggage (concept/Foundation.md, "Features"): `cluenori.feature=editor.export`.
 */
export const featureAttribute = "cluenori.feature"

/** The feature an attribute's value names; undefined for a value that is no feature key. */
export const featureIn = (value: unknown): FeatureKey | undefined => (Schema.is(FeatureKey)(value) ? value : undefined)
