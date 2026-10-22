import type { CohortRow } from "@/app-facts"
import { calendarDayText, count, share } from "@/lib/format"

// How strongly a cell is tinted: its share of the cohort, up to this much of the color, so its number
// reads on it in light and dark.
const strongest = 0.55

/**
 * Weekly cohorts as a grid: a row for each week's new people, the oldest first, with how many there
 * were, then the share of them active in each week since, week 0 being all of them. Each number is
 * written in its cell, tinted by how large it is; the last of each row is the week now is in, so
 * far, outlined. Wider than a phone, the grid scrolls sideways within itself.
 */
export function RetentionGrid({
  rows,
  label,
  color,
}: {
  readonly rows: ReadonlyArray<CohortRow>
  readonly label: string
  /** The color of what the cohorts are of: a component's, or blue for every one. */
  readonly color: string
}) {
  const weeks = Math.max(0, ...rows.map((row) => row.weeks.length))
  return (
    <div className="flex flex-col gap-3">
      <div
        role="region"
        aria-label={label}
        tabIndex={0}
        className="relative overflow-x-auto outline-offset-2 focus-visible:outline-1"
      >
        <table className="w-full border-separate border-spacing-0.5 text-sm">
          <thead>
            <tr className="text-muted-foreground">
              <th scope="col" className="pr-3 pb-1.5 text-left font-normal whitespace-nowrap">
                First seen
              </th>
              <th scope="col" className="pr-3 pb-1.5 text-right font-normal">
                People
              </th>
              {Array.from({ length: weeks }, (_, index) => (
                <th key={index} scope="col" className="min-w-14 pb-1.5 text-center font-normal whitespace-nowrap">
                  {index === 0 ? "Week 0" : count(index)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.week}>
                <th scope="row" className="pr-3 text-left font-mono font-normal whitespace-nowrap">
                  {calendarDayText(row.week)}
                </th>
                <td className="pr-3 text-right font-mono">{count(row.people)}</td>
                {Array.from({ length: weeks }, (_, index) => {
                  const week = row.weeks[index]
                  if (week === undefined) {
                    return (
                      <td key={index}>
                        <span className="sr-only">not yet</span>
                      </td>
                    )
                  }
                  return (
                    <td
                      key={index}
                      className={
                        week.soFar
                          ? "h-9 border border-dashed border-foreground/40 text-center font-mono"
                          : "h-9 text-center font-mono"
                      }
                      style={{
                        backgroundColor: `color-mix(in oklab, ${color} ${Math.round(week.share * strongest * 100)}%, transparent)`,
                      }}
                    >
                      {share(week.active, row.people)}
                      {week.soFar && <span className="sr-only"> so far</span>}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-sm text-muted-foreground">
        Of the people first seen each week (Monday to Sunday, UTC), the share active in each week since. Outlined: this
        week, so far.
      </p>
    </div>
  )
}
