# @cluenori/quantile-sketch

Quantiles (p50, p95, p99) of large sets of values, such as request durations, from small sketches
that merge: sketch each batch, store the sketches, and read any quantile of any span of them later.

## Use it

```ts
import { mergeSketches, Quantile, quantileOf, SketchValue, sketchOf } from "@cluenori/quantile-sketch"

// At ingest: one sketch per batch, stored as plain data.
const batch = sketchOf(durationsInMs.map((ms) => SketchValue.make(ms)))

// When asked: merge the stored sketches of the period, then read.
const p95 = quantileOf(mergeSketches(storedSketches), Quantile.make(0.95))
// Option.some(480.2): within 2% of the true p95. Option.none() when there were no values.
```

`SketchValue.make` refuses a negative or infinite value, so a caller decides what such a value means
before it reaches a sketch.

## Contract

`src/index.ts`. Callers make sketches from values, merge them, and read quantiles and counts. A
sketch is a Schema, so it can be stored and sent as it is.

## Depends on

`effect`.

## Decisions and constraints

- **DDSketch with logarithmic buckets and no collapsing.** Every quantile is within 2% of the true
  value, and merging is exact: merging sketches gives the sketch of all their values together.
- **Nearest rank.** A quantile is the value at position `ceil(q * count)`, so p99 of fewer than 100
  values is the largest, as "the slowest 1%" reads.
- **Size follows the spread of the values,** about 58 buckets per factor of 10, not their number:
  durations from 1 ms to 10 s take about 230 buckets.
- **Zero, and anything up to 1e-9, counts in a bucket of its own,** read back as zero.
