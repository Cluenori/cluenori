import { NotAllowed } from "@cluenori/foundation"
import type { GitHubAppForm, GitHubAppSummary, GitHubInstallation, GitHubStatus } from "@cluenori/github"
import { GitHubAccount } from "@cluenori/github"
import { useAtom, useAtomValue } from "@effect/atom-react"
import { cn } from "cn"
import { Cause, DateTime, Option, Result, Schema } from "effect"
import { Atom, AsyncResult } from "effect/reactivity"
import { ArrowUpRightIcon, FolderGit2Icon, GitBranchIcon, LockIcon, UnplugIcon } from "lucide-react"
import { useEffect, useId, useState } from "react"

import { moment } from "@/lib/format"
import { connectGitHubAtom, disconnectGitHubAtom, gitHubAtom } from "@/project-data"
import type { GitHubReturn } from "@/router"
import { navigate } from "@/router"
import { failureText, Loaded } from "@/views/loaded"
import { Panel } from "@/views/panel"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/views/ui/alert-dialog"
import { Button, buttonVariants } from "@/views/ui/button"
import { Input } from "@/views/ui/input"

// An organization typed in is checked by the API's own rule for a login, so a refusal says it.
const decodeAccount = Schema.decodeResult(GitHubAccount)

// What GitHub sent the browser back with, in words: a title, what it means, and whether it failed.
const returnedWords = (
  returned: GitHubReturn,
): { readonly title: string; readonly text: string; readonly failed: boolean } => {
  switch (returned._tag) {
    case "connected":
      return {
        title: "Connected to GitHub",
        text: "Now install the app on the accounts whose repositories your components link.",
        failed: false,
      }
    case "installed":
      return {
        title: "Installed on GitHub",
        text: "The accounts it reaches are below, with the repositories chosen on each.",
        failed: false,
      }
    case "requested":
      return {
        title: "Waiting for the organization's approval",
        text: "GitHub asked the organization's owners to approve the app. It shows below once one does.",
        failed: false,
      }
    case "problem":
      return { title: "Connecting GitHub didn't finish", text: returned.problem, failed: true }
  }
}

/** What GitHub sent the browser back with: a note above the page, red when connecting didn't finish. */
function ReturnedNote({ returned }: { readonly returned: GitHubReturn }) {
  const words = returnedWords(returned)
  return (
    <div
      role={words.failed ? "alert" : "status"}
      className="grid grid-cols-[0.625rem_minmax(0,1fr)] items-baseline gap-x-4 border bg-card px-5 py-4"
    >
      <span aria-hidden className={cn("size-2.5", words.failed ? "bg-failure" : "bg-mint")} />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[15px] font-medium">{words.title}</span>
        <span className="text-sm wrap-anywhere text-muted-foreground">{words.text}</span>
      </span>
    </div>
  )
}

/**
 * Posts the form GitHub creates the app from, as soon as it is shown: the browser leaves for
 * GitHub. Marked once posted, so showing it twice, as React's development checks do, posts it once.
 */
function ToGitHub({ form }: { readonly form: GitHubAppForm }) {
  return (
    <form
      method="post"
      action={form.action}
      hidden
      ref={(node) => {
        if (node !== null && node.dataset["posted"] === undefined) {
          node.dataset["posted"] = "true"
          node.requestSubmit()
        }
      }}
    >
      <input type="hidden" name="manifest" value={form.manifest} />
    </form>
  )
}

/**
 * Connecting GitHub: what it does, the organization that will own the app (the owner's own account
 * when none is named), and one button, which asks for GitHub's form and posts it there.
 */
function Connect() {
  const id = useId()
  const [connecting, connect] = useAtom(connectGitHubAtom)
  const [organization, setOrganization] = useState("")
  // The rule is said once connecting was tried, not while the login is being typed.
  const [checked, setChecked] = useState(false)
  const typed = organization.trim()
  const decoded = typed === "" ? undefined : decodeAccount(typed)
  const rule = checked && decoded !== undefined && Result.isFailure(decoded) ? decoded.failure.message : undefined
  const form = AsyncResult.isSuccess(connecting) ? Option.getOrUndefined(connecting.value) : undefined
  const leaving = connecting.waiting || form !== undefined
  return (
    <Panel icon={GitBranchIcon} title="Connect GitHub" subtitle="Cluenori's own GitHub App, made in one step on GitHub">
      <form
        className="flex max-w-2xl flex-col gap-5 px-5 py-6"
        onSubmit={(event) => {
          event.preventDefault()
          setChecked(true)
          if (decoded === undefined) {
            connect({})
          } else if (Result.isSuccess(decoded)) {
            connect({ organization: decoded.success })
          }
        }}
      >
        <p className="text-[15px] text-pretty">
          GitHub creates Cluenori&apos;s own app in one step. Then you install it on the accounts whose repositories
          your components link. It reads their code and pull requests, so each release has its commit and what changed,
          and it starts the workflows that promote a release.
        </p>
        <div className="flex max-w-md flex-col gap-2">
          <label htmlFor={`${id}-organization`} className="text-sm">
            Organization that owns the app
          </label>
          <Input
            id={`${id}-organization`}
            value={organization}
            onChange={(event) => setOrganization(event.target.value)}
            placeholder="octo-org"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={rule !== undefined}
            aria-describedby={`${id}-organization-help`}
            className="h-9 font-mono"
          />
          <p
            id={`${id}-organization-help`}
            className={cn("text-sm", rule === undefined ? "text-muted-foreground" : "text-failure")}
          >
            {rule ?? "Its GitHub login. Leave it empty for the app to be your own account's."}
          </p>
        </div>
        {AsyncResult.isFailure(connecting) && !connecting.waiting && (
          <p role="alert" className="text-sm text-failure">
            {failureText(connecting.cause)}
          </p>
        )}
        <Button type="submit" className="self-start" disabled={leaving}>
          {leaving ? "Opening GitHub…" : "Connect GitHub"}
        </Button>
      </form>
      {form !== undefined && <ToGitHub form={form} />}
    </Panel>
  )
}

/** Disconnecting, after saying what it does and doesn't: the app stays on GitHub. */
function Disconnect({ app }: { readonly app: GitHubAppSummary }) {
  const [open, setOpen] = useState(false)
  const [disconnecting, disconnect] = useAtom(disconnectGitHubAtom)
  return (
    <AlertDialog
      open={open && !AsyncResult.isSuccess(disconnecting)}
      onOpenChange={(next) => {
        // A failure from an earlier try isn't this one's.
        disconnect(Atom.Reset)
        setOpen(next)
      }}
    >
      <AlertDialogTrigger render={<Button variant="outline" size="sm" />}>Disconnect</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-destructive/10 text-destructive">
            <UnplugIcon />
          </AlertDialogMedia>
          <AlertDialogTitle>Disconnect GitHub?</AlertDialogTitle>
          <AlertDialogDescription>
            Cluenori forgets {app.name}, and stops reading code and pull requests and promoting releases through it. The
            app stays on GitHub until its owner deletes it there.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {AsyncResult.isFailure(disconnecting) && !disconnecting.waiting && (
          <p role="alert" className="text-sm text-failure">
            {failureText(disconnecting.cause)}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it connected</AlertDialogCancel>
          <Button variant="destructive" disabled={disconnecting.waiting} onClick={() => disconnect()}>
            {disconnecting.waiting ? "Disconnecting…" : "Disconnect"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

const accountKind: Readonly<Record<GitHubInstallation["accountType"], string>> = {
  Organization: "Organization",
  User: "Personal account",
}

const repositoriesWords: Readonly<Record<GitHubInstallation["repositories"], string>> = {
  all: "All repositories",
  selected: "Chosen repositories",
}

/** An account the app is installed on, one click from changing its repositories on GitHub. */
function InstallationRow({ installation }: { readonly installation: GitHubInstallation }) {
  const row =
    "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-5 py-3.5 sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)_auto]"
  const content = (
    <>
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-mono text-[15px]">{installation.account}</span>
        <span className="text-sm text-muted-foreground">{accountKind[installation.accountType]}</span>
      </span>
      <span className="col-start-1 row-start-2 text-sm sm:col-start-auto sm:row-start-auto sm:text-[15px]">
        {repositoriesWords[installation.repositories]}
      </span>
    </>
  )
  if (installation.url === undefined) {
    return <div className={row}>{content}</div>
  }
  return (
    <a
      href={installation.url}
      target="_blank"
      rel="noreferrer"
      className={cn(row, "outline-none hover:bg-accent/60 focus-visible:bg-accent")}
    >
      {content}
      <span className="col-start-2 row-span-2 row-start-1 flex items-center gap-1.5 text-sm text-muted-foreground sm:col-start-auto sm:row-span-1 sm:row-start-auto">
        Change on GitHub
        <span className="sr-only"> for {installation.account}</span>
        <ArrowUpRightIcon aria-hidden className="size-4" />
      </span>
    </a>
  )
}

/**
 * Cluenori connected: its app, linked to its page on GitHub, and who owns it; where it is installed,
 * each account one click from changing its repositories, and installing it on another; and
 * disconnecting it.
 */
function Connected({ status, app }: { readonly status: GitHubStatus; readonly app: GitHubAppSummary }) {
  return (
    <>
      <Panel
        icon={GitBranchIcon}
        title="GitHub App"
        subtitle={`Connected ${moment(DateTime.toEpochMillis(app.connectedAt))}`}
        action={<Disconnect app={app} />}
      >
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-8 gap-y-2 px-5 py-5 text-[15px]">
          <dt className="text-muted-foreground">App</dt>
          <dd className="min-w-0">
            <a
              href={app.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex max-w-full items-center gap-1 underline-offset-4 hover:underline"
            >
              <span className="truncate">{app.name}</span>
              <span className="sr-only"> on GitHub</span>
              <ArrowUpRightIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            </a>
          </dd>
          <dt className="text-muted-foreground">Owned by</dt>
          <dd className="min-w-0 truncate">
            {app.organization === undefined ? "Your account" : <span className="font-mono">{app.organization}</span>}
          </dd>
        </dl>
      </Panel>

      <Panel
        icon={FolderGit2Icon}
        title="Installed on"
        subtitle="The accounts it reaches, and which of their repositories"
        // Installing goes through GitHub, which sends the browser back here.
        action={
          <a href={app.installUrl} className={buttonVariants({ size: "sm" })}>
            Install on an account
          </a>
        }
      >
        {status.problem !== undefined && (
          <p className="grid grid-cols-[0.625rem_minmax(0,1fr)] items-baseline gap-x-4 border-b px-5 py-3.5 text-sm">
            <span aria-hidden className="size-2.5 bg-yellow" />
            <span className="wrap-anywhere">{status.problem}</span>
          </p>
        )}
        {status.installations.length === 0 ? (
          <div className="flex flex-col gap-1 px-5 py-6">
            <p className="text-[15px]">Not installed on any account yet.</p>
            <p className="text-sm text-muted-foreground">
              Install it on the accounts whose repositories your components link, and choose those repositories.
            </p>
          </div>
        ) : (
          <ul className="divide-y">
            {status.installations.map((installation) => (
              <li key={installation.account}>
                <InstallationRow installation={installation} />
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  )
}

// A member is answered that only an owner may ask.
const isNotAllowed = <A, E>(result: AsyncResult.AsyncResult<A, E>) =>
  AsyncResult.isFailure(result) && Option.exists(Cause.findErrorOption(result.cause), Schema.is(NotAllowed))

/**
 * Cluenori's connection to GitHub, for owners: connecting it, its app and where the app is
 * installed, and disconnecting it. What GitHub sent the browser back with is said once, above, and
 * the address forgets it, so a reload doesn't say it again.
 */
export function GitHubPage({ returned }: { readonly returned?: GitHubReturn }) {
  const status = useAtomValue(gitHubAtom)
  // Kept while the page is open, though the address forgets it.
  const [note] = useState(returned)
  useEffect(() => {
    if (returned !== undefined) {
      navigate({ page: "github" }, { replace: true })
    }
  }, [returned])

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-3 pb-2">
        <div className="flex min-w-0 flex-col">
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">GitHub</h1>
          <p className="text-sm text-muted-foreground">
            Releases&apos; commits and changes, and promoting releases, through Cluenori&apos;s own GitHub App
          </p>
        </div>
      </header>

      {note !== undefined && <ReturnedNote returned={note} />}

      {isNotAllowed(status) ? (
        <Panel icon={LockIcon} title="Owners only" subtitle="Connecting GitHub changes the whole deployment">
          <p className="px-5 py-6 text-[15px]">Only an owner connects GitHub.</p>
        </Panel>
      ) : (
        <Loaded result={status}>
          {(answer) =>
            answer.app === undefined ? (
              <Connect />
            ) : (
              <div className="flex flex-col gap-4">
                <Connected status={answer} app={answer.app} />
              </div>
            )
          }
        </Loaded>
      )}
    </div>
  )
}
