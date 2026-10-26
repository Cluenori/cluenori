import { cn } from "cn"
import { ChevronRightIcon } from "lucide-react"
import type { ReactNode } from "react"

import type { LineTone, ProductLine } from "@/product-lines"
import { productNames } from "@/product-lines"
import type { NeedsYou } from "@/project-facts"
import { Link } from "@/router"

// Each tone's dot, and the ink its product's name is in, which reads at 4.5:1 on a panel.
export const lineDot: Readonly<Record<LineTone, string>> = {
  failure: "bg-failure",
  warning: "bg-yellow",
  release: "bg-purple",
  steady: "bg-mint",
  quiet: "border border-muted-foreground/60",
  unknown: "bg-muted-foreground/50",
}
const lineInk: Readonly<Record<LineTone, string>> = {
  failure: "text-failure",
  warning: "text-yellow-ink",
  release: "text-purple",
  steady: "text-foreground",
  quiet: "text-foreground",
  unknown: "text-muted-foreground",
}

const rowLink =
  "outline-none hover:bg-accent/60 focus-visible:bg-accent/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"

/**
 * One product's line, as a row that leads where the line does: its tone's dot, the product's name,
 * what it says, and `aside`, such as a small chart of what it counts.
 */
export function ProductLineRow({
  line,
  detail,
  aside,
  className,
}: {
  readonly line: ProductLine
  /** A line of evidence under what it says, such as its one item's. */
  readonly detail?: string
  readonly aside?: ReactNode
  readonly className?: string
}) {
  return (
    <Link to={line.to} className={cn("flex items-center gap-4 px-5 py-3", rowLink, className)}>
      <span className={cn("size-2.5 shrink-0", lineDot[line.tone])} />
      {/* On a phone, what it says goes under the product's name. */}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-4">
        <span className={cn("shrink-0 text-[15px] font-medium sm:w-30", lineInk[line.tone])}>
          {productNames[line.product]}
        </span>
        <span
          className={cn(
            "min-w-0 flex-1 text-[15px] [overflow-wrap:anywhere]",
            (line.tone === "quiet" || line.tone === "unknown") && "text-muted-foreground",
          )}
        >
          {line.words}
          {detail !== undefined && <span className="block text-sm text-muted-foreground">{detail}</span>}
        </span>
      </span>
      {aside}
      <ChevronRightIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  )
}

/**
 * The lines with no news, in one quiet row: "Steady: Uptime · Errors · Analytics", each name leading
 * to its product and carrying its words for those who point at it or hear it.
 */
export function SteadyLines({
  lines,
  className,
}: {
  readonly lines: ReadonlyArray<ProductLine>
  readonly className?: string
}) {
  if (lines.length === 0) {
    return null
  }
  return (
    <p className={cn("flex flex-wrap items-baseline gap-x-1.5 gap-y-1 text-sm text-muted-foreground", className)}>
      <span className={cn("mr-1 inline-block size-2 self-center", lineDot.steady)} />
      <span>Steady:</span>
      {lines.map((line, index) => (
        <span key={line.product} className="inline-flex items-baseline gap-1.5">
          {index > 0 && <span aria-hidden>·</span>}
          <Link
            to={line.to}
            title={line.words}
            aria-label={`${productNames[line.product]}: ${line.words}`}
            className="text-foreground/90 underline-offset-4 outline-none hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          >
            {productNames[line.product]}
          </Link>
        </span>
      ))}
    </p>
  )
}

/**
 * The things behind a line, under it, a row each: what it is, a line of evidence, and when, each
 * leading to its own page.
 */
export function LineItems({ items }: { readonly items: ReadonlyArray<NeedsYou> }) {
  return (
    <ul aria-label="What it is about" className="flex flex-col pb-2">
      {items.map((item) => (
        <li key={item.key}>
          <Link
            to={item.to}
            className={cn(
              "flex flex-col gap-x-4 py-2 pr-5 sm:grid sm:grid-cols-[minmax(0,1fr)_auto] pl-[2.875rem] break-words sm:pl-[11.375rem]",
              rowLink,
            )}
          >
            <span className="flex min-w-0 flex-col">
              <span className="text-sm sm:truncate">
                <span className={lineInk[item.tone]}>{item.kind}</span> · {item.title}
              </span>
              <span className="text-sm text-muted-foreground sm:truncate">{item.detail}</span>
            </span>
            {item.when !== undefined && <span className="text-sm text-muted-foreground">{item.when}</span>}
          </Link>
        </li>
      ))}
    </ul>
  )
}
