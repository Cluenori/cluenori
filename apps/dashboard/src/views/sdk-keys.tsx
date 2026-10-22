import type { ComponentKey } from "@cluenori/foundation"
import type { IssuedSdkKey, SdkKey } from "@cluenori/projects"
import { DateTime } from "effect"
import { ChevronRightIcon, KeyRoundIcon } from "lucide-react"
import { useState } from "react"

import { count, moment } from "@/lib/format"
import { CopyButton } from "@/views/copy-button"
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
import { Button } from "@/views/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/views/ui/collapsible"

/** Revoking a key, after asking: builds that carry it are refused from then on. */
function Revoke({
  component,
  sdkKey,
  last,
  onRevoke,
}: {
  readonly component: ComponentKey
  readonly sdkKey: SdkKey
  /** Whether it is the component's only active key, so every build would be refused. */
  readonly last: boolean
  readonly onRevoke: (key: SdkKey) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={<Button variant="ghost" size="sm" />}>
        Revoke<span className="sr-only"> the key ending {sdkKey.slice(-6)}</span>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-destructive/10 text-destructive">
            <KeyRoundIcon />
          </AlertDialogMedia>
          <AlertDialogTitle>Revoke this SDK key?</AlertDialogTitle>
          <AlertDialogDescription>
            {last
              ? `It is ${component}'s only active key: every build of it is refused from then on, and sends nothing until a build with a new key ships. Issue the new key and ship it first.`
              : `Builds of ${component} that carry it are refused from then on, and send nothing until they are updated. Ship a build with another key first.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <p className="font-mono text-sm break-all">{sdkKey}</p>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <Button
            variant="destructive"
            onClick={() => {
              setOpen(false)
              onRevoke(sdkKey)
            }}
          >
            Revoke
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/**
 * A component's SDK keys, the keys its app's builds carry: each active one in full, with a button
 * that copies it and one that revokes it after asking; issuing another, which appears first, marked
 * new; and the revoked ones folded under a line that opens them. Keys are public, as anything an app
 * ships is, so they are shown whole. What failed is said under them.
 */
export function SdkKeys({
  component,
  keys,
  issuing,
  justIssued,
  problem,
  onIssue,
  onRevoke,
}: {
  readonly component: ComponentKey
  /** Its keys, the newest first, revoked ones too. */
  readonly keys: ReadonlyArray<IssuedSdkKey>
  /** Whether a new key is being issued. */
  readonly issuing: boolean
  /** The key issued here last, marked new. */
  readonly justIssued?: SdkKey
  /** Why the last issue or revoke failed, in words. */
  readonly problem?: string
  readonly onIssue: () => void
  readonly onRevoke: (key: SdkKey) => void
}) {
  const active = keys.filter((each) => each.revokedAt === undefined)
  const revoked = keys.filter((each) => each.revokedAt !== undefined)
  const issueWords = active.length === 0 ? "Issue an SDK key" : "Issue a new key"
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {active.length === 0 ? (
        <p className="text-[15px] text-muted-foreground">
          {revoked.length === 0
            ? "No SDK key yet. Issue one, give it to the app's Cluenori.start, and its builds can send."
            : "No active SDK key: every build is refused. Issue one, and ship a build with it."}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {active.map((each) => (
            <li key={each.key} className="flex flex-col gap-2 border bg-background/40 px-3 py-2.5">
              <code className="font-mono text-sm break-all">{each.key}</code>
              <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="text-sm text-muted-foreground">
                  {each.key === justIssued && <span className="mr-2 text-mint-ink">New</span>}
                  Issued <span className="font-mono">{moment(DateTime.toEpochMillis(each.issuedAt))}</span>
                </span>
                <span className="ml-auto flex gap-2">
                  <CopyButton text={each.key} label="Copy" name={`the key ending ${each.key.slice(-6)}`} />
                  <Revoke component={component} sdkKey={each.key} last={active.length === 1} onRevoke={onRevoke} />
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <span className="flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" disabled={issuing} onClick={onIssue}>
          {issuing ? "Issuing…" : issueWords}
          <span className="sr-only"> for {component}</span>
        </Button>
        {active.length > 0 && (
          <span className="text-sm text-muted-foreground">Older keys keep working until revoked.</span>
        )}
      </span>
      {problem !== undefined && (
        <p role="alert" className="text-sm text-failure">
          {problem}
        </p>
      )}
      {revoked.length > 0 && (
        <Collapsible>
          <CollapsibleTrigger className="group flex items-center gap-1.5 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground focus-visible:underline">
            <ChevronRightIcon aria-hidden className="size-4 transition-transform group-data-[panel-open]:rotate-90" />
            {revoked.length === 1 ? "1 revoked key" : `${count(revoked.length)} revoked keys`}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="mt-2 flex flex-col gap-1.5">
              {revoked.map((each) => (
                <li key={each.key} className="flex flex-col text-sm text-muted-foreground">
                  <code className="font-mono break-all">{each.key}</code>
                  <span>
                    Revoked{" "}
                    <span className="font-mono">
                      {each.revokedAt === undefined ? "" : moment(DateTime.toEpochMillis(each.revokedAt))}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  )
}
