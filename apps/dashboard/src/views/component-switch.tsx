import { colorOf, components } from "@/project-facts"
import { Segmented } from "@/views/segmented"

const all = "all"

/**
 * Which of the project's components a page shows: one click, each in its color, and "All" where a
 * page can show every component at once.
 */
export function ComponentSwitch({
  value,
  onChange,
  allowAll,
}: {
  /** The chosen component, or undefined for all of them. */
  readonly value: string | undefined
  readonly onChange: (component: string | undefined) => void
  readonly allowAll: boolean
}) {
  return (
    <Segmented
      label="Component"
      options={[
        ...(allowAll ? [{ value: all, label: "All" }] : []),
        ...components.map((component) => ({
          value: component,
          label: (
            <>
              <span className="size-2" style={{ backgroundColor: colorOf(component) }} />
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
