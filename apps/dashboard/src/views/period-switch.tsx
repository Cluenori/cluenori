import { useAtom } from "@effect/atom-react"

import { periodAtom, periods } from "@/project-data"
import { periodWords } from "@/project-facts"
import { Segmented } from "@/views/segmented"

/** How far back every page looks: one choice, kept as the viewer moves between pages. */
export function PeriodSwitch() {
  const [period, setPeriod] = useAtom(periodAtom)
  return (
    <Segmented
      label="Period"
      mono
      options={periods.map((entry) => ({ value: entry.key, label: entry.label, description: periodWords[entry.key] }))}
      value={period}
      onChange={setPeriod}
    />
  )
}
