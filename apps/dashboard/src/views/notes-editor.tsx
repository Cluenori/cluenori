import type { EnvironmentKey } from "@cluenori/foundation"
import type { NotesDraft, ReleaseNote } from "@cluenori/releases"
import { NoteLocale, NoteText, ReleaseNotes } from "@cluenori/releases"
import { Result, Schema } from "effect"
import { PlusIcon, SparklesIcon, XIcon } from "lucide-react"
import { useId, useState } from "react"

import { count } from "@/lib/format"
import { Segmented } from "@/views/segmented"
import { Button } from "@/views/ui/button"
import { Input } from "@/views/ui/input"
import { Textarea } from "@/views/ui/textarea"

// Each note, and the notes together, are checked by the API's own rules.
const decodeLocale = Schema.decodeResult(NoteLocale)
const decodeText = Schema.decodeResult(NoteText)
const decodeNotes = Schema.decodeResult(ReleaseNotes)
const noteLength = 4000

/** How asking for a draft went: the draft, or why there is none. */
export type DraftOutcome =
  | { readonly _tag: "drafted"; readonly draft: NotesDraft }
  | { readonly _tag: "unavailable"; readonly reason: string }

/** How saving went: saved, or what failed. */
export type SaveOutcome = { readonly _tag: "saved" } | { readonly _tag: "failed"; readonly problem: string }

/** A language's note as typed. */
type Entry = { readonly locale: string; readonly text: string }

// The notes as typed, saved as they would be: a language left empty has no note.
const entriesOf = (notes: ReadonlyArray<ReleaseNote>): ReadonlyArray<Entry> =>
  notes.length === 0 ? [{ locale: "en-US", text: "" }] : notes.map((note) => ({ locale: note.locale, text: note.text }))

const sameNotes = (entries: ReadonlyArray<Entry>, notes: ReadonlyArray<ReleaseNote>) => {
  const written = entries.filter((entry) => entry.text.trim() !== "")
  return (
    written.length === notes.length &&
    written.every((entry) => notes.some((note) => note.locale === entry.locale && note.text === entry.text.trim()))
  )
}

// "Drafted from 4 commits since 1.8.1+398".
const draftedWords = (draft: NotesDraft) => {
  const commits = `${count(draft.commits)} ${draft.commits === 1 ? "commit" : "commits"}`
  return draft.since === undefined ? `Drafted from ${commits}` : `Drafted from ${commits} since ${draft.since}`
}

/**
 * A release's notes for its users, one field per language with how long it is of the 4000
 * characters a store takes, adding a language checked by the API's rule and removing one; drafting
 * them with AI for where the release goes, which fills the fields and saves nothing; and saving
 * them, which replaces those saved. Unsaved changes are said to be so; why a draft or a save didn't
 * happen is said where it was asked.
 */
export function NotesEditor({
  notes,
  draftEnvironments,
  defaultDraftEnvironment,
  onDraft,
  onSave,
}: {
  /** The notes saved. */
  readonly notes: ReadonlyArray<ReleaseNote>
  /** The environments a draft can be for: where the release can go. */
  readonly draftEnvironments: ReadonlyArray<EnvironmentKey>
  readonly defaultDraftEnvironment: EnvironmentKey | undefined
  readonly onDraft: (environment: EnvironmentKey) => Promise<DraftOutcome>
  readonly onSave: (notes: ReadonlyArray<ReleaseNote>) => Promise<SaveOutcome>
}) {
  const id = useId()
  const [entries, setEntries] = useState<ReadonlyArray<Entry>>(() => entriesOf(notes))
  const [adding, setAdding] = useState("")
  const [addRule, setAddRule] = useState<string | undefined>(undefined)
  const [draftFor, setDraftFor] = useState<EnvironmentKey | undefined>(defaultDraftEnvironment)
  const [drafting, setDrafting] = useState(false)
  const [drafted, setDrafted] = useState<DraftOutcome | undefined>(undefined)
  const [saving, setSaving] = useState(false)
  const [saveProblem, setSaveProblem] = useState<string | undefined>(undefined)
  const [justSaved, setJustSaved] = useState(false)
  const changed = !sameNotes(entries, notes)

  const change = (locale: string, text: string) => {
    setJustSaved(false)
    setEntries(entries.map((entry) => (entry.locale === locale ? { ...entry, text } : entry)))
  }
  const add = () => {
    const decoded = decodeLocale(adding.trim())
    if (Result.isFailure(decoded)) {
      setAddRule(decoded.failure.message)
      return
    }
    if (entries.some((entry) => entry.locale === decoded.success)) {
      setAddRule(`${decoded.success} is here already.`)
      return
    }
    setAddRule(undefined)
    setAdding("")
    setEntries([...entries, { locale: decoded.success, text: "" }])
  }
  const draft = (environment: EnvironmentKey) => {
    setDrafting(true)
    setDrafted(undefined)
    void onDraft(environment).then((outcome) => {
      setDrafting(false)
      setDrafted(outcome)
      if (outcome._tag === "drafted") {
        setJustSaved(false)
        const drafts = outcome.draft.notes
        setEntries((current) => [
          ...current.map((entry) => {
            const draftedNote = drafts.find((note) => note.locale === entry.locale)
            return draftedNote === undefined ? entry : { locale: entry.locale, text: draftedNote.text }
          }),
          ...drafts
            .filter((note) => !current.some((entry) => entry.locale === note.locale))
            .map((note) => ({ locale: note.locale, text: note.text })),
        ])
      }
    })
  }
  const save = () => {
    const written = entries.filter((entry) => entry.text.trim() !== "")
    const checked = written.map((entry) => ({
      locale: decodeLocale(entry.locale),
      text: decodeText(entry.text.trim()),
    }))
    const notesToSave = checked.flatMap((each) =>
      Result.isSuccess(each.locale) && Result.isSuccess(each.text)
        ? [{ locale: each.locale.success, text: each.text.success }]
        : [],
    )
    const decoded = decodeNotes(notesToSave)
    if (notesToSave.length !== written.length || Result.isFailure(decoded)) {
      setSaveProblem("Each note is up to 4000 characters, one for each language.")
      return
    }
    setSaving(true)
    setSaveProblem(undefined)
    void onSave(decoded.success).then((outcome) => {
      setSaving(false)
      setSaveProblem(outcome._tag === "failed" ? outcome.problem : undefined)
      setJustSaved(outcome._tag === "saved")
    })
  }

  return (
    <div className="flex flex-col">
      {draftFor !== undefined && (
        <div className="flex flex-col gap-2 border-b px-5 py-3.5">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" disabled={drafting} onClick={() => draft(draftFor)}>
              <SparklesIcon data-icon="inline-start" />
              {drafting ? "Drafting…" : "Draft with AI"}
            </Button>
            {draftEnvironments.length > 1 && (
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                for
                <Segmented
                  label="The environment the draft is for"
                  options={draftEnvironments.map((environment) => ({ value: environment, label: environment }))}
                  value={draftFor}
                  onChange={setDraftFor}
                />
              </span>
            )}
          </div>
          {drafted?._tag === "drafted" && (
            <p role="status" className="text-sm text-muted-foreground">
              {draftedWords(drafted.draft)}. Not saved: read it, edit it, then save it.
            </p>
          )}
          {drafted?._tag === "unavailable" && (
            <p role="alert" className="text-sm text-failure">
              {drafted.reason}
            </p>
          )}
        </div>
      )}
      <div className="flex flex-col gap-5 px-5 py-5">
        {entries.map((entry) => (
          <div key={entry.locale} className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <label htmlFor={`${id}-${entry.locale}`} className="font-mono text-sm">
                {entry.locale}
              </label>
              <span className="flex items-center gap-2">
                <span
                  className={
                    entry.text.length >= noteLength
                      ? "font-mono text-sm text-yellow"
                      : "font-mono text-sm text-muted-foreground"
                  }
                >
                  {count(entry.text.length)} / {count(noteLength)}
                  <span className="sr-only"> characters</span>
                </span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${entry.locale}`}
                  onClick={() => setEntries(entries.filter((each) => each.locale !== entry.locale))}
                >
                  <XIcon />
                </Button>
              </span>
            </div>
            <Textarea
              id={`${id}-${entry.locale}`}
              value={entry.text}
              onChange={(event) => change(entry.locale, event.target.value)}
              maxLength={noteLength}
              rows={5}
              className="max-w-4xl text-[15px]"
            />
          </div>
        ))}
        <div className="flex max-w-md flex-col gap-2">
          <label htmlFor={`${id}-add`} className="text-sm">
            Add language
          </label>
          <div className="flex gap-2">
            <Input
              id={`${id}-add`}
              value={adding}
              onChange={(event) => setAdding(event.target.value)}
              onKeyDown={(event) => {
                // Enter adds the language typed.
                if (event.key === "Enter") {
                  event.preventDefault()
                  add()
                }
              }}
              placeholder="de-DE"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={addRule !== undefined}
              aria-describedby={`${id}-add-help`}
              className="h-9 font-mono"
            />
            <Button variant="outline" className="h-9" onClick={add}>
              <PlusIcon data-icon="inline-start" />
              Add
            </Button>
          </div>
          <p
            id={`${id}-add-help`}
            className={addRule === undefined ? "text-sm text-muted-foreground" : "text-sm text-failure"}
          >
            {addRule ?? "As App Store Connect names it, such as de-DE or ja."}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t px-5 py-3.5">
        <Button disabled={saving || !changed} onClick={save}>
          {saving ? "Saving…" : "Save notes"}
        </Button>
        {changed && !saving && <span className="text-sm text-yellow">Not saved</span>}
        {!changed && justSaved && (
          <span role="status" className="text-sm text-muted-foreground">
            Saved.
          </span>
        )}
        {saveProblem !== undefined && (
          <p role="alert" className="text-sm text-failure">
            {saveProblem}
          </p>
        )}
      </div>
    </div>
  )
}
