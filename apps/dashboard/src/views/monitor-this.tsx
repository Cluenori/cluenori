import type { ComponentKey, EnvironmentKey, ProjectKey } from "@cluenori/foundation"
import type { AlertLevel, MonitorCondition } from "@cluenori/incidents"
import { AddMonitor } from "@cluenori/incidents"
import { useAtomSet } from "@effect/atom-react"
import { Exit, Result, Schema } from "effect"
import { RadarIcon } from "lucide-react"
import { useId, useState } from "react"

import { conditionWords, subjectWords } from "@/incident-facts"
import { addMonitorAtom } from "@/project-data"
import { navigate } from "@/router"
import { failureText } from "@/views/loaded"
import { Segmented } from "@/views/segmented"
import { Button } from "@/views/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/views/ui/dialog"
import { Input } from "@/views/ui/input"
import { NativeSelect, NativeSelectOption } from "@/views/ui/native-select"

/** A monitor's condition other than a URL's: the ones "Monitor this" offers for what a page shows. */
export type CountKind = Exclude<MonitorCondition["_tag"], "noAnswer">

/** A monitor's subject other than a URL. */
export type CountSubject = Exclude<MonitorCondition["subject"], { readonly _tag: "url" }>

// The conditions that fit each subject.
const kindsOf: Readonly<Record<CountSubject["_tag"], ReadonlyArray<CountKind>>> = {
  operation: ["nothingFor", "p95Above", "errorRateAbove"],
  event: ["nothingFor", "moreThan"],
  error: ["moreThan"],
  message: ["moreThan"],
}

const kindLabels: Readonly<Record<CountKind, string>> = {
  nothingFor: "Nothing for",
  moreThan: "More than",
  p95Above: "p95 above",
  errorRateAbove: "Error rate above",
}

const levelOptions: ReadonlyArray<{
  readonly value: AlertLevel
  readonly label: string
  readonly description: string
}> = [
  { value: "alarm", label: "Alarm", description: "Rings through silent mode and Do Not Disturb" },
  { value: "timeSensitive", label: "Time sensitive", description: "Breaks through a Focus that allows it" },
  { value: "quiet", label: "Quiet", description: "Shows without a sound" },
]

const units = { minutes: 1, hours: 60, days: 1440 } as const
type Unit = keyof typeof units

// A monitor typed in is checked by the API's own rules, so a refusal says the rule.
const decodeMonitor = Schema.decodeUnknownResult(AddMonitor)

// The condition the form says, for the schema to check.
const conditionOf = (subject: CountSubject, kind: CountKind, threshold: number, minutes: number) => {
  switch (kind) {
    case "nothingFor":
      return { _tag: kind, subject, minutes }
    case "moreThan":
      return { _tag: kind, subject, count: threshold, minutes }
    case "p95Above":
      return { _tag: kind, subject, ms: threshold, minutes }
    case "errorRateAbove":
      return { _tag: kind, subject, percent: threshold, minutes }
  }
}

// What the number of each condition is, and its first value.
const thresholds: Readonly<Record<CountKind, { readonly label: string; readonly first: string } | undefined>> = {
  nothingFor: undefined,
  moreThan: { label: "Times", first: "10" },
  p95Above: { label: "Milliseconds", first: "500" },
  errorRateAbove: { label: "Percent failed", first: "5" },
}

/**
 * "Monitor this", a button that opens a form in a dialog: what is watched is the page's (an
 * operation, an error, a log message, an event), with the conditions that fit it, a number and a
 * window, and the level of its alerts. The API checks the monitor; a refusal is said in the form,
 * and the monitor's page opens once it is added. `initial` starts the form on a condition, such as a
 * quiet hint's "nothing for".
 */
export function MonitorThis({
  project,
  component,
  environment,
  subject,
  initial,
  label = "Monitor this",
}: {
  readonly project: ProjectKey
  readonly component: ComponentKey
  readonly environment?: EnvironmentKey | undefined
  readonly subject: CountSubject
  readonly initial?: { readonly kind: CountKind; readonly minutes: number } | undefined
  readonly label?: string
}) {
  const id = useId()
  const kinds = kindsOf[subject._tag]
  const firstKind = initial?.kind ?? kinds[0] ?? "moreThan"
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<CountKind>(firstKind)
  const [threshold, setThreshold] = useState(thresholds[firstKind]?.first ?? "")
  const [amount, setAmount] = useState(() => {
    const minutes = initial?.minutes ?? (firstKind === "nothingFor" ? 60 : 15)
    return minutes % 60 === 0 ? String(minutes / 60) : String(minutes)
  })
  const [unit, setUnit] = useState<Unit>(() => ((initial?.minutes ?? 60) % 60 === 0 ? "hours" : "minutes"))
  const [level, setLevel] = useState<AlertLevel>("timeSensitive")
  const [saving, setSaving] = useState(false)
  const [refusal, setRefusal] = useState<string | undefined>(undefined)
  const add = useAtomSet(addMonitorAtom, { mode: "promiseExit" })
  const measure = thresholds[kind]
  const decoded = decodeMonitor({
    component,
    ...(environment === undefined ? {} : { environment }),
    condition: conditionOf(subject, kind, Number(threshold), Number(amount) * units[unit]),
    level,
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        setRefusal(undefined)
      }}
    >
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <RadarIcon />
        {label}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Monitor {subjectWords(subject)}</DialogTitle>
          <DialogDescription>
            Of {component}
            {environment === undefined ? ", in any environment" : `, in ${environment}`}. Looked at every minute; when
            it holds, an incident opens and phones are told at the level you choose.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault()
            if (Result.isFailure(decoded)) {
              setRefusal(decoded.failure.message)
              return
            }
            setSaving(true)
            void add({ project, monitor: decoded.success }).then((exit) => {
              setSaving(false)
              if (Exit.isSuccess(exit)) {
                setOpen(false)
                navigate({ page: "monitor", project, monitor: exit.value.id })
              } else {
                setRefusal(failureText(exit.cause))
              }
            })
          }}
        >
          {kinds.length > 1 && (
            <Segmented
              label="When it fires"
              options={kinds.map((each) => ({ value: each, label: kindLabels[each] }))}
              value={kind}
              onChange={(next) => {
                setKind(next)
                setThreshold(thresholds[next]?.first ?? "")
              }}
            />
          )}
          <div className="flex flex-wrap items-end gap-3">
            {measure !== undefined && (
              <label htmlFor={`${id}-threshold`} className="flex flex-col gap-1.5 text-sm">
                {measure.label}
                <Input
                  id={`${id}-threshold`}
                  value={threshold}
                  onChange={(event) => setThreshold(event.target.value)}
                  inputMode="decimal"
                  className="h-9 w-28 font-mono"
                />
              </label>
            )}
            <label htmlFor={`${id}-window`} className="flex flex-col gap-1.5 text-sm">
              {kind === "nothingFor" ? "For" : "Within"}
              <Input
                id={`${id}-window`}
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="numeric"
                className="h-9 w-24 font-mono"
              />
            </label>
            <NativeSelect
              aria-label="Unit of the window"
              value={unit}
              onChange={(event) =>
                setUnit(
                  event.target.value === "days" || event.target.value === "hours" ? event.target.value : "minutes",
                )
              }
              className="h-9"
            >
              <NativeSelectOption value="minutes">minutes</NativeSelectOption>
              <NativeSelectOption value="hours">hours</NativeSelectOption>
              <NativeSelectOption value="days">days</NativeSelectOption>
            </NativeSelect>
          </div>
          <Segmented label="Its alerts" options={levelOptions} value={level} onChange={setLevel} />
          <p className={refusal === undefined ? "text-sm text-muted-foreground" : "text-sm text-failure"}>
            {refusal ??
              (Result.isSuccess(decoded)
                ? `${conditionWords(decoded.success.condition)}.`
                : "Windows are 1 minute to 1 day; nothing-for up to 7 days.")}
          </p>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button type="submit" disabled={saving}>
              {saving ? "Adding…" : "Add the monitor"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
