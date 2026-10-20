import { AsyncResult } from "effect/reactivity"
import type { ReactNode } from "react"

import { axisTime } from "@/lib/format"

/**
 * The top of a project's page: what the page is, whether data is arriving and how fresh it is, and
 * the page's controls.
 */
export function ProjectHeader({
  title,
  latest,
  children,
}: {
  readonly title: string
  /**
   * When the newest data the page shows was received, undefined when none was in the period, as the
   * answer it comes from says. Until that answer arrives, or if it fails, the line stays empty.
   */
  readonly latest: AsyncResult.AsyncResult<number | undefined, unknown>
  readonly children?: ReactNode
}) {
  return (
    <header className="flex flex-wrap items-center gap-x-6 gap-y-3 pb-2">
      <div className="flex min-w-0 flex-col">
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">{title}</h1>
        <p className="flex min-h-5 items-center gap-2 text-sm text-muted-foreground">
          {AsyncResult.isSuccess(latest) &&
            (latest.value === undefined ? (
              <>
                <span className="size-1.5 rounded-full bg-muted-foreground/50" />
                Nothing received in this period
              </>
            ) : (
              <>
                <span className="size-1.5 rounded-full bg-mint" />
                Receiving data, latest at <span className="font-mono">{axisTime(latest.value)}</span>
              </>
            ))}
        </p>
      </div>
      {children !== undefined && (
        <div className="ml-auto flex max-w-full min-w-0 flex-wrap items-center gap-3">{children}</div>
      )}
    </header>
  )
}
