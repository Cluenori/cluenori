import { cn } from "cn"

import { change } from "@/lib/format"

// More people is good news in mint; fewer, something to look at, in yellow.
const inkOf = (moved: number) => {
  if (moved > 0) {
    return "text-mint-ink"
  }
  return moved < 0 ? "text-yellow-ink" : "text-muted-foreground"
}

/**
 * How a count moved since the week before, in words: "+6% vs last week". When it can't be said,
 * why: `unknown` names what is missing, such as "Nothing a week before to compare".
 */
export function TrendWords({
  moved,
  unknown,
  className,
}: {
  /** The change as a share of the week before: 0.06 for 6% more; undefined when unknown. */
  readonly moved: number | undefined
  readonly unknown: string
  readonly className?: string
}) {
  if (moved === undefined) {
    return <span className={cn("text-muted-foreground", className)}>{unknown}</span>
  }
  return <span className={cn(inkOf(moved), className)}>{change(moved)} vs last week</span>
}
