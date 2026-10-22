import type { Component } from "@cluenori/projects"
import { ComponentLinks } from "@cluenori/projects"
import { Result, Schema } from "effect"
import { AsyncResult } from "effect/reactivity"
import { useId, useState } from "react"

import { failureText } from "@/views/loaded"
import { Button } from "@/views/ui/button"
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

// Each link is checked by the schema the API checks it with, so a refusal says the API's own rule.
const decodeRepository = Schema.decodeResult(ComponentLinks.fields.repository.schema)
const decodeBundleId = Schema.decodeResult(ComponentLinks.fields.appStoreBundleId.schema)

// A link as typed: empty unlinks it; else the value its schema reads, or the rule it breaks.
type Typed<A> =
  | { readonly _tag: "empty" }
  | { readonly _tag: "valid"; readonly value: A }
  | { readonly _tag: "invalid"; readonly rule: string }

const typedOf = <A,>(text: string, decode: (text: string) => Result.Result<A, Schema.SchemaError>): Typed<A> => {
  // Space around a pasted value means nothing in either link.
  const trimmed = text.trim()
  if (trimmed === "") {
    return { _tag: "empty" }
  }
  const decoded = decode(trimmed)
  return Result.isSuccess(decoded)
    ? { _tag: "valid", value: decoded.success }
    : { _tag: "invalid", rule: decoded.failure.message }
}

/** One link's field: its name, an example, and, once a save was tried, the rule its value breaks. */
function LinkField({
  label,
  example,
  value,
  onChange,
  rule,
}: {
  readonly label: string
  readonly example: string
  readonly value: string
  readonly onChange: (value: string) => void
  /** The rule the value breaks, shown under it; absent while it is valid or not checked yet. */
  readonly rule: string | undefined
}) {
  const id = useId()
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={`${id}-input`} className="text-sm">
        {label}
      </label>
      <Input
        id={`${id}-input`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={example}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={rule !== undefined}
        aria-describedby={`${id}-help`}
        className="h-9 font-mono"
      />
      <p id={`${id}-help`} className={rule === undefined ? "text-muted-foreground" : "text-failure"}>
        {rule ?? `Such as ${example}; leave it empty to unlink it.`}
      </p>
    </div>
  )
}

/**
 * Where a component's releases come from, as a form in a dialog: its GitHub repository, whose tags
 * and commits name its releases and what changed, and its app's bundle ID in App Store Connect. Each
 * is checked as the API checks it, and an empty one unlinks it. Saving calls `onSave`; while it saves
 * the button says so, and a failure is said under the fields. The dialog closes when the page says
 * so, such as once the save succeeded.
 */
export function LinksDialog({
  component,
  open,
  onOpenChange,
  saving,
  onSave,
}: {
  readonly component: Component
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  /** The last save's answer. */
  readonly saving: AsyncResult.AsyncResult<Component, unknown>
  readonly onSave: (links: ComponentLinks) => void
}) {
  const [repository, setRepository] = useState(component.repository ?? "")
  const [bundleId, setBundleId] = useState(component.appStoreBundleId ?? "")
  // Rules are said once a save was tried, not while the first value is being typed.
  const [checked, setChecked] = useState(false)
  const typedRepository = typedOf(repository, decodeRepository)
  const typedBundleId = typedOf(bundleId, decodeBundleId)
  const ruleOf = <A,>(typed: Typed<A>) => (checked && typed._tag === "invalid" ? typed.rule : undefined)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Where {component.key}&apos;s releases come from</DialogTitle>
          <DialogDescription>
            Its GitHub repository gives each release its commit and what changed since the one before; its bundle ID
            finds its builds in App Store Connect.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault()
            setChecked(true)
            if (typedRepository._tag === "invalid" || typedBundleId._tag === "invalid") {
              return
            }
            onSave({
              ...(typedRepository._tag === "valid" ? { repository: typedRepository.value } : {}),
              ...(typedBundleId._tag === "valid" ? { appStoreBundleId: typedBundleId.value } : {}),
            })
          }}
        >
          <LinkField
            label="GitHub repository"
            example="acme/notes-api"
            value={repository}
            onChange={setRepository}
            rule={ruleOf(typedRepository)}
          />
          <LinkField
            label="App Store bundle ID"
            example="com.acme.notes"
            value={bundleId}
            onChange={setBundleId}
            rule={ruleOf(typedBundleId)}
          />
          {AsyncResult.isFailure(saving) && !saving.waiting && (
            <p role="alert" className="text-failure">
              {failureText(saving.cause)}
            </p>
          )}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button type="submit" disabled={saving.waiting}>
              {saving.waiting ? "Saving…" : "Save the links"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
