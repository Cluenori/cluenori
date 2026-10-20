import type { ComponentKey } from "@cluenori/foundation"

import { colorOf } from "@/project-facts"
import { Segmented } from "@/views/segmented"

const all = "all"

/**
 * Which of the project's components a page shows: one click, each in its color, and "All" where a
 * page can show every component at once.
 */
export function ComponentSwitch({
  components,
  value,
  onChange,
  allowAll,
}: {
  /** The project's components, in the order that gives each its color. */
  readonly components: ReadonlyArray<ComponentKey>
  /** The chosen component, or undefined for all of them. */
  readonly value: ComponentKey | undefined
  readonly onChange: (component: ComponentKey | undefined) => void
  readonly allowAll: boolean
}) {
  return (
    <Segmented<ComponentKey | typeof all>
      label="Component"
      options={[
        ...(allowAll ? [{ value: all, label: "All" } as const] : []),
        ...components.map((component) => ({
          value: component,
          label: (
            <>
              <span className="size-2" style={{ backgroundColor: colorOf(component, components) }} />
              {component}
            </>
          ),
        })),
      ]}
      value={value ?? all}
      onChange={(picked) => onChange(picked === all ? undefined : picked)}
    />
  )
}
