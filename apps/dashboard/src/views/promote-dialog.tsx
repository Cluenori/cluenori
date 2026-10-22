import type { ReleaseVersion } from "@cluenori/foundation"
import type { DeployTarget } from "@cluenori/projects"
import type { AppStoreReleaseType, AppStoreSubmission, Promotion, ReleaseNote, Runner } from "@cluenori/releases"
import { PromotionInProgress, PromotionReason, PromotionRefused, PromotionUnavailable } from "@cluenori/releases"
import { Cause, Option, Result, Schema } from "effect"
import { AsyncResult } from "effect/reactivity"
import { ArrowUpRightIcon } from "lucide-react"
import { useId, useState } from "react"

import { Link } from "@/router"
import { failureText } from "@/views/loaded"
import { Segmented } from "@/views/segmented"
import { Button } from "@/views/ui/button"
import { Checkbox } from "@/views/ui/checkbox"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/views/ui/dialog"
import { Textarea } from "@/views/ui/textarea"

// A reason is checked by the API's own rule, after the space around it is dropped.
const decodeReason = Schema.decodeResult(PromotionReason)
const reasonLength = 500

const isRefused = Schema.is(PromotionRefused)
const isInProgress = Schema.is(PromotionInProgress)
const isUnavailable = Schema.is(PromotionUnavailable)

// The API's reasons are clauses; said alone, each ends as a sentence.
const sentence = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`)

const runners: ReadonlyArray<{ readonly value: Runner; readonly label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "local", label: "Your Mac" },
  { value: "cloud", label: "Cloud" },
]

const runnerWords: Readonly<Record<Runner, string>> = {
  auto: "Your Mac when it's online, else the cloud.",
  local: "Your Mac, the self-hosted runner labelled local; it waits there until the Mac is online.",
  cloud: "The cloud runner the repository chose.",
}

const releaseTypes: ReadonlyArray<{ readonly value: AppStoreReleaseType; readonly label: string }> = [
  { value: "afterApproval", label: "Release when approved" },
  { value: "manual", label: "Release manually" },
]

/** What a promotion that went ahead is asked with: why, where its workflow runs, how it is submitted. */
export type PromoteWith = {
  readonly reason?: PromotionReason
  readonly runner?: Runner
  readonly submission?: AppStoreSubmission
}

/** Why the last promotion didn't start, in words, with where it is fixed: the API's own reason when it gave one. */
function Problem({
  cause,
  owner,
  onOpenNotes,
  onChangeLinks,
}: {
  readonly cause: Cause.Cause<unknown>
  readonly owner: boolean
  readonly onOpenNotes: () => void
  readonly onChangeLinks: (() => void) | undefined
}) {
  const error = Option.getOrUndefined(Cause.findErrorOption(cause))
  if (isRefused(error)) {
    return (
      <div role="alert" className="flex flex-col items-start gap-2 text-sm text-failure">
        <p>{sentence(error.reason)}</p>
        {/* Connecting or installing the app is done on the GitHub page, which only an owner can. */}
        {error.fix === "github" && owner && (
          <Link to={{ page: "github" }} className="text-foreground underline underline-offset-4">
            Open the GitHub page
          </Link>
        )}
        {error.fix === "notes" && (
          <Button type="button" variant="outline" size="sm" onClick={onOpenNotes}>
            Write the notes
          </Button>
        )}
        {error.fix === "links" && onChangeLinks !== undefined && (
          <Button type="button" variant="outline" size="sm" onClick={onChangeLinks}>
            Change links
          </Button>
        )}
        {/* Only an owner gives the deployment a key; a member is told what it says. */}
        {error.fix === "appStore" && owner && (
          <p className="text-foreground">
            Give Cluenori an App Store Connect key with the App Manager role, from Cluenori&apos;s folder:{" "}
            <code className="font-mono text-[13px] break-all">
              ./cluenori appstore setup &lt;key.p8&gt; --issuer &lt;issuer ID&gt; --manager
            </code>
          </p>
        )}
      </div>
    )
  }
  if (isInProgress(error)) {
    const { promotion } = error
    return (
      <p role="alert" className="text-sm text-failure">
        Already promoting <span className="font-mono">{promotion.release}</span> to {promotion.environment}. Promote
        again once it has ended.{" "}
        {promotion.run !== undefined && (
          <a
            href={promotion.run.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-foreground underline underline-offset-4"
          >
            Its run on GitHub
            <ArrowUpRightIcon aria-hidden className="size-3.5" />
          </a>
        )}
      </p>
    )
  }
  if (isUnavailable(error)) {
    return (
      <p role="alert" className="text-sm text-failure">
        GitHub didn&apos;t answer, so nothing started. Try again in a moment.
      </p>
    )
  }
  return (
    <p role="alert" className="text-sm text-failure">
      {failureText(cause)}
    </p>
  )
}

/**
 * The release's notes as a promotion to an App Store Connect app sends them: What to Test in
 * TestFlight, What's New for App Store review, which needs them; each language's text, or that there
 * are none, one click from the notes editor.
 */
function NotesSent({
  target,
  notes,
  onOpenNotes,
}: {
  readonly target: DeployTarget
  readonly notes: ReadonlyArray<ReleaseNote>
  readonly onOpenNotes: () => void
}) {
  const review = target.appStore?.distribution === "appStore"
  return (
    <section aria-label={review ? "What's New" : "What to Test"} className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm">{review ? "What's New" : "What to Test"}, from the release&apos;s notes</span>
        <Button type="button" variant="link" size="sm" className="h-auto px-0" onClick={onOpenNotes}>
          {notes.length === 0 ? "Write the notes" : "Edit the notes"}
        </Button>
      </div>
      {notes.length === 0 ? (
        <p className={review ? "text-failure" : "text-muted-foreground"}>
          {review
            ? "No notes yet: App Store review needs What's New in each of the app's languages."
            : "No notes yet: TestFlight shows none."}
        </p>
      ) : (
        <ul className="flex max-h-40 flex-col gap-2 overflow-y-auto border bg-background px-3 py-2.5">
          {notes.map((note) => (
            <li key={note.locale} className="flex flex-col gap-0.5">
              <span className="font-mono text-[13px] text-muted-foreground">{note.locale}</span>
              <span className="text-[15px] whitespace-pre-line">{note.text}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * Promoting a release to an environment, as a confirmation in a dialog: what happens there, step by
 * step (its workflow on GitHub, then App Store Connect: TestFlight, or App Store review with the
 * notes as What's New); where the workflow runs; for App Store review, when an approved version goes
 * live and whether over 7 days; the notes it sends; and an optional reason, checked as the API
 * checks it. Promoting calls `onPromote`; while it asks, the button says so, and why it didn't start
 * is said above the buttons, with where to fix it. The dialog closes when the page says so, such as
 * once the promotion started.
 */
export function PromoteDialog({
  release,
  target,
  repository,
  notes,
  owner,
  open,
  onOpenChange,
  promoting,
  onPromote,
  onOpenNotes,
  onChangeLinks,
}: {
  readonly release: ReleaseVersion
  readonly target: DeployTarget
  /** The component's repository, where the workflow runs, as the release's answer names it; absent when it doesn't. */
  readonly repository: string | undefined
  /** The release's notes, which an App Store Connect app's build is sent with. */
  readonly notes: ReadonlyArray<ReleaseNote>
  /** Whether who is signed in is an owner, who can fix GitHub's connection and App Store Connect's key. */
  readonly owner: boolean
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  /** The last promotion's answer. */
  readonly promoting: AsyncResult.AsyncResult<Promotion, unknown>
  readonly onPromote: (input: PromoteWith) => void
  /** Closes the dialog for the release's notes editor. */
  readonly onOpenNotes: () => void
  /** Opens the component's links, where its deploy target is changed; absent where the page can't. */
  readonly onChangeLinks?: () => void
}) {
  const id = useId()
  const [reason, setReason] = useState("")
  const [rule, setRule] = useState<string | undefined>(undefined)
  const [runner, setRunner] = useState<Runner>("auto")
  const [releaseType, setReleaseType] = useState<AppStoreReleaseType>("afterApproval")
  const [phased, setPhased] = useState(true)
  const review = target.appStore?.distribution === "appStore"
  const { environment, workflow, appStore } = target
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="leading-snug">
            Promote <span className="font-mono">{release}</span> to {environment}?
          </DialogTitle>
          <DialogDescription render={<div />} className="text-[15px]">
            <ol className="flex list-decimal flex-col gap-1 pl-5 marker:text-muted-foreground">
              {workflow !== undefined && (
                <li>
                  Runs <span className="font-mono whitespace-nowrap text-foreground">{workflow}</span>
                  {repository !== undefined && (
                    <>
                      {" "}
                      in <span className="font-mono text-foreground">{repository}</span>
                    </>
                  )}{" "}
                  on GitHub, with release <span className="font-mono whitespace-nowrap text-foreground">{release}</span>{" "}
                  and environment <span className="font-mono whitespace-nowrap text-foreground">{environment}</span>.
                </li>
              )}
              {appStore !== undefined && (
                <li>
                  {workflow === undefined ? "Waits for" : "Then waits for"} App Store Connect to process its build of{" "}
                  <span className="font-mono text-foreground">{appStore.bundleId}</span>
                  {review
                    ? ", and submits it to App Store review with the notes as What's New."
                    : ", and gives it to TestFlight with the notes as What to Test."}
                </li>
              )}
            </ol>
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault()
            const trimmed = reason.trim()
            const decoded = trimmed === "" ? undefined : decodeReason(trimmed)
            setRule(decoded !== undefined && Result.isFailure(decoded) ? decoded.failure.message : undefined)
            if (decoded !== undefined && Result.isFailure(decoded)) {
              return
            }
            onPromote({
              ...(decoded === undefined ? {} : { reason: decoded.success }),
              ...(workflow === undefined ? {} : { runner }),
              ...(review ? { submission: { releaseType, phased } } : {}),
            })
          }}
        >
          {workflow !== undefined && (
            <div className="flex flex-col gap-2">
              <span className="text-sm">Where the workflow runs</span>
              <Segmented label="Where the workflow runs" options={runners} value={runner} onChange={setRunner} />
              <p className="text-muted-foreground">{runnerWords[runner]}</p>
            </div>
          )}
          {review && (
            <div className="flex flex-col gap-3">
              <span className="text-sm">Once App Store review approves it</span>
              <Segmented
                label="Once App Store review approves it"
                options={releaseTypes}
                value={releaseType}
                onChange={setReleaseType}
                className="self-start"
              />
              <label htmlFor={`${id}-phased`} className="flex items-center gap-2.5 text-[15px]">
                <Checkbox id={`${id}-phased`} checked={phased} onCheckedChange={(checked) => setPhased(checked)} />
                Phased over 7 days
              </label>
            </div>
          )}
          {appStore !== undefined && <NotesSent target={target} notes={notes} onOpenNotes={onOpenNotes} />}
          <div className="flex flex-col gap-2">
            <label htmlFor={`${id}-reason`} className="text-sm">
              Reason
            </label>
            <Textarea
              id={`${id}-reason`}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={reasonLength}
              rows={2}
              aria-invalid={rule !== undefined}
              aria-describedby={`${id}-reason-help`}
              className="text-[15px]"
            />
            <p id={`${id}-reason-help`} className={rule === undefined ? "text-muted-foreground" : "text-failure"}>
              {rule ?? `Optional, up to ${reasonLength} characters; it is kept with the promotion.`}
            </p>
          </div>
          {AsyncResult.isFailure(promoting) && !promoting.waiting && (
            <Problem cause={promoting.cause} owner={owner} onOpenNotes={onOpenNotes} onChangeLinks={onChangeLinks} />
          )}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button type="submit" disabled={promoting.waiting}>
              {promoting.waiting ? "Promoting…" : "Promote"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
