import { cn } from "cn"
import { Cause, Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import type { ReactNode } from "react"
import { createContext, useContext, useEffect, useState } from "react"

// What a person reads for each failure the API names; anything else is the API not answering.
const failureWords: Readonly<Record<string, string>> = {
  Unauthorized: "You're signed out. Sign in again to see this.",
  ProjectNotFound: "There is no such project here; the link may be from another deployment.",
  ErrorGroupNotFound: "Cluenori has no such error: it may have been forgotten, 15 months after it was last seen.",
  LogLineNotFound: "This line is no longer kept: warnings and errors are kept 90 days.",
  LogMessageNotFound: "Cluenori has no such log message: it may have been forgotten, 15 months after it was last seen.",
  ComponentNotFound: "The project has no such component any more; reload the page to see its components.",
  ArchiveUnavailable: "The archive didn't answer. Try again in a moment.",
  PersonNotFound:
    "No person has this ID or user ID: the apps never sent it. Check it is the ID the app gives Cluenori.identify.",
  FeatureNotFound:
    "Nothing kept names this feature: no app marked it in 15 months, and no service named it in cluenori.feature.",
  SdkKeyNotFound: "The component has no such SDK key any more; reload the page to see its keys.",
  TooManySdkKeys: "The component has 20 active SDK keys, the most it may: revoke one first.",
  IngestKeyNotFound: "The component no longer lists this ingest key; reload the page to see its keys.",
  IncidentNotFound: "This project has no such incident: the link may be from another project.",
  MonitorNotFound: "This project has no such monitor: it may have been removed.",
  FeedNotFound: "There is no such feed here: it may have been deleted, or it lists no project you see.",
  NotAllowed: "Only an owner can do this.",
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

const noAnswer = Symbol("no answer")

/**
 * What a page does when its first answer shows: from what the browser kept, while a newer one
 * loads, or from the network. The app measures it; previews and the design kit do nothing.
 */
export const ScreenReady = createContext<(kind: "kept" | "fresh") => void>(() => undefined)

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
  const ready = useContext(ScreenReady)
  // An answer there as the panel first shows was kept; any answer after it is the network's. A
  // page's first of each kind counts, whichever panel it is in.
  const [atStart] = useState<unknown>(() => (AsyncResult.isSuccess(result) ? result.value : noAnswer))
  useEffect(() => {
    if (atStart !== noAnswer) {
      ready("kept")
    }
  }, [atStart, ready])
  const fresh = AsyncResult.isSuccess(result) && !result.waiting && result.value !== atStart
  useEffect(() => {
    if (fresh) {
      ready("fresh")
    }
  }, [fresh, ready])
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
