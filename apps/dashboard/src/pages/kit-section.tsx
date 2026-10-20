import { cn } from "cn"
import type { ReactNode } from "react"

import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/views/ui/card"

/** One part of the design kit, such as Forms: a heading, what it shows, and its cards in a grid. */
export function KitGroup({
  id,
  title,
  description,
  children,
}: {
  /** The anchor the kit's contents link to: "forms". */
  readonly id: string
  readonly title: string
  readonly description: string
  readonly children: ReactNode
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="flex scroll-mt-20 flex-col gap-4 pt-4">
      <div className="flex flex-col gap-1">
        <h2 id={`${id}-title`} className="text-xl font-semibold tracking-tight">
          {title}
        </h2>
        <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="grid items-start gap-4 xl:grid-cols-2">{children}</div>
    </section>
  )
}

/** A column of cards inside a part of the kit, so cards of different heights stack without gaps. */
export function KitColumn({ children }: { readonly children: ReactNode }) {
  return <div className="flex min-w-0 flex-col gap-4">{children}</div>
}

/**
 * A card showing one view, or a few that belong together. Its footer names the files that define
 * them, so a change is easy to find. `wide` takes both columns of the grid.
 */
export function KitCard({
  title,
  description,
  files,
  wide = false,
  className,
  children,
}: {
  readonly title: string
  readonly description: string
  /** The files that define what the card shows, such as "button.tsx" in `src/views/ui/`. */
  readonly files: ReadonlyArray<string>
  readonly wide?: boolean
  readonly className?: string
  readonly children: ReactNode
}) {
  return (
    <Card className={cn("min-w-0 rounded-2xl", wide && "xl:col-span-2")}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className={cn("flex min-w-0 flex-col gap-6", className)}>{children}</CardContent>
      <CardFooter className="flex-wrap gap-x-3 gap-y-1 py-3 text-xs text-muted-foreground">
        {files.map((file) => (
          <code key={file} className="font-mono">
            {file}
          </code>
        ))}
      </CardFooter>
    </Card>
  )
}

/** A labelled example inside a card: "Disabled", "With an icon". */
export function KitSample({
  label,
  className,
  children,
}: {
  readonly label: string
  readonly className?: string
  readonly children: ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className={cn("flex min-w-0 flex-wrap items-center gap-2", className)}>{children}</div>
    </div>
  )
}
