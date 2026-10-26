import { assert, describe, it } from "@effect/vitest"
import { DateTime, Effect, Schema } from "effect"

import {
  CalendarDay,
  calendarDayOf,
  calendarDayOfNumber,
  dayNumberOf,
  dayStartMillis,
  Instant,
  Period,
} from "../src/index.ts"

describe("Instant", () => {
  it.effect("is an ISO 8601 UTC string on the wire, read as UTC from any zone", () =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeEffect(Instant)("2026-10-21T12:00:00+02:00")
      assert.strictEqual(DateTime.toEpochMillis(decoded), 1792576800000)
      assert.strictEqual(yield* Schema.encodeEffect(Instant)(decoded), "2026-10-21T10:00:00.000Z")
      assert.isTrue((yield* Schema.decodeEffect(Instant)("yesterday").pipe(Effect.flip))._tag === "SchemaError")
    }),
  )

  it("tells other languages it is a date-time", () => {
    assert.deepStrictEqual(Schema.toJsonSchemaDocument(Instant).schema, { type: "string", format: "date-time" })
    assert.deepStrictEqual(Schema.toJsonSchemaDocument(CalendarDay).definitions["CalendarDay"], {
      type: "string",
      allOf: [{ format: "date" }],
    })
  })
})

describe("UTC days and periods", () => {
  it("converts instants, stored day numbers and midnight milliseconds on both sides of the epoch", () => {
    for (const [millis, day, calendar, start] of [
      [-1, -1, "1969-12-31", -86_400_000],
      [0, 0, "1970-01-01", 0],
      [172_799_999, 1, "1970-01-02", 86_400_000],
      [172_800_000, 2, "1970-01-03", 172_800_000],
    ] as const) {
      assert.strictEqual(dayNumberOf(millis), day)
      assert.strictEqual<string>(calendarDayOfNumber(day), calendar)
      assert.strictEqual(dayStartMillis(day), start)
      assert.strictEqual<string>(calendarDayOf(DateTime.makeUnsafe(millis)), calendar)
    }
    assert.strictEqual(calendarDayOf(DateTime.makeUnsafe("2026-10-21T23:30:00-03:00")), "2026-10-22")
  })

  it.effect("accepts a forward period and refuses equal or reversed endpoints", () =>
    Effect.gen(function* () {
      const from = "2026-10-21T10:00:00.000Z"
      const to = "2026-10-21T10:00:00.001Z"
      const period = yield* Schema.decodeEffect(Period)({ from, to })
      const encoded = yield* Schema.encodeEffect(Period)(period)
      assert.deepStrictEqual(encoded, { from, to })
      for (const invalid of [
        { from, to: from },
        { from: to, to: from },
      ]) {
        const refused = yield* Schema.decodeEffect(Period)(invalid).pipe(Effect.flip)
        assert.strictEqual(refused._tag, "SchemaError")
      }
    }),
  )
})
