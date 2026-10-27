import type { ComponentKey } from "@cluenori/foundation"
import type { IngestKey, IngestKeyId, IngestKeyInfo } from "@cluenori/projects"
import { DateTime } from "effect"
import { ChevronRightIcon, KeyRoundIcon } from "lucide-react"
import { useState } from "react"

import { warningColor } from "@/lib/colors"
import { ago, count, moment } from "@/lib/format"
import { CopyButton } from "@/views/copy-button"
import { Segmented } from "@/views/segmented"
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
import { Input } from "@/views/ui/input"

const hour = 3_600_000
const day = 24 * hour

/** How long a new key works: until revoked, or this many days. */
export type KeyLife = "never" | "30" | "90" | "365"

const lives: ReadonlyArray<{ readonly value: KeyLife; readonly label: string }> = [
  { value: "never", label: "No expiry" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "1 year" },
]

/** When revoking takes effect: at once, or a day later, so a deploy can swap the key first. */
export type RevokeWhen = "now" | "in24h"

// When a key stops working, if it will: the earlier of its expiry and its revocation.
const endOf = (key: IngestKeyInfo) => {
  const ends = [key.expiresAt, key.revokedAt].flatMap((at) => (at === undefined ? [] : [DateTime.toEpochMillis(at)]))
  return ends.length === 0 ? undefined : Math.min(...ends)
}

/** Revoking a key after asking, at once or in 24 hours; what sends with it is refused from then on. */
function Revoke({
  keyInfo,
  last,
  onRevoke,
}: {
  readonly keyInfo: IngestKeyInfo
  /** Whether it is the component's only working key, so everything it sends would be refused. */
  readonly last: boolean
  readonly onRevoke: (id: IngestKeyId, when: RevokeWhen) => void
}) {
  const [open, setOpen] = useState(false)
  const revoke = (when: RevokeWhen) => {
    setOpen(false)
    onRevoke(keyInfo.id, when)
  }
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={<Button variant="ghost" size="sm" />}>
        Revoke<span className="sr-only"> the key {keyInfo.name}</span>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-destructive/10 text-destructive">
            <KeyRoundIcon />
          </AlertDialogMedia>
          <AlertDialogTitle>Revoke &ldquo;{keyInfo.name}&rdquo;?</AlertDialogTitle>
          <AlertDialogDescription>
            {last
              ? `It is ${keyInfo.component}'s only working key: everything it sends is refused from then on. Add a key and deploy it first.`
              : `What ${keyInfo.component} sends with it is refused from then on. Deploy with another key first, and wait until this one's last use stops moving.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <Button variant="outline" onClick={() => revoke("in24h")}>
            In 24 hours
          </Button>
          <Button variant="destructive" onClick={() => revoke("now")}>
            Revoke now
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** One key that works: its name, when it was made and last used, and when it ends, if it will. */
function WorkingKey({
  keyInfo,
  now,
  last,
  isNew,
  onRevoke,
}: {
  readonly keyInfo: IngestKeyInfo
  readonly now: number
  readonly last: boolean
  readonly isNew: boolean
  readonly onRevoke: (id: IngestKeyId, when: RevokeWhen) => void
}) {
  const end = endOf(keyInfo)
  const soon = end !== undefined && end - now <= 7 * day
  const revoking = keyInfo.revokedAt !== undefined && end === DateTime.toEpochMillis(keyInfo.revokedAt)
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border bg-background/40 px-3 py-2.5">
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="truncate font-mono text-[15px]">{keyInfo.name}</span>
          {isNew && <span className="text-sm text-mint-ink">New</span>}
          {end !== undefined && (
            <span className="text-sm" style={soon ? { color: warningColor } : {}} title={moment(end)}>
              {revoking ? "Revoked" : "Expires"} {ago(end, now)}
            </span>
          )}
        </span>
        <span className="text-sm text-muted-foreground">
          {keyInfo.lastUsedAt === undefined
            ? "Not used yet"
            : `Last used ${ago(DateTime.toEpochMillis(keyInfo.lastUsedAt), now)}`}
          {" · "}added <span className="font-mono">{moment(DateTime.toEpochMillis(keyInfo.createdAt))}</span>
        </span>
      </span>
      {/* One revoked later can still be revoked sooner: a revocation only moves earlier. */}
      <span className="flex gap-2">
        <Revoke keyInfo={keyInfo} last={last} onRevoke={onRevoke} />
      </span>
    </li>
  )
}

/** Adding a key: its name and how long it works. */
function AddKey({
  component,
  adding,
  onAdd,
}: {
  readonly component: ComponentKey
  readonly adding: boolean
  readonly onAdd: (name: string, life: KeyLife) => void
}) {
  const [name, setName] = useState("")
  const [life, setLife] = useState<KeyLife>("never")
  const trimmed = name.trim()
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (trimmed.length > 0) {
          onAdd(trimmed, life)
          setName("")
        }
      }}
    >
      <label htmlFor={`new-key-${component}`} className="flex w-48 flex-col gap-1.5 text-sm text-muted-foreground">
        New key&apos;s name
        <Input
          id={`new-key-${component}`}
          value={name}
          maxLength={40}
          autoComplete="off"
          placeholder="blue, ci, 2026-11"
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <Segmented label="Expires" options={lives} value={life} onChange={setLife} />
      <Button type="submit" variant="outline" size="sm" disabled={adding || trimmed.length === 0}>
        {adding ? "Adding…" : "Add a key"}
        <span className="sr-only"> for {component}</span>
      </Button>
    </form>
  )
}

/**
 * A component's ingest keys, which its services send telemetry with: each that works, with when it
 * was last used and when it ends, marked in yellow within a week of it; a form that adds another,
 * whose key is shown once, here, to copy; and the keys that ended, folded. Keys are secrets, so only
 * their names are listed. What failed is said under them.
 */
export function IngestKeys({
  component,
  keys,
  now,
  adding,
  added,
  problem,
  onAdd,
  onRevoke,
}: {
  readonly component: ComponentKey
  /** Its keys, the newest first: those that work, and those that ended in the last 30 days. */
  readonly keys: ReadonlyArray<IngestKeyInfo>
  /** What "ago" and "in" are measured from. */
  readonly now: number
  readonly adding: boolean
  /** The key added here last, with the key itself, shown only now. */
  readonly added?: { readonly key: IngestKeyInfo; readonly ingestKey: IngestKey }
  /** Why the last add or revoke failed, in words. */
  readonly problem?: string
  readonly onAdd: (name: string, life: KeyLife) => void
  readonly onRevoke: (id: IngestKeyId, when: RevokeWhen) => void
}) {
  const working = keys.filter((key) => {
    const end = endOf(key)
    return end === undefined || end > now
  })
  const ended = keys.filter((key) => !working.includes(key))
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {working.length === 0 ? (
        <p className="text-[15px] text-muted-foreground">
          No working ingest key: everything {component} sends is refused. Add one, and deploy it.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {working.map((key) => (
            <WorkingKey
              key={key.id}
              keyInfo={key}
              now={now}
              last={working.length === 1}
              isNew={added?.key.id === key.id}
              onRevoke={onRevoke}
            />
          ))}
        </ul>
      )}
      {added !== undefined && (
        <div className="flex flex-col gap-2 border px-3 py-2.5">
          <span className="text-sm">
            The key of &ldquo;{added.key.name}&rdquo;, shown only now. Deploy it, then revoke the old one once its last
            use stops moving.
          </span>
          <span className="flex flex-wrap items-center gap-3">
            <code className="min-w-0 flex-1 font-mono text-sm break-all">{added.ingestKey}</code>
            <CopyButton text={added.ingestKey} label="Copy" name={`the key ${added.key.name}`} />
          </span>
        </div>
      )}
      <AddKey component={component} adding={adding} onAdd={onAdd} />
      {problem !== undefined && (
        <p role="alert" className="text-sm text-failure">
          {problem}
        </p>
      )}
      {ended.length > 0 && (
        <Collapsible>
          <CollapsibleTrigger className="group flex items-center gap-1.5 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground focus-visible:underline">
            <ChevronRightIcon aria-hidden className="size-4 transition-transform group-data-[panel-open]:rotate-90" />
            {ended.length === 1 ? "1 key that ended" : `${count(ended.length)} keys that ended`}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="mt-2 flex flex-col gap-1.5">
              {ended.map((key) => {
                const end = endOf(key)
                const revoked = key.revokedAt !== undefined && end === DateTime.toEpochMillis(key.revokedAt)
                return (
                  <li key={key.id} className="flex flex-wrap gap-x-2 text-sm text-muted-foreground">
                    <span className="font-mono">{key.name}</span>
                    <span>
                      {revoked ? "revoked" : "expired"}{" "}
                      <span className="font-mono">{end === undefined ? "" : moment(end)}</span>
                    </span>
                  </li>
                )
              })}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  )
}
