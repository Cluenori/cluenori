import { useAtom } from "@effect/atom-react"

import { appPeriodAtom, appPeriods } from "@/project-data"
import { Segmented } from "@/views/segmented"

/** How far back the analytics pages look, in days: one choice, kept as the viewer moves between them. */
export function AppPeriodSwitch() {
  const [period, setPeriod] = useAtom(appPeriodAtom)
  return (
    <Segmented
      label="Period"
      mono
      options={appPeriods.map((entry) => ({
        value: entry.key,
        label: entry.label,
        description: `Last ${entry.days} days`,
      }))}
      value={period}
      onChange={setPeriod}
    />
  )
}
