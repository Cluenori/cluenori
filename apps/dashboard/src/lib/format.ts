// What the dashboard shows people: numbers, durations, and times in the viewer's own locale and time
// zone, read once from the browser and passed to Intl explicitly (PATTERNS.md, entry 2).

const locale = navigator.language
const timeZone = Intl.DateTimeFormat(locale).resolvedOptions().timeZone

const whole = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 })
const compactNumber = new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 })
const percent = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 })
const percentFine = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 2 })
const oneDecimal = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 })
const twoDecimals = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 })
const clock = new Intl.DateTimeFormat(locale, { timeZone, hour: "2-digit", minute: "2-digit" })
const clockSeconds = new Intl.DateTimeFormat(locale, {
  timeZone,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  fractionalSecondDigits: 3,
})
const day = new Intl.DateTimeFormat(locale, { timeZone, month: "short", day: "numeric" })
const dayAndClock = new Intl.DateTimeFormat(locale, {
  timeZone,
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
})
const relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "long" })
const regions = new Intl.DisplayNames([locale], { type: "region" })
// Axes are narrow, so their times use a 24-hour clock in every locale: 06:00, 18:30.
const axisClock = new Intl.DateTimeFormat(locale, { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })

const minute = 60_000
const hour = 60 * minute
const dayMillis = 24 * hour

/** 48,210 */
export const count = (value: number) => whole.format(value)

/** 48.2K */
export const compact = (value: number) => compactNumber.format(value)

/** The share of `part` in `total`: 0.4%, or "–" when there is no total to share. */
export const share = (part: number, total: number) => {
  if (total === 0) {
    return "–"
  }
  const ratio = part / total
  return ratio > 0 && ratio < 0.001 ? percentFine.format(ratio) : percent.format(ratio)
}

/** A duration a person reads at a glance: 0.4 ms, 18 ms, 1.2 s, 2 min, 2.7 h. */
export const duration = (milliseconds: number) => {
  if (milliseconds < 1) {
    return `${twoDecimals.format(milliseconds)} ms`
  }
  if (milliseconds < 1000) {
    return `${whole.format(milliseconds)} ms`
  }
  if (milliseconds < minute) {
    return `${oneDecimal.format(milliseconds / 1000)} s`
  }
  if (milliseconds < hour) {
    return `${oneDecimal.format(milliseconds / minute)} min`
  }
  return `${oneDecimal.format(milliseconds / hour)} h`
}

/** 14:05 in the viewer's time zone. */
export const clockTime = (epochMillis: number) => clock.format(epochMillis)

/** 14:05:09.312, for the steps of a trace. */
export const preciseTime = (epochMillis: number) => clockSeconds.format(epochMillis)

/** 18:30 on a 24-hour clock, for the axes of charts. */
export const axisTime = (epochMillis: number) => axisClock.format(epochMillis)

/** Oct 20 */
export const dayOf = (epochMillis: number) => day.format(epochMillis)

/** Oct 20, 14:05 */
export const moment = (epochMillis: number) => dayAndClock.format(epochMillis)

/** "3 minutes ago", "yesterday": how long before `now` something happened. */
export const ago = (epochMillis: number, now: number) => {
  const elapsed = epochMillis - now
  if (Math.abs(elapsed) < hour) {
    return relative.format(Math.round(elapsed / minute), "minute")
  }
  if (Math.abs(elapsed) < dayMillis) {
    return relative.format(Math.round(elapsed / hour), "hour")
  }
  return relative.format(Math.round(elapsed / dayMillis), "day")
}

/** "Poland" for `PL`: a country by its two letters, as Cloudflare places an address; the code if unknown. */
export const countryName = (code: string) => {
  try {
    return regions.of(code) ?? code
  } catch {
    return code
  }
}

/** The viewer's time zone, for saying which one times are in. */
export const viewerTimeZone = timeZone
