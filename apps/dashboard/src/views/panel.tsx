import { cn } from "cn"
import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"

/**
 * A panel: one question about the project, answered in place. A header with an icon, a title, a
 * gray line that says what it covers, and the time zone of its chart; then the content, which may
 * end with `PanelStats`.
 */
export function Panel({
  icon: Icon,
  title,
  subtitle,
  badge,
  action,
  children,
  className,
}: {
  readonly icon: LucideIcon
  readonly title: string
  readonly subtitle: ReactNode
  /** The time zone of the panel's chart of time, such as GMT+2; counts belong in the title or stats. */
  readonly badge?: ReactNode
  /** A button in the header, such as a link to the page with the details. */
  readonly action?: ReactNode
  readonly children: ReactNode
  readonly className?: string
}) {
  return (
    <section aria-label={title} className={cn("flex min-w-0 flex-col border bg-card", className)}>
      <header className="flex items-center gap-4 border-b px-5 py-4">
        <span className="grid size-10 shrink-0 place-items-center border text-foreground/90">
          <Icon className="size-[18px]" strokeWidth={1.75} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[17px] font-medium tracking-[-0.01em]">{title}</span>
          <span className="truncate text-sm text-muted-foreground">{subtitle}</span>
        </span>
        {badge !== undefined && (
          <span className="shrink-0 border px-2.5 py-1 font-mono text-sm text-muted-foreground">{badge}</span>
        )}
        {action}
      </header>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </section>
  )
}

/**
 * The few numbers that matter to a panel, in a strip at its foot, so they are read without pointing
 * at anything. It goes last in the panel's content, with the answer the numbers come from.
 */
export function PanelStats({ stats }: { readonly stats: ReadonlyArray<Stat> }) {
  return (
    <dl className="mt-auto grid divide-y border-t sm:auto-cols-fr sm:grid-flow-col sm:divide-x sm:divide-y-0">
      {stats.map((stat) => (
        <div key={stat.label} className="flex min-w-0 flex-col gap-1.5 px-5 py-4">
          <dt className="truncate text-sm text-muted-foreground">{stat.label}</dt>
          <dd className="truncate font-mono text-lg" style={stat.color === undefined ? {} : { color: stat.color }}>
            {stat.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/** A number a panel shows at its foot, optionally in the color of what it is about. */
export type Stat = { readonly label: string; readonly value: string; readonly color?: string }
