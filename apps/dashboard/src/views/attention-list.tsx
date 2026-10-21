import type { ReactNode } from "react"

import type { Route } from "@/router"
import { Link } from "@/router"
import { buttonVariants } from "@/views/ui/button"

/** Something that needs the founder now: what, a line of evidence, and one way to look closer. */
export type Attention = {
  readonly key: string
  /** Red for something failing, yellow for something slow or new, gray for what is over. */
  readonly tone: "failure" | "warning" | "over"
  readonly title: ReactNode
  readonly detail: string
  readonly action?: { readonly label: string; readonly to: Route }
}

const toneColor = { failure: "var(--failure)", warning: "var(--yellow)", over: "var(--muted-foreground)" } as const

/**
 * The few things that need attention, the worst first, each one click from its detail. When there
 * are none it says so, so an empty list reads as "all is well", not as "nothing loaded".
 */
export function AttentionList({ items }: { readonly items: ReadonlyArray<Attention> }) {
  if (items.length === 0) {
    return (
      <p className="flex items-center gap-3 px-5 py-5 text-[15px]">
        <span className="size-2.5 bg-mint" />
        Nothing needs you right now.
      </p>
    )
  }
  return (
    <ul className="divide-y">
      {items.map((item) => (
        <li
          key={item.key}
          className="grid grid-cols-[0.625rem_minmax(0,1fr)] items-center gap-x-4 gap-y-2 px-5 py-3.5 sm:grid-cols-[0.625rem_minmax(0,1fr)_auto]"
        >
          <span className="size-2.5" style={{ backgroundColor: toneColor[item.tone] }} />
          <span className="flex min-w-0 flex-col">
            <span className="text-[15px]">{item.title}</span>
            <span className="text-sm text-muted-foreground">{item.detail}</span>
          </span>
          {item.action !== undefined && (
            <Link
              to={item.action.to}
              className={buttonVariants({
                variant: "outline",
                size: "sm",
                className: "col-start-2 justify-self-start sm:col-start-auto",
              })}
            >
              {item.action.label}
            </Link>
          )}
        </li>
      ))}
    </ul>
  )
}
