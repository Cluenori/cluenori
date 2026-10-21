import { DateTime, Schema } from "effect"

import { Instant } from "./instant.ts"

/**
 * A span of time, from `from` up to but not including `to`, as every filter by time takes it: `from`
 * is before `to`. On the wire, both are ISO 8601 UTC text.
 */
export class Period extends Schema.Class<Period>("Period")(
  Schema.Struct({
    from: Instant,
    to: Instant,
  }).check(
    Schema.makeFilter((period) => DateTime.isLessThan(period.from, period.to), {
      expected: "a period whose from is before its to",
    }),
  ),
) {}
