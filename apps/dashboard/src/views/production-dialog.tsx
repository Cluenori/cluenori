import { EnvironmentKey } from "@cluenori/foundation"
import { ProjectSettings } from "@cluenori/projects"
import { Result, Schema } from "effect"
import { AsyncResult } from "effect/reactivity"
import { useId, useState } from "react"

import { failureText } from "@/views/loaded"
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
import { Input } from "@/views/ui/input"

// An environment typed in, and the settings saved, are checked by the API's own rules, so a
// refusal says the rule.
const decodeEnvironment = Schema.decodeResult(EnvironmentKey)
const decodeSettings = Schema.decodeResult(ProjectSettings)

/**
 * Which of a project's environments are production, as a form in a dialog: a box for each
 * environment its telemetry named lately and each production one, checked when it is production,
 * and a field to add one not seen yet, checked by the API's rule for a key. It says what production
 * means: alerts ring there, Today counts it, and the project's pages start there. Saving calls
 * `onSave`, at least one chosen; while it saves the button says so, and a failure is said above it.
 * The dialog closes when the page says so, such as once the save succeeded.
 */
export function ProductionDialog({
  projectName,
  settings,
  seen,
  open,
  onOpenChange,
  saving,
  onSave,
}: {
  readonly projectName: string
  readonly settings: ProjectSettings
  /** The environments the project's telemetry named in the last 30 days, production first. */
  readonly seen: ReadonlyArray<EnvironmentKey>
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  /** The last save's answer. */
  readonly saving: AsyncResult.AsyncResult<ProjectSettings, unknown>
  readonly onSave: (settings: ProjectSettings) => void
}) {
  const id = useId()
  const [chosen, setChosen] = useState<ReadonlyArray<EnvironmentKey>>(settings.productionEnvironments)
  // Environments added here, not seen yet, listed after the others until the dialog closes.
  const [added, setAdded] = useState<ReadonlyArray<EnvironmentKey>>([])
  const [draft, setDraft] = useState("")
  const [rule, setRule] = useState<string | undefined>(undefined)
  const [refusal, setRefusal] = useState<string | undefined>(undefined)
  const listed = [...new Set([...seen, ...settings.productionEnvironments, ...added])]
  const toggle = (environment: EnvironmentKey, checked: boolean) =>
    setChosen(checked ? [...chosen, environment] : chosen.filter((each) => each !== environment))
  const add = () => {
    const decoded = decodeEnvironment(draft.trim())
    if (Result.isFailure(decoded)) {
      setRule(decoded.failure.message)
      return
    }
    setRule(undefined)
    setDraft("")
    setAdded(listed.includes(decoded.success) ? added : [...added, decoded.success])
    setChosen(chosen.includes(decoded.success) ? chosen : [...chosen, decoded.success])
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Production in {projectName}</DialogTitle>
          <DialogDescription>
            Incidents in production ring as alerts, Today counts production only, and this project&apos;s pages start
            there. Telemetry that names no environment counts as production.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault()
            const decoded = decodeSettings({ productionEnvironments: chosen })
            setRefusal(Result.isFailure(decoded) ? decoded.failure.message : undefined)
            if (Result.isSuccess(decoded)) {
              onSave(decoded.success)
            }
          }}
        >
          <fieldset className="flex flex-col gap-2.5">
            <legend className="mb-2.5 text-sm">Production environments</legend>
            {listed.map((environment) => (
              <label key={environment} className="flex items-center gap-2.5 text-[15px]">
                <Checkbox
                  checked={chosen.includes(environment)}
                  onCheckedChange={(checked) => toggle(environment, checked)}
                />
                {environment}
                {!seen.includes(environment) && (
                  <span className="text-sm text-muted-foreground">not seen in the last 30 days</span>
                )}
              </label>
            ))}
          </fieldset>
          <div className="flex flex-col gap-2">
            <label htmlFor={`${id}-add`} className="text-sm">
              Another environment, not seen yet
            </label>
            <div className="flex gap-2">
              <Input
                id={`${id}-add`}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  // Enter adds the environment typed, rather than saving the form.
                  if (event.key === "Enter") {
                    event.preventDefault()
                    add()
                  }
                }}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={rule !== undefined}
                aria-describedby={`${id}-rule`}
                className="h-9 font-mono"
              />
              <Button type="button" variant="outline" className="h-9" onClick={add}>
                Add
              </Button>
            </div>
            <p id={`${id}-rule`} className={rule === undefined ? "text-muted-foreground" : "text-failure"}>
              {rule ?? "As the service names it in its telemetry, such as prod-eu."}
            </p>
          </div>
          {refusal !== undefined && (
            <p role="alert" className="text-failure">
              {refusal}
            </p>
          )}
          {AsyncResult.isFailure(saving) && !saving.waiting && (
            <p role="alert" className="text-failure">
              {failureText(saving.cause)}
            </p>
          )}
          <DialogFooter>
            {chosen.length === 0 && (
              <p className="self-center text-muted-foreground sm:mr-auto">Choose at least one.</p>
            )}
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button type="submit" disabled={saving.waiting || chosen.length === 0}>
              {saving.waiting ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
