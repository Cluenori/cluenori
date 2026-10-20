import { Option, Schema } from "effect"

/** How far a quantile read from a sketch may be from the true value, relative to it: 2%. */
export const relativeAccuracy = 0.02

// Bucket `i` holds the values in (gamma^(i-1), gamma^i]. Any value in it is within
// `relativeAccuracy` of the bucket's representative value, 2 * gamma^i / (gamma + 1) (DDSketch).
const gamma = (1 + relativeAccuracy) / (1 - relativeAccuracy)
const logGamma = Math.log(gamma)

// Values at or below this count as zero: smaller than anything a duration or a size is measured in.
const smallest = 1e-9

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

/**
 * A mergeable sketch of non-negative values, from which any quantile can be read to within
 * `relativeAccuracy` of the true value. Plain data, so it can be stored and sent as it is. Its size
 * grows with the spread of its values, about 58 buckets for each factor of 10, not with their number.
 */
export const QuantileSketch = Schema.Struct({
  /** How many values were zero, or at most 1e-9. */
  zeros: Count,
  /** The bucket of `counts[0]`. */
  offset: Schema.Int,
  /** How many values fell in each bucket, from `offset` on. */
  counts: Schema.Array(Count),
})
export type QuantileSketch = typeof QuantileSketch.Type

/** A value a sketch takes: finite, and not negative. */
export const SketchValue = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)).pipe(Schema.brand("SketchValue"))
export type SketchValue = typeof SketchValue.Type

/** Which quantile to read: 0.5 for the median, 0.95 for p95. From 0 to 1. */
export const Quantile = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })).pipe(Schema.brand("Quantile"))
export type Quantile = typeof Quantile.Type

/** The sketch of no values. */
export const emptySketch: QuantileSketch = { zeros: 0, offset: 0, counts: [] }

const fromBuckets = (zeros: number, buckets: ReadonlyMap<number, number>): QuantileSketch => {
  if (buckets.size === 0) {
    return { zeros, offset: 0, counts: [] }
  }
  const indexes = [...buckets.keys()]
  const offset = Math.min(...indexes)
  const length = Math.max(...indexes) - offset + 1
  const counts = Array.from({ length }, (_, position) => buckets.get(offset + position) ?? 0)
  return { zeros, offset, counts }
}

/** The sketch of `values`. */
export const sketchOf = (values: Iterable<SketchValue>): QuantileSketch => {
  const buckets = new Map<number, number>()
  let zeros = 0
  for (const value of values) {
    if (value <= smallest) {
      zeros += 1
    } else {
      const bucket = Math.ceil(Math.log(value) / logGamma)
      buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1)
    }
  }
  return fromBuckets(zeros, buckets)
}

/** One sketch of all the values of `sketches`, as if they had been sketched together. */
export const mergeSketches = (sketches: Iterable<QuantileSketch>): QuantileSketch => {
  const buckets = new Map<number, number>()
  let zeros = 0
  for (const sketch of sketches) {
    zeros += sketch.zeros
    for (const [position, count] of sketch.counts.entries()) {
      if (count > 0) {
        buckets.set(sketch.offset + position, (buckets.get(sketch.offset + position) ?? 0) + count)
      }
    }
  }
  return fromBuckets(zeros, buckets)
}

/** How many values `sketch` holds. */
export const countOf = (sketch: QuantileSketch): number =>
  sketch.counts.reduce((total, count) => total + count, sketch.zeros)

/**
 * The `quantile` of the values in `sketch`, within `relativeAccuracy` of the true value, by nearest
 * rank: the value at position `ceil(quantile * count)` of the values in order, the first for 0. So
 * p99 of fewer than 100 values is the largest, as "the slowest 1%" reads. None for no values.
 */
export const quantileOf = (sketch: QuantileSketch, quantile: Quantile): Option.Option<number> => {
  const count = countOf(sketch)
  if (count === 0) {
    return Option.none()
  }
  // The zero-based position of the value asked for.
  const rank = Math.max(Math.ceil(quantile * count) - 1, 0)
  if (rank < sketch.zeros) {
    return Option.some(0)
  }
  let seen = sketch.zeros
  for (const [position, inBucket] of sketch.counts.entries()) {
    seen += inBucket
    if (seen > rank) {
      return Option.some((2 * gamma ** (sketch.offset + position)) / (gamma + 1))
    }
  }
  // The highest bucket holds the value of rank count - 1, so the loop has returned before here.
  return Option.some((2 * gamma ** (sketch.offset + sketch.counts.length - 1)) / (gamma + 1))
}
