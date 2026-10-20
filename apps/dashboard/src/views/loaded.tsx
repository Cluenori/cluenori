import { cn } from "cn"
import { Cause, Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import type { ReactNode } from "react"

// What a person reads for each failure the API names; anything else is the API not answering.
const failureWords: Readonly<Record<string, string>> = {
  Unauthorized: "You're signed out. Sign in again to see this.",
  ProjectNotFound: "There is no such project here; the link may be from another deployment.",
  ErrorGroupNotFound: "This error didn't happen in this period.",
  ArchiveUnavailable: "The archive didn't answer. Try again in a moment.",
}

const tagOf = (error: unknown) =>
  typeof error === "object" && error !== null && "_tag" in error && typeof error._tag === "string"
    ? error._tag
    : undefined

/** What went wrong with an answer, in a sentence. */
export const failureText = <E,>(cause: Cause.Cause<E>) => {
  const error = Cause.findErrorOption(cause)
  const tag = Option.isSome(error) ? tagOf(error.value) : undefined
  const words = tag === undefined ? undefined : failureWords[tag]
  return words ?? "The API didn't answer. Check that Cluenori is running, then try again."
}

/**
 * One of the API's answers, as a panel shows it: a quiet line while it first loads, what failed if
 * it did, and the answer, dimmed while a newer one loads, so a page never blanks when the period
 * changes.
 */
export function Loaded<A, E>({
  result,
  children,
}: {
  readonly result: AsyncResult.AsyncResult<A, E>
  readonly children: (value: A) => ReactNode
}) {
  if (AsyncResult.isSuccess(result)) {
    return (
      <div
        aria-busy={result.waiting}
        className={cn("flex min-h-0 flex-1 flex-col transition-opacity duration-200", result.waiting && "opacity-60")}
      >
        {children(result.value)}
      </div>
    )
  }
  if (AsyncResult.isFailure(result)) {
    return (
      <p role="alert" className="px-5 py-6 text-sm text-failure">
        {failureText(result.cause)}
      </p>
    )
  }
  return (
    <p aria-busy className="px-5 py-6 text-sm text-muted-foreground">
      Loading…
    </p>
  )
}
