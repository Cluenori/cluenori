import type { QuantileSketch } from "@bagatka/quantile-sketch"
import { mergeSketches } from "@bagatka/quantile-sketch"
import { Result } from "effect"

/**
 * `sketches` merged into one. Signals sketches every duration and measure at the default accuracy,
 * 2%, and migration 0010 named it on those stored before, so sketches of another accuracy are a bug,
 * and throw.
 */
export const mergedSketch = (sketches: Iterable<QuantileSketch>): QuantileSketch =>
  Result.getOrThrow(mergeSketches(sketches))
