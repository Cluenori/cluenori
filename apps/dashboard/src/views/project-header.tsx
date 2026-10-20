import type { ReactNode } from "react"

import { axisTime } from "@/lib/format"
import { now } from "@/project-facts"

/** The top of a project's page: what the page is, that data is arriving, and the page's controls. */
export function ProjectHeader({ title, children }: { readonly title: string; readonly children?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-center gap-x-6 gap-y-3 pb-2">
      <div className="flex min-w-0 flex-col">
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">{title}</h1>
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="size-1.5 rounded-full bg-mint" />
          Receiving data, latest at <span className="font-mono">{axisTime(now - 60_000)}</span>
        </p>
      </div>
      {children !== undefined && (
        <div className="ml-auto flex max-w-full min-w-0 flex-wrap items-center gap-3">{children}</div>
      )}
    </header>
  )
}
