import type { EnvironmentKey, ReleaseVersion } from "@cluenori/foundation"
import type { DeployTarget } from "@cluenori/projects"
import type { AppStoreReleaseType, AppStoreSubmission, Promotion, ReleaseNote, Runner } from "@cluenori/releases"
import {
  PromotionInProgress,
  PromotionReason,
  PromotionRefused,
  PromotionUnavailable,
  ReleaseCommit,
} from "@cluenori/releases"
import { Cause, DateTime, Option, Result, Schema } from "effect"
import { AsyncResult } from "effect/reactivity"
import { ArrowUpRightIcon, ChevronRightIcon } from "lucide-react"
import type { ReactNode } from "react"
import { useId, useState } from "react"

import { moment } from "@/lib/format"
import type { ThereNow } from "@/release-facts"
import { Link } from "@/router"
import { failureText } from "@/views/loaded"
import { Segmented } from "@/views/segmented"
import { Button } from "@/views/ui/button"
import { Checkbox } from "@/views/ui/checkbox"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/views/ui/collapsible"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/views/ui/dialog"
import { Input } from "@/views/ui/input"
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
  onOpenVersions,
}: {
  readonly cause: Cause.Cause<unknown>
  readonly owner: boolean
  readonly onOpenNotes: (() => void) | undefined
  readonly onChangeLinks: (() => void) | undefined
  readonly onOpenVersions: (() => void) | undefined
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
        {error.fix === "notes" && onOpenNotes !== undefined && (
          <Button type="button" variant="outline" size="sm" onClick={onOpenNotes}>
            Write the notes
          </Button>
        )}
        {error.fix === "version" && onOpenVersions !== undefined && (
          <Button type="button" variant="outline" size="sm" onClick={onOpenVersions}>
            Set the version
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
  /** The release's notes; absent while they aren't known yet. */
  readonly notes: ReadonlyArray<ReleaseNote> | undefined
  readonly onOpenNotes: () => void
}) {
  const review = target.appStore?.distribution === "appStore"
  return (
    <section aria-label={review ? "What's New" : "What to Test"} className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm">{review ? "What's New" : "What to Test"}, from the release&apos;s notes</span>
        {notes !== undefined && (
          <Button type="button" variant="link" size="sm" className="h-auto px-0" onClick={onOpenNotes}>
            {notes.length === 0 ? "Write the notes" : "Edit the notes"}
          </Button>
        )}
      </div>
      {notes === undefined && <p className="text-muted-foreground">Reading the release&apos;s notes…</p>}
      {notes !== undefined && notes.length === 0 && (
        <p className={review ? "text-failure" : "text-muted-foreground"}>
          {review
            ? "No notes yet: App Store review needs What's New in each of the app's languages."
            : "No notes yet: TestFlight shows none."}
        </p>
      )}
      {notes !== undefined && notes.length > 0 && (
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
 * What promoting to a deploy target does, step by step: its workflow on GitHub, with the release
 * and environment as inputs; then App Store Connect, TestFlight or App Store review.
 */
function TargetSteps({
  target,
  repository,
  release,
}: {
  readonly target: DeployTarget
  readonly repository: string | undefined
  /** The release, as the steps name it: "release 1.4.0+58", or "the new release" for one not numbered yet. */
  readonly release: ReactNode
}) {
  const { environment, workflow, appStore } = target
  return (
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
          on GitHub, with {release} and environment{" "}
          <span className="font-mono whitespace-nowrap text-foreground">{environment}</span>.
        </li>
      )}
      {appStore !== undefined && (
        <li>
          {workflow === undefined ? "Waits for" : "Then waits for"} App Store Connect to process its build of{" "}
          <span className="font-mono text-foreground">{appStore.bundleId}</span>
          {appStore.distribution === "appStore"
            ? ", and submits it to App Store review with the notes as What's New."
            : ", and gives it to TestFlight with the notes as What to Test."}
        </li>
      )}
    </ol>
  )
}

/**
 * What a promotion replaces where it goes: the release there now and since when, or that nothing
 * runs there yet; or that the release itself runs there, so it is deployed again.
 */
function Replaces({
  release,
  environment,
  thereNow,
}: {
  readonly release: ReleaseVersion
  readonly environment: EnvironmentKey
  readonly thereNow: ThereNow
}) {
  switch (thereNow._tag) {
    case "nothing":
      return <p>Nothing runs in {environment} yet.</p>
    case "release": {
      const since = moment(DateTime.toEpochMillis(thereNow.since))
      return thereNow.release === release ? (
        <p className="text-foreground">
          It runs in {environment} now, since <span className="font-mono whitespace-nowrap">{since}</span>: this deploys
          it again.
        </p>
      ) : (
        <p className="text-foreground">
          {environment} runs <span className="font-mono whitespace-nowrap">{thereNow.release}</span> now, since{" "}
          <span className="font-mono whitespace-nowrap">{since}</span>: this replaces it.
        </p>
      )
    }
  }
}

/** Where a workflow runs: Auto, your Mac, or the cloud, with what the choice means. */
function RunnerField({ runner, onChange }: { readonly runner: Runner; readonly onChange: (runner: Runner) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm">Where the workflow runs</span>
      <Segmented label="Where the workflow runs" options={runners} value={runner} onChange={onChange} />
      <p className="text-muted-foreground">{runnerWords[runner]}</p>
    </div>
  )
}

/**
 * What a promotion is asked with beyond the usual, folded away and closed at first: where the
 * workflow runs, Auto unless chosen otherwise, with what each choice means. A choice other than Auto
 * is said on the fold while it is closed.
 */
function Options({ runner, onRunner }: { readonly runner: Runner; readonly onRunner: (runner: Runner) => void }) {
  const chosen = runners.find((each) => each.value === runner)?.label
  return (
    <Collapsible className="flex flex-col gap-3">
      <CollapsibleTrigger
        render={<Button type="button" variant="ghost" size="sm" className="-ml-2.5 w-fit px-2.5 text-sm" />}
      >
        <ChevronRightIcon
          data-icon="inline-start"
          className="transition-transform duration-150 ease-out group-data-[panel-open]/button:rotate-90 motion-reduce:transition-none"
        />
        Options
        {runner !== "auto" && <span className="font-normal text-muted-foreground">The workflow runs on {chosen}</span>}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <RunnerField runner={runner} onChange={onRunner} />
      </CollapsibleContent>
    </Collapsible>
  )
}

/** For App Store review: when an approved version goes live, and whether over 7 days. */
function ReviewOptions({
  id,
  releaseType,
  onReleaseType,
  phased,
  onPhased,
}: {
  readonly id: string
  readonly releaseType: AppStoreReleaseType
  readonly onReleaseType: (releaseType: AppStoreReleaseType) => void
  readonly phased: boolean
  readonly onPhased: (phased: boolean) => void
}) {
  return (
    <div className="flex flex-col gap-3">
      <span className="text-sm">Once App Store review approves it</span>
      <Segmented
        label="Once App Store review approves it"
        options={releaseTypes}
        value={releaseType}
        onChange={onReleaseType}
        className="self-start"
      />
      <label htmlFor={`${id}-phased`} className="flex items-center gap-2.5 text-[15px]">
        <Checkbox id={`${id}-phased`} checked={phased} onCheckedChange={(checked) => onPhased(checked)} />
        Phased over 7 days
      </label>
    </div>
  )
}

/** Why it is promoted, optional, and the rule it breaks once a promotion was tried. */
function ReasonField({
  id,
  reason,
  onChange,
  rule,
}: {
  readonly id: string
  readonly reason: string
  readonly onChange: (reason: string) => void
  readonly rule: string | undefined
}) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={`${id}-reason`} className="text-sm">
        Reason
      </label>
      <Textarea
        id={`${id}-reason`}
        value={reason}
        onChange={(event) => onChange(event.target.value)}
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
  )
}

// A reason as typed: none when empty, else the value the API's rule reads, or the rule it breaks.
const reasonOf = (text: string) => {
  const trimmed = text.trim()
  return trimmed === "" ? undefined : decodeReason(trimmed)
}

/**
 * Promoting a release to an environment, as a confirmation in a dialog: what happens there, step by
 * step (its workflow on GitHub, then App Store Connect: TestFlight, or App Store review with the
 * notes as What's New); for App Store review, when an approved version goes live and whether over 7
 * days; the notes it sends; an optional reason, checked as the API checks it; and, folded away,
 * where the workflow runs. Above them, what runs there now, which it replaces. Promoting calls `onPromote`; while
 * it asks, the button says so, and why it didn't start is said above the buttons, with where to fix
 * it. The dialog closes when the page says so, such as once the promotion started.
 */
export function PromoteDialog({
  release,
  target,
  thereNow,
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
  /** What runs where it goes now, which it replaces; absent while that isn't known. */
  readonly thereNow?: ThereNow | undefined
  /** The component's repository, where the workflow runs, as the release's answer names it; absent when it doesn't. */
  readonly repository: string | undefined
  /** The release's notes, which an App Store Connect app's build is sent with; absent while they aren't known. */
  readonly notes: ReadonlyArray<ReleaseNote> | undefined
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
          <DialogDescription render={<div />} className="flex flex-col gap-3 text-[15px]">
            <TargetSteps
              target={target}
              repository={repository}
              release={
                <>
                  release <span className="font-mono whitespace-nowrap text-foreground">{release}</span>
                </>
              }
            />
            {thereNow !== undefined && <Replaces release={release} environment={environment} thereNow={thereNow} />}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault()
            const decoded = reasonOf(reason)
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
          {review && (
            <ReviewOptions
              id={id}
              releaseType={releaseType}
              onReleaseType={setReleaseType}
              phased={phased}
              onPhased={setPhased}
            />
          )}
          {appStore !== undefined && <NotesSent target={target} notes={notes} onOpenNotes={onOpenNotes} />}
          <ReasonField id={id} reason={reason} onChange={setReason} rule={rule} />
          {workflow !== undefined && <Options runner={runner} onRunner={setRunner} />}
          {AsyncResult.isFailure(promoting) && !promoting.waiting && (
            <Problem
              cause={promoting.cause}
              owner={owner}
              onOpenNotes={onOpenNotes}
              onChangeLinks={onChangeLinks}
              onOpenVersions={undefined}
            />
          )}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button type="submit" disabled={promoting.waiting} className="h-auto min-h-9 py-1.5 whitespace-normal">
              {promoting.waiting ? `Promoting ${release} to ${environment}…` : `Promote ${release} to ${environment}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// A commit typed in is checked by the API's rule for a full SHA.
const decodeCommit = Schema.decodeResult(ReleaseCommit.fields.sha)

/** What promoting a component's newest commit is asked with: where, which commit, why, how. */
export type PromoteLatestWith = PromoteWith & {
  readonly environment: EnvironmentKey
  readonly commit?: ReleaseCommit["sha"]
}

/**
 * Building a component's commit that has no release yet, and promoting it, as a dialog: the
 * environment, among its deploy targets with a workflow, which builds it, `environment` at first;
 * what happens there, step by step; which commit, the newest on the repository's default branch
 * unless one is named; for App Store review, its options; an optional reason; and, folded away,
 * where the workflow runs. Cluenori numbers the commit as the component's next release, then promotes it.
 * Promoting calls `onPromote`; why it didn't start is said above the buttons, with where to fix it,
 * such as the component's version.
 */
export function PromoteLatestDialog({
  component,
  environment: initial,
  targets,
  repository,
  nextRelease,
  owner,
  open,
  onOpenChange,
  promoting,
  onPromote,
  onOpenVersions,
  onChangeLinks,
}: {
  readonly component: string
  /** The environment it is built for at first; the first target's without one. */
  readonly environment?: EnvironmentKey
  /** The component's deploy targets that have a workflow, which builds the commit. */
  readonly targets: ReadonlyArray<DeployTarget>
  readonly repository: string | undefined
  /** The release the commit will be, when the component's version is known. */
  readonly nextRelease: string | undefined
  readonly owner: boolean
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  /** The last promotion's answer. */
  readonly promoting: AsyncResult.AsyncResult<Promotion, unknown>
  readonly onPromote: (input: PromoteLatestWith) => void
  /** Closes the dialog for the versions, where the component's version is set. */
  readonly onOpenVersions: () => void
  readonly onChangeLinks?: () => void
}) {
  const id = useId()
  const [environment, setEnvironment] = useState(
    targets.find((each) => each.environment === initial)?.environment ?? targets[0]?.environment,
  )
  const [commit, setCommit] = useState("")
  const [commitRule, setCommitRule] = useState<string | undefined>(undefined)
  const [reason, setReason] = useState("")
  const [rule, setRule] = useState<string | undefined>(undefined)
  const [runner, setRunner] = useState<Runner>("auto")
  const [releaseType, setReleaseType] = useState<AppStoreReleaseType>("afterApproval")
  const [phased, setPhased] = useState(true)
  const target = targets.find((each) => each.environment === environment)
  const review = target?.appStore?.distribution === "appStore"
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="leading-snug">Build {component}&apos;s latest commit?</DialogTitle>
          <DialogDescription>
            Cluenori numbers it as {component}&apos;s next release
            {nextRelease === undefined ? "" : ", "}
            {nextRelease !== undefined && <span className="font-mono text-foreground">{nextRelease}</span>}, then
            promotes it there. A commit numbered before is that release again.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault()
            const decoded = reasonOf(reason)
            setRule(decoded !== undefined && Result.isFailure(decoded) ? decoded.failure.message : undefined)
            const typedCommit = commit.trim()
            const decodedCommit = typedCommit === "" ? undefined : decodeCommit(typedCommit)
            setCommitRule(
              decodedCommit !== undefined && Result.isFailure(decodedCommit)
                ? decodedCommit.failure.message
                : undefined,
            )
            if (
              target === undefined ||
              (decoded !== undefined && Result.isFailure(decoded)) ||
              (decodedCommit !== undefined && Result.isFailure(decodedCommit))
            ) {
              return
            }
            onPromote({
              environment: target.environment,
              ...(decodedCommit === undefined ? {} : { commit: decodedCommit.success }),
              ...(decoded === undefined ? {} : { reason: decoded.success }),
              runner,
              ...(review ? { submission: { releaseType, phased } } : {}),
            })
          }}
        >
          <div className="flex flex-col gap-2">
            <span className="text-sm">Environment</span>
            {environment !== undefined && (
              <Segmented
                label="Environment"
                options={targets.map((each) => ({ value: each.environment, label: each.environment }))}
                value={environment}
                onChange={setEnvironment}
                className="self-start"
              />
            )}
          </div>
          {target !== undefined && (
            <div className="text-[15px] text-muted-foreground">
              <TargetSteps target={target} repository={repository} release="the new release" />
            </div>
          )}
          <div className="flex flex-col gap-2">
            <label htmlFor={`${id}-commit`} className="text-sm">
              Commit
            </label>
            <Input
              id={`${id}-commit`}
              value={commit}
              onChange={(event) => setCommit(event.target.value)}
              placeholder="The newest"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={commitRule !== undefined}
              aria-describedby={`${id}-commit-help`}
              className="h-9 font-mono"
            />
            <p id={`${id}-commit-help`} className={commitRule === undefined ? "text-muted-foreground" : "text-failure"}>
              {commitRule ?? "Optional: a commit's full SHA. Without it, the newest on the default branch."}
            </p>
          </div>
          {review && (
            <ReviewOptions
              id={id}
              releaseType={releaseType}
              onReleaseType={setReleaseType}
              phased={phased}
              onPhased={setPhased}
            />
          )}
          <ReasonField id={id} reason={reason} onChange={setReason} rule={rule} />
          <Options runner={runner} onRunner={setRunner} />
          {AsyncResult.isFailure(promoting) && !promoting.waiting && (
            <Problem
              cause={promoting.cause}
              owner={owner}
              onOpenNotes={undefined}
              onChangeLinks={onChangeLinks}
              onOpenVersions={onOpenVersions}
            />
          )}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button type="submit" disabled={promoting.waiting || target === undefined}>
              {promoting.waiting ? "Building and promoting…" : `Build and promote to ${target?.environment ?? "it"}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
