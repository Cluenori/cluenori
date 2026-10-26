import type { PeopleCount, PeopleNow } from "@/app-facts"
import { changeOf } from "@/app-facts"
import { calendarDayText, count } from "@/lib/format"
import { TrendWords } from "@/views/trend-words"

/**
 * Daily, weekly and monthly people as three big counters, the answer an analytics page starts with:
 * each on the latest whole UTC day, against a week before, with its days over the period below it.
 * A count that isn't known says so, never 0.
 */
export function PeopleCounters({ now, color }: { readonly now: PeopleNow; readonly color: string }) {
  const counters: ReadonlyArray<{ readonly label: string; readonly of: PeopleCount; readonly unknown: string }> = [
    { label: "Daily people", of: now.daily, unknown: "Not counted that day" },
    { label: "Weekly people", of: now.weekly, unknown: "Not 7 days counted yet" },
    { label: "Monthly people", of: now.monthly, unknown: "Not 30 days counted yet" },
  ]
  return (
    <section aria-label="People" className="flex min-w-0 flex-col border bg-card">
      <dl className="grid divide-y md:grid-cols-3 md:divide-x md:divide-y-0">
        {counters.map((counter) => (
          <Counter key={counter.label} label={counter.label} of={counter.of} unknown={counter.unknown} color={color} />
        ))}
      </dl>
      <p className="border-t px-5 py-3 text-sm text-muted-foreground">
        {now.day === undefined
          ? "No whole UTC day in this period yet."
          : `On ${calendarDayText(now.day)}, the latest whole UTC day, against the same day a week before; weekly and monthly are the people of the 7 and 30 days ending it.`}
      </p>
    </section>
  )
}

function Counter({
  label,
  of,
  unknown,
  color,
}: {
  readonly label: string
  readonly of: PeopleCount
  readonly unknown: string
  readonly color: string
}) {
  const moved = changeOf(of)
  const known = of.columns.values.filter((value): value is number => value !== undefined)
  const most = Math.max(1, ...known)
  return (
    <div className="flex min-w-0 flex-col gap-2 px-5 pt-5 pb-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 flex-col gap-1">
        <span className={of.value === undefined ? "font-mono text-5xl text-muted-foreground" : "font-mono text-5xl"}>
          {of.value === undefined ? (
            <>
              <span aria-hidden>—</span>
              <span className="sr-only">Unknown</span>
            </>
          ) : (
            count(of.value)
          )}
        </span>
        <TrendWords
          moved={moved}
          unknown={of.value === undefined ? unknown : "Not counted a week before"}
          className="text-sm"
        />
      </dd>
      {/* Each day of the period: hatched where it isn't counted, a gap where it was none. */}
      <dd aria-hidden className="mt-2 flex h-10 items-end gap-px">
        {of.columns.values.map((value, index) => (
          <span
            key={of.columns.days[index]}
            className={value === undefined ? "hatch h-full flex-1" : "flex-1"}
            style={
              value === undefined ? {} : { height: `${Math.max(2, (value / most) * 100)}%`, backgroundColor: color }
            }
          />
        ))}
      </dd>
    </div>
  )
}
