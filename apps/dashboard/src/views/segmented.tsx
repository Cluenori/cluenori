import { cn } from "cn"
import type { ReactNode } from "react"

import { ToggleGroup, ToggleGroupItem } from "@/views/ui/toggle-group"

/**
 * One choice among a few, every option visible, one click to change: periods, components, levels.
 * Exactly one is always chosen; pressing the chosen one keeps it. Where the options don't fit, such
 * as many components on a phone, they scroll sideways within the control, not the page.
 */
export function Segmented<Value extends string>({
  label,
  options,
  value,
  onChange,
  mono = false,
  className,
}: {
  /** What the choice is about, for screen readers: "Period". */
  readonly label: string
  readonly options: ReadonlyArray<{ readonly value: Value; readonly label: ReactNode; readonly description?: string }>
  readonly value: Value
  readonly onChange: (value: Value) => void
  /** Options that are values, such as "24h", read better in mono. */
  readonly mono?: boolean
  readonly className?: string
}) {
  return (
    <ToggleGroup
      aria-label={label}
      value={[value]}
      onValueChange={(values) => {
        const picked = options.find((option) => option.value === values[0])
        if (picked !== undefined) {
          onChange(picked.value)
        }
      }}
      spacing={0}
      className={cn("max-w-full overflow-x-auto border bg-card [scrollbar-width:none]", className)}
    >
      {options.map((option) => (
        <ToggleGroupItem
          key={option.value}
          value={option.value}
          // The visible label is the name, so voice control can say it; the description is a tooltip.
          {...(option.description !== undefined ? { title: option.description } : {})}
          className={cn(
            "h-9 shrink-0 gap-2 border-0 px-3.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground data-pressed:bg-accent data-pressed:text-foreground",
            mono && "font-mono",
          )}
        >
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
