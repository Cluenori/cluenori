import { cn } from "cn"

import type { StripDay } from "@/incident-facts"
import { calendarDayText, count, uptime } from "@/lib/format"

// Each day's color: mint when every check passed, yellow when some failed, red when all did; hatched
// when it wasn't checked while watched, which is unknown, never up; nothing before it was added.
const toneClass: Readonly<Record<StripDay["tone"], string>> = {
  up: "bg-mint",
  some: "bg-yellow",
  down: "bg-failure",
  unchecked: "hatch text-muted-foreground",
  before: "bg-muted",
}

const dayWords = (day: StripDay) => {
  const when = calendarDayText(day.day)
  switch (day.tone) {
    case "before":
      return `${when}: not watched yet`
    case "unchecked":
      return `${when}: not checked`
    case "up":
    case "some":
    case "down":
      return `${when}: ${uptime(day.checks - day.failed, day.checks)} up, ${count(day.failed)} of ${count(day.checks)} checks failed`
  }
}

/**
 * A monitor's days as a strip of cells, the oldest first, each colored by how its checks went and
 * named on hover. For screen readers, `label` says what the strip shows in a sentence.
 */
export function UptimeStrip({
  days,
  label,
  className,
}: {
  readonly days: ReadonlyArray<StripDay>
  readonly label: string
  readonly className?: string
}) {
  return (
    <div role="img" aria-label={label} className={cn("flex h-7 min-w-0 items-stretch gap-px", className)}>
      {days.map((day) => (
        <span key={day.day} title={dayWords(day)} className={cn("min-w-0 flex-1", toneClass[day.tone])} />
      ))}
    </div>
  )
}
