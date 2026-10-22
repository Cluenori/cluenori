import type { Promotion } from "@cluenori/releases"
import { cn } from "cn"
import { DateTime } from "effect"
import { ArrowUpRightIcon } from "lucide-react"

import { ago, moment } from "@/lib/format"
import type { PromotionTone } from "@/release-facts"
import { distributionWords, promotionStates } from "@/release-facts"
import { Button } from "@/views/ui/button"

// Each tone's color: mint while it moves, pulsing, and once it succeeded; yellow while it waits for
// someone or isn't followed; red when it failed; gray when it was cancelled.
/** The color a promotion's state is said in, by its tone. */
export const toneText: Readonly<Record<PromotionTone, string>> = {
  moving: "text-foreground",
  waiting: "text-yellow",
  succeeded: "text-mint",
  failed: "text-failure",
  cancelled: "text-muted-foreground",
  lost: "text-yellow",
}
/** The mark beside a promotion's state, by its tone. */
export const toneMark: Readonly<Record<PromotionTone, string>> = {
  moving: "bg-mint motion-safe:animate-pulse",
  waiting: "bg-yellow",
  succeeded: "bg-mint",
  failed: "bg-failure",
  cancelled: "bg-muted-foreground",
  lost: "bg-yellow",
}

/** Where a promotion stands, in words, in its tone's color, after a mark of it. */
export function PromotionStateWords({
  state,
  className,
}: {
  readonly state: Promotion["state"]
  readonly className?: string
}) {
  const { words, tone } = promotionStates[state]
  return (
    <span className={cn("flex min-w-0 items-center gap-2", toneText[tone], className)}>
      <span aria-hidden className={cn("size-2 shrink-0", toneMark[tone])} />
      {words}
    </span>
  )
}

// Wide, a promotion is a line of columns under their names; on a phone, its parts stack.
const grid =
  "lg:grid lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,1.5fr)_8.5rem] lg:items-center lg:gap-x-5"

// How a promotion to the App Store was submitted, in words: "Released manually, phased over 7 days".
const submissionWords = (promotion: Promotion) => {
  const submission = promotion.submission
  if (submission === undefined) {
    return undefined
  }
  const release = submission.releaseType === "manual" ? "Released manually" : "Released when approved"
  return submission.phased ? `${release}, phased over 7 days` : release
}

/**
 * A release's promotions, the latest first: the environment each went to, its workflow and App
 * Store Connect app, where it stands in words, when it started (how long ago, the exact time on
 * pointing), who started it, why, and its run on GitHub once known. One App Store review approved,
 * to be released by a member, has a button to release it now.
 */
export function PromotionList({
  promotions,
  now,
  starterOf,
  onReleaseNow,
}: {
  readonly promotions: ReadonlyArray<Promotion>
  /** The time the list is of, which "how long ago" is measured from. */
  readonly now: DateTime.Utc
  /** Who started a promotion, in words: "you", an email, "an agent or process". */
  readonly starterOf: (promotion: Promotion) => string
  /** Releases an approved promotion, after asking; absent where the page can't. */
  readonly onReleaseNow?: (promotion: Promotion) => void
}) {
  const nowMs = DateTime.toEpochMillis(now)
  return (
    <div className="flex flex-col">
      <div className={cn(grid, "hidden border-b px-5 py-2.5 text-sm text-muted-foreground")}>
        <span>Environment</span>
        <span>State</span>
        <span>Started</span>
        <span>Reason</span>
        <span>
          <span className="sr-only">Run</span>
        </span>
      </div>
      <ul className="divide-y">
        {promotions.map((promotion) => {
          const started = DateTime.toEpochMillis(promotion.startedAt)
          return (
            <li key={promotion.id} className={cn(grid, "flex flex-col gap-1 px-5 py-3")}>
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-[15px]">{promotion.environment}</span>
                {promotion.workflow !== undefined && (
                  <span className="font-mono text-sm wrap-anywhere text-muted-foreground">{promotion.workflow}</span>
                )}
                {promotion.appStore !== undefined && (
                  <span className="text-sm wrap-anywhere text-muted-foreground">
                    <span className="font-mono">{promotion.appStore.bundleId}</span>,{" "}
                    {distributionWords[promotion.appStore.distribution]}
                  </span>
                )}
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <PromotionStateWords state={promotion.state} className="text-[15px]" />
                {promotion.state === "approved" && (
                  <span className="text-sm text-muted-foreground">Waits for you to release it</span>
                )}
                {promotion.state === "rejected" && (
                  <span className="text-sm text-muted-foreground">Apple&apos;s reasons are in App Store Connect</span>
                )}
                {promotion.state !== "approved" &&
                  promotion.state !== "rejected" &&
                  submissionWords(promotion) !== undefined && (
                    <span className="text-sm text-muted-foreground">{submissionWords(promotion)}</span>
                  )}
              </span>
              <span className="text-sm wrap-anywhere text-muted-foreground lg:text-[15px] lg:text-foreground">
                <span className="lg:hidden">Started </span>
                <time dateTime={DateTime.formatIso(promotion.startedAt)} title={moment(started)}>
                  {/* A promotion just started may be ahead of the answer by a moment. */}
                  {ago(Math.min(started, nowMs), nowMs)}
                </time>
                <span className="text-muted-foreground"> by {starterOf(promotion)}</span>
              </span>
              {promotion.reason === undefined ? (
                <span className="hidden text-[15px] text-muted-foreground lg:block">
                  <span aria-hidden>–</span>
                  <span className="sr-only">No reason given</span>
                </span>
              ) : (
                <span className="text-sm wrap-anywhere lg:text-[15px]">{promotion.reason}</span>
              )}
              <span className="flex flex-wrap items-center gap-x-4 gap-y-1.5 lg:flex-col lg:items-end">
                {promotion.state === "approved" && onReleaseNow !== undefined && (
                  <Button size="sm" onClick={() => onReleaseNow(promotion)}>
                    Release now<span className="sr-only"> to {promotion.environment}</span>
                  </Button>
                )}
                {promotion.run !== undefined && (
                  <a
                    href={promotion.run.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:text-foreground focus-visible:underline"
                  >
                    Run on GitHub
                    <span className="sr-only"> of the promotion to {promotion.environment}</span>
                    <ArrowUpRightIcon aria-hidden className="size-3.5 shrink-0" />
                  </a>
                )}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
