import { NotesStyle } from "@cluenori/releases"
import { Result, Schema } from "effect"
import { useId, useState } from "react"

import { count } from "@/lib/format"
import { Button } from "@/views/ui/button"
import { Textarea } from "@/views/ui/textarea"

// The style is checked by the API's own rule.
const decodeStyle = Schema.decodeResult(NotesStyle)
const styleLength = 2000

/**
 * How the project's release notes read, which AI drafts follow, as a field and a button: the saved
 * style, or Cluenori's default until the project sets one, said so; how long it is of the most it
 * may be; and saving it, which says it saved, or why not.
 */
export function NotesStyleEditor({
  style,
  isDefault,
  saving,
  saved,
  problem,
  onSave,
}: {
  /** The style saved, or the default. */
  readonly style: string
  /** Whether it is Cluenori's default, which the project hasn't changed. */
  readonly isDefault: boolean
  readonly saving: boolean
  /** Whether the last save succeeded, and nothing changed since. */
  readonly saved: boolean
  /** Why the last save failed, in words. */
  readonly problem: string | undefined
  readonly onSave: (style: NotesStyle) => void
}) {
  const id = useId()
  const [text, setText] = useState(style)
  const [rule, setRule] = useState<string | undefined>(undefined)
  const changed = text !== style
  return (
    <form
      className="flex flex-col gap-3 px-5 py-5"
      onSubmit={(event) => {
        event.preventDefault()
        const decoded = decodeStyle({ style: text.trim() })
        setRule(Result.isFailure(decoded) ? "Write how the notes read, up to 2000 characters." : undefined)
        if (Result.isSuccess(decoded)) {
          onSave(decoded.success)
        }
      }}
    >
      <div className="flex items-baseline justify-between gap-4">
        <label htmlFor={`${id}-style`} className="text-sm">
          How the notes read
        </label>
        <span className="font-mono text-sm text-muted-foreground" aria-hidden>
          {count(text.length)} / {count(styleLength)}
        </span>
      </div>
      <Textarea
        id={`${id}-style`}
        value={text}
        onChange={(event) => setText(event.target.value)}
        maxLength={styleLength}
        rows={4}
        aria-invalid={rule !== undefined}
        aria-describedby={`${id}-help`}
        className="max-w-4xl text-[15px]"
      />
      <p id={`${id}-help`} className={rule === undefined ? "text-sm text-muted-foreground" : "text-sm text-failure"}>
        {rule ??
          (isDefault && !changed
            ? "Cluenori's default, until the project saves its own. Drafts follow it, and the last notes sent as examples."
            : `Drafts follow it, and the last notes sent as examples. Up to ${count(styleLength)} characters.`)}
      </p>
      {problem !== undefined && (
        <p role="alert" className="text-sm text-failure">
          {problem}
        </p>
      )}
      <div className="flex items-center gap-3">
        <Button type="submit" variant="outline" disabled={saving || !changed}>
          {saving ? "Saving…" : "Save"}
        </Button>
        {saved && !changed && (
          <span role="status" className="text-sm text-muted-foreground">
            Saved.
          </span>
        )}
      </div>
    </form>
  )
}
