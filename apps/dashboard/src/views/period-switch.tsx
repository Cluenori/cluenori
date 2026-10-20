import { useFilters } from "@/filters"
import { periods, periodWords } from "@/project-facts"
import { Segmented } from "@/views/segmented"

/** How far back the page looks, shared by every page that follows it. */
export function PeriodSwitch() {
  const { filters, change } = useFilters()
  return (
    <Segmented
      label="Period"
      mono
      options={periods.map((period) => ({
        value: period.key,
        label: period.label,
        description: periodWords[period.key],
      }))}
      value={filters.period}
      onChange={(period) => change({ period })}
    />
  )
}
