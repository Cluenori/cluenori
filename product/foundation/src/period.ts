import { DateTime, Schema } from "effect"

/**
 * A span of time, from `from` up to but not including `to`, as every filter by time takes it: `from`
 * is before `to`. On the wire, both are ISO 8601 UTC text.
 */
export class Period extends Schema.Class<Period>("Period")(
  Schema.Struct({
    from: Schema.DateTimeUtcFromString,
    to: Schema.DateTimeUtcFromString,
  }).check(
    Schema.makeFilter((period) => DateTime.isLessThan(period.from, period.to), {
      expected: "a period whose from is before its to",
    }),
  ),
) {}
