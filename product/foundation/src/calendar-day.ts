import { DateTime, Schema } from "effect"

const dayMillis = 86_400_000

/**
 * A calendar day in UTC, as `YYYY-MM-DD`: `2026-10-21`. What counts by day are counted in: a day
 * starts at midnight UTC, whatever the time zone of whoever reads it. Compares as text in day order.
 */
export const CalendarDay = Schema.String.check(
  Schema.isPattern(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, {
    expected: "a calendar day as YYYY-MM-DD, such as 2026-10-21",
  }),
)
  .pipe(Schema.brand("CalendarDay"))
  .annotate({ identifier: "CalendarDay", format: "date" })
export type CalendarDay = typeof CalendarDay.Type

/** The day an instant falls on, in UTC. */
export const calendarDayOf = (instant: DateTime.Utc): CalendarDay =>
  CalendarDay.make(DateTime.formatIso(instant).slice(0, 10))

/** The days since 1970-01-01 of the UTC day an instant (Unix ms) falls on: how days are stored. */
export const dayNumberOf = (millis: number) => Math.floor(millis / dayMillis)

/** The calendar day of a stored day number. */
export const calendarDayOfNumber = (day: number): CalendarDay => calendarDayOf(DateTime.makeUnsafe(day * dayMillis))

/** When a stored day number starts, in Unix ms. */
export const dayStartMillis = (day: number) => day * dayMillis
