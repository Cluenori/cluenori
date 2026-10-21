import { duration } from "@/lib/format"
import type { Slower } from "@/views/operation-table"

/**
 * How something timed did over the last day against its usual, the 7 days before, in a sentence:
 * "Slower than usual" first when it got slower, and a plain comparison otherwise.
 */
export function SinceUsual({
  timed,
  measure = "p95",
}: {
  readonly timed: { readonly lastDayP95Ms: number; readonly usualP95Ms?: number; readonly slower?: Slower }
  /** What the numbers are, such as "p95" or "Cold start p95". */
  readonly measure?: string
}) {
  if (timed.usualP95Ms === undefined) {
    return <>New this week: there is no {measure} from the 7 days before to compare with.</>
  }
  return (
    <>
      {timed.slower !== undefined && <span className="text-yellow">Slower than usual: </span>}
      {measure} {duration(timed.lastDayP95Ms)} over the last day, {duration(timed.usualP95Ms)} over the 7 days before.
    </>
  )
}
