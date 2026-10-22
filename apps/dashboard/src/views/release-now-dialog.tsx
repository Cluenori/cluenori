import type { Promotion } from "@cluenori/releases"
import { PromotionNotFound, PromotionRefused, PromotionUnavailable } from "@cluenori/releases"
import { Cause, Option, Schema } from "effect"
import { AsyncResult } from "effect/reactivity"
import { RocketIcon } from "lucide-react"

import { failureText } from "@/views/loaded"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/views/ui/alert-dialog"
import { Button } from "@/views/ui/button"

const isNotFound = Schema.is(PromotionNotFound)
const isRefused = Schema.is(PromotionRefused)
const isUnavailable = Schema.is(PromotionUnavailable)

// Why releasing didn't happen, in words.
const problemOf = (cause: Cause.Cause<unknown>) => {
  const error = Option.getOrUndefined(Cause.findErrorOption(cause))
  if (isNotFound(error)) {
    return "It isn't waiting to be released any more; the list shows where it stands."
  }
  if (isRefused(error)) {
    return error.reason
  }
  if (isUnavailable(error)) {
    return "App Store Connect didn't answer, so nothing changed. Try again in a moment."
  }
  return failureText(cause)
}

/**
 * Releasing a version App Store review approved, after asking: what happens (it goes live, over 7
 * days when phased), and why it didn't, said above the buttons. The dialog closes when the page
 * says so, such as once it was released.
 */
export function ReleaseNowDialog({
  promotion,
  open,
  onOpenChange,
  releasing,
  onRelease,
}: {
  readonly promotion: Promotion
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  /** The last release's answer. */
  readonly releasing: AsyncResult.AsyncResult<Promotion, unknown>
  readonly onRelease: () => void
}) {
  const phased = promotion.submission?.phased === true
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia>
            <RocketIcon />
          </AlertDialogMedia>
          <AlertDialogTitle>Release {promotion.release} on the App Store now?</AlertDialogTitle>
          <AlertDialogDescription>
            App Store review approved it. App Store Connect makes it live
            {phased ? ", to everyone over 7 days" : " for everyone"}, and the promotion ends once it is.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {AsyncResult.isFailure(releasing) && !releasing.waiting && (
          <p role="alert" className="text-sm text-failure">
            {problemOf(releasing.cause)}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Not yet</AlertDialogCancel>
          <Button disabled={releasing.waiting} onClick={onRelease}>
            {releasing.waiting ? "Releasing…" : "Release now"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
