import type { ComponentKey } from "@cluenori/foundation"
import type { ComponentVersionPolicy, UpdateWords, UpdateWordsDecision } from "@cluenori/releases"
import { compareStoreVersions, VersionPolicyTo } from "@cluenori/releases"
import { Result, Schema } from "effect"
import { PlusIcon, Trash2Icon } from "lucide-react"
import { useId, useState } from "react"

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
import { NativeSelect, NativeSelectOption } from "@/views/ui/native-select"
import { Textarea } from "@/views/ui/textarea"

/** What each decision is called where a policy is shown or edited. */
export const decisionWords: Readonly<Record<UpdateWordsDecision, string>> = {
  require: "Must update",
  recommend: "Offered an update",
}

/**
 * A component's version policy, as read: below which version its users must update, and below which
 * they are offered one; where the update is, the oldest OS it runs on, and the project's own words
 * for each decision by language. Without one, it says no release is asked to update.
 */
export function VersionPolicySummary({ policy }: { readonly policy: ComponentVersionPolicy | undefined }) {
  if (policy === undefined) {
    return <p className="text-[15px] text-muted-foreground">No version policy: no release is asked to update.</p>
  }
  const rows = [
    ...(policy.minimum === undefined ? [] : [{ label: "Must update below", value: policy.minimum, mono: true }]),
    ...(policy.recommended === undefined
      ? []
      : [{ label: "Offered an update below", value: policy.recommended, mono: true }]),
    ...(policy.minimumOsVersion === undefined
      ? []
      : [{ label: "The update needs OS", value: `${policy.minimumOsVersion} or later`, mono: true }]),
  ]
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-1.5 text-[15px]">
        {rows.map((row) => (
          <div key={row.label} className="contents">
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className={row.mono ? "font-mono" : ""}>{row.value}</dd>
          </div>
        ))}
        <dt className="text-muted-foreground">Store page</dt>
        <dd className="min-w-0">
          <a
            href={policy.storeUrl}
            target="_blank"
            rel="noreferrer"
            className="block truncate font-mono text-sm underline-offset-4 hover:underline"
          >
            {policy.storeUrl}
          </a>
        </dd>
      </dl>
      {policy.words.length > 0 && (
        <ul className="flex flex-col gap-2 border-t pt-3">
          {policy.words.map((words) => (
            <li key={`${words.decision} ${words.locale}`} className="flex flex-col text-sm">
              <span className="text-muted-foreground">
                <span className="font-mono">{words.locale}</span>, {decisionWords[words.decision].toLowerCase()}
              </span>
              <span className="font-medium">{words.text.title}</span>
              <span className="text-pretty">{words.text.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// A policy as typed: every field text, the words a list of drafts.
type WordsDraft = {
  readonly locale: string
  readonly decision: UpdateWordsDecision
  readonly title: string
  readonly message: string
}

const draftOf = (words: UpdateWords): WordsDraft => ({
  locale: words.locale,
  decision: words.decision,
  title: words.text.title,
  message: words.text.message,
})

const decodePolicy = Schema.decodeResult(VersionPolicyTo)

// A field as typed, trimmed; absent when empty, as the API treats one left out as unset.
const typed = (value: string) => (value.trim() === "" ? undefined : value.trim())

/**
 * Setting a component's version policy, as a form in a dialog: the minimum and recommended versions,
 * at least one, the recommended not lower; the store page, which the API finds from the component's
 * App Store deploy target when left empty; the oldest OS the update runs on; and the project's words
 * for each language and decision, which the app shows instead of the SDK's own. Each is checked by
 * the API's own rule before it is sent; why the API refused is said above the buttons. Every field
 * is sent, as the API replaces the policy whole.
 */
export function VersionPolicyDialog({
  component,
  current,
  open,
  onOpenChange,
  saving,
  refusal,
  onSave,
}: {
  readonly component: ComponentKey
  /** The policy it has now, which the form starts from; absent for none. */
  readonly current: ComponentVersionPolicy | undefined
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly saving: boolean
  /** Why the last save didn't set it, in words. */
  readonly refusal: string | undefined
  readonly onSave: (policy: VersionPolicyTo) => void
}) {
  const id = useId()
  const [minimum, setMinimum] = useState<string>(current?.minimum ?? "")
  const [recommended, setRecommended] = useState<string>(current?.recommended ?? "")
  const [storeUrl, setStoreUrl] = useState<string>(current?.storeUrl ?? "")
  const [minimumOs, setMinimumOs] = useState<string>(current?.minimumOsVersion ?? "")
  const [words, setWords] = useState<ReadonlyArray<WordsDraft>>(current?.words.map(draftOf) ?? [])
  const [rule, setRule] = useState<string | undefined>(undefined)
  const changeWords = (index: number, change: Partial<WordsDraft>) =>
    setWords(words.map((each, at) => (at === index ? { ...each, ...change } : each)))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{component}&apos;s version policy</DialogTitle>
          <DialogDescription>
            In production, a release below the minimum must update before it can be used; one below the recommended
            version is offered the update, in a sheet people can close. Apps read it within five minutes.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault()
            const given = {
              minimum: typed(minimum),
              recommended: typed(recommended),
              storeUrl: typed(storeUrl),
              minimumOsVersion: typed(minimumOs),
            }
            const decoded = decodePolicy({
              ...(given.minimum === undefined ? {} : { minimum: given.minimum }),
              ...(given.recommended === undefined ? {} : { recommended: given.recommended }),
              ...(given.storeUrl === undefined ? {} : { storeUrl: given.storeUrl }),
              ...(given.minimumOsVersion === undefined ? {} : { minimumOsVersion: given.minimumOsVersion }),
              words: words.map((each) => ({
                locale: each.locale.trim(),
                decision: each.decision,
                text: { title: each.title.trim(), message: each.message.trim() },
              })),
            })
            if (Result.isFailure(decoded)) {
              setRule(decoded.failure.message)
              return
            }
            const policy = decoded.success
            if (policy.minimum === undefined && policy.recommended === undefined) {
              setRule("Give a minimum version, a recommended one, or both.")
              return
            }
            if (
              policy.minimum !== undefined &&
              policy.recommended !== undefined &&
              compareStoreVersions(policy.recommended, policy.minimum) < 0
            ) {
              setRule(`The recommended version, ${policy.recommended}, is lower than the minimum, ${policy.minimum}.`)
              return
            }
            setRule(undefined)
            onSave(policy)
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <label htmlFor={`${id}-minimum`} className="text-sm">
                Minimum version
              </label>
              <Input
                id={`${id}-minimum`}
                value={minimum}
                onChange={(event) => setMinimum(event.target.value)}
                placeholder="0.3.0"
                autoComplete="off"
                spellCheck={false}
                aria-describedby={`${id}-minimum-help`}
                className="h-9 font-mono"
              />
              <p id={`${id}-minimum-help`} className="text-sm text-muted-foreground">
                Below it, people must update.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor={`${id}-recommended`} className="text-sm">
                Recommended version
              </label>
              <Input
                id={`${id}-recommended`}
                value={recommended}
                onChange={(event) => setRecommended(event.target.value)}
                placeholder="0.4.0"
                autoComplete="off"
                spellCheck={false}
                aria-describedby={`${id}-recommended-help`}
                className="h-9 font-mono"
              />
              <p id={`${id}-recommended-help`} className="text-sm text-muted-foreground">
                Below it, people are offered the update.
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor={`${id}-store`} className="text-sm">
              Store page
            </label>
            <Input
              id={`${id}-store`}
              value={storeUrl}
              onChange={(event) => setStoreUrl(event.target.value)}
              placeholder="https://apps.apple.com/app/id…"
              autoComplete="off"
              spellCheck={false}
              aria-describedby={`${id}-store-help`}
              className="h-9 font-mono"
            />
            <p id={`${id}-store-help`} className="text-sm text-muted-foreground">
              Optional: without it, the App Store page of the app its App Store deploy target names.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor={`${id}-os`} className="text-sm">
              Oldest OS the update runs on
            </label>
            <Input
              id={`${id}-os`}
              value={minimumOs}
              onChange={(event) => setMinimumOs(event.target.value)}
              placeholder="26.0"
              autoComplete="off"
              spellCheck={false}
              aria-describedby={`${id}-os-help`}
              className="h-9 w-40 font-mono"
            />
            <p id={`${id}-os-help`} className="text-sm text-muted-foreground">
              Optional: a device on an older OS is told it can&apos;t update, never blocked.
            </p>
          </div>
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1 text-sm">Your words</legend>
            <p className="text-sm text-muted-foreground">
              Optional, per language and decision; without them, the SDK says it in its own words.
            </p>
            {words.map((each, index) => (
              <div key={index} className="flex flex-col gap-2 border p-3">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor={`${id}-locale-${index}`} className="text-sm">
                      Language
                    </label>
                    <Input
                      id={`${id}-locale-${index}`}
                      value={each.locale}
                      onChange={(event) => changeWords(index, { locale: event.target.value })}
                      placeholder="en-US"
                      autoComplete="off"
                      spellCheck={false}
                      className="h-9 w-28 font-mono"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor={`${id}-decision-${index}`} className="text-sm">
                      When
                    </label>
                    <NativeSelect
                      id={`${id}-decision-${index}`}
                      className="[&_select]:h-9"
                      value={each.decision}
                      onChange={(event) =>
                        changeWords(index, { decision: event.target.value === "recommend" ? "recommend" : "require" })
                      }
                    >
                      <NativeSelectOption value="require">{decisionWords.require}</NativeSelectOption>
                      <NativeSelectOption value="recommend">{decisionWords.recommend}</NativeSelectOption>
                    </NativeSelect>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="ml-auto"
                    onClick={() => setWords(words.filter((_, at) => at !== index))}
                  >
                    <Trash2Icon data-icon="inline-start" />
                    Remove<span className="sr-only"> these words</span>
                  </Button>
                </div>
                <label htmlFor={`${id}-title-${index}`} className="text-sm">
                  Title
                </label>
                <Input
                  id={`${id}-title-${index}`}
                  value={each.title}
                  onChange={(event) => changeWords(index, { title: event.target.value })}
                  maxLength={80}
                  className="h-9"
                />
                <label htmlFor={`${id}-message-${index}`} className="text-sm">
                  Message
                </label>
                <Textarea
                  id={`${id}-message-${index}`}
                  value={each.message}
                  onChange={(event) => changeWords(index, { message: event.target.value })}
                  maxLength={500}
                  rows={2}
                />
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => setWords([...words, { locale: "en-US", decision: "require", title: "", message: "" }])}
            >
              <PlusIcon data-icon="inline-start" />
              Add words
            </Button>
          </fieldset>
          {(rule ?? refusal) !== undefined && (
            <p role="alert" className="text-failure">
              {rule ?? refusal}
            </p>
          )}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save the policy"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
