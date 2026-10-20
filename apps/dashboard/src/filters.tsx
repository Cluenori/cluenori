import type { ReactNode } from "react"
import { createContext, useContext, useMemo, useState } from "react"

import type { PeriodKey } from "@/sample/sample-project"

/** The period every panel shows. It stays as the viewer moves between projects and into a request and back. */
export type Filters = { readonly period: PeriodKey }

type FiltersState = { readonly filters: Filters; readonly change: (next: Filters) => void }

const FiltersContext = createContext<FiltersState | undefined>(undefined)

export function FiltersProvider({ children }: { readonly children: ReactNode }) {
  const [filters, change] = useState<Filters>({ period: "24h" })
  // A new value only when the period changes, so readers render again only then.
  const state = useMemo(() => ({ filters, change }), [filters])
  return <FiltersContext value={state}>{children}</FiltersContext>
}

/** The filters in effect, and how to change them. */
export const useFilters = (): FiltersState => {
  const state = useContext(FiltersContext)
  if (state === undefined) {
    throw new Error("useFilters is used outside FiltersProvider.")
  }
  return state
}
