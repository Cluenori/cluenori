import { EnvironmentKey } from "@cluenori/foundation"
import type { AppStoreDistribution, Component } from "@cluenori/projects"
import { BundleId, ComponentLinks, DeployTarget } from "@cluenori/projects"
import { Result, Schema } from "effect"
import { AsyncResult } from "effect/reactivity"
import { PlusIcon, XIcon } from "lucide-react"
import { useId, useState } from "react"

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
} from "@/views/ui/dialog"
import { Input } from "@/views/ui/input"

// Each link is checked by the schema the API checks it with, so a refusal says the API's own rule.
const decodeRepository = Schema.decodeResult(ComponentLinks.fields.repository.schema)
const decodeEnvironment = Schema.decodeResult(EnvironmentKey)
const decodeWorkflowFile = Schema.decodeResult(DeployTarget.fields.workflow.schema)
const decodeBundleId = Schema.decodeResult(BundleId)
const decodeTarget = Schema.decodeUnknownResult(DeployTarget)
const decodeTargets = Schema.decodeResult(ComponentLinks.fields.deployTargets.schema)

// A link as typed: empty unlinks it; else the value its schema reads, or the rule it breaks.
type Typed<A> =
  | { readonly _tag: "empty" }
  | { readonly _tag: "valid"; readonly value: A }
  | { readonly _tag: "invalid"; readonly rule: string }

const typedOf = <A,>(text: string, decode: (text: string) => Result.Result<A, Schema.SchemaError>): Typed<A> => {
  // Space around a pasted value means nothing in any link.
  const trimmed = text.trim()
  if (trimmed === "") {
    return { _tag: "empty" }
  }
  const decoded = decode(trimmed)
  return Result.isSuccess(decoded)
    ? { _tag: "valid", value: decoded.success }
    : { _tag: "invalid", rule: decoded.failure.message }
}

/** The repository's field: its name, an example, and, once a save was tried, the rule its value breaks. */
function RepositoryField({
  value,
  onChange,
  rule,
}: {
  readonly value: string
  readonly onChange: (value: string) => void
  /** The rule the value breaks, shown under it; absent while it is valid or not checked yet. */
  readonly rule: string | undefined
}) {
  const id = useId()
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={`${id}-input`} className="text-sm">
        GitHub repository
      </label>
      <Input
        id={`${id}-input`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="acme/notes-api"
        autoComplete="off"
        spellCheck={false}
        aria-invalid={rule !== undefined}
        aria-describedby={`${id}-help`}
        className="h-9 font-mono"
      />
      <p id={`${id}-help`} className={rule === undefined ? "text-muted-foreground" : "text-failure"}>
        {rule ?? "Such as acme/notes-api; leave it empty to unlink it."}
      </p>
    </div>
  )
}

/**
 * A deploy target as typed: its environment, workflow file and App Store Connect app, how far the
 * app's builds go, and an ID that keeps its row as others go.
 */
type TargetRow = {
  readonly id: number
  readonly environment: string
  readonly workflow: string
  readonly bundleId: string
  readonly distribution: AppStoreDistribution
}

/** A row as checked: empty, which is left out; else the target it is, or each rule it breaks. */
type CheckedRow =
  | { readonly _tag: "empty" }
  | { readonly _tag: "valid"; readonly target: DeployTarget }
  | {
      readonly _tag: "invalid"
      readonly environment?: string
      readonly workflow?: string
      readonly bundleId?: string
      /** What the target as a whole breaks, such as naming neither a workflow nor an app. */
      readonly target?: string
    }

const checkedRowsOf = (rows: ReadonlyArray<TargetRow>, hasRepository: boolean): ReadonlyArray<CheckedRow> =>
  rows.map((row, index) => {
    const environment = typedOf(row.environment, decodeEnvironment)
    const workflow = typedOf(row.workflow, decodeWorkflowFile)
    const bundleId = typedOf(row.bundleId, decodeBundleId)
    if (environment._tag === "empty" && workflow._tag === "empty" && bundleId._tag === "empty") {
      return { _tag: "empty" }
    }
    const repeated =
      environment._tag === "valid" &&
      rows.slice(0, index).some((above) => above.environment.trim() === environment.value)
    const rules = {
      ...(environment._tag === "empty" ? { environment: "Name the environment, such as production." } : {}),
      ...(environment._tag === "invalid" ? { environment: environment.rule } : {}),
      ...(repeated ? { environment: "This environment has a target above: one target for each environment." } : {}),
      ...(workflow._tag === "invalid" ? { workflow: workflow.rule } : {}),
      ...(workflow._tag === "valid" && !hasRepository
        ? { workflow: "A workflow runs in the component's repository: link it above." }
        : {}),
      ...(bundleId._tag === "invalid" ? { bundleId: bundleId.rule } : {}),
      ...(environment._tag === "valid" && workflow._tag === "empty" && bundleId._tag === "empty"
        ? { target: "Give it a workflow, an App Store Connect app, or both." }
        : {}),
    }
    if (Object.keys(rules).length > 0) {
      return { _tag: "invalid", ...rules }
    }
    // Each field is right: the target as a whole is checked by the API's own rule.
    const decoded = decodeTarget({
      environment: row.environment.trim(),
      ...(workflow._tag === "valid" ? { workflow: workflow.value } : {}),
      ...(bundleId._tag === "valid" ? { appStore: { bundleId: bundleId.value, distribution: row.distribution } } : {}),
    })
    return Result.isSuccess(decoded)
      ? { _tag: "valid", target: decoded.success }
      : { _tag: "invalid", target: decoded.failure.message }
  })

const distributions: ReadonlyArray<{ readonly value: AppStoreDistribution; readonly label: string }> = [
  { value: "testFlight", label: "TestFlight" },
  { value: "appStore", label: "App Store (through review)" },
]

/** One field of a deploy target, labelled with the target it belongs to for screen readers. */
function TargetField({
  id,
  label,
  number,
  value,
  onChange,
  example,
  rule,
  list,
}: {
  readonly id: string
  readonly label: string
  readonly number: number
  readonly value: string
  readonly onChange: (value: string) => void
  readonly example: string
  readonly rule: string | undefined
  /** The suggestions it offers, by their list's ID. */
  readonly list?: string
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-muted-foreground">
        {label}
        <span className="sr-only"> of deploy target {number}</span>
      </label>
      <Input
        id={id}
        {...(list === undefined ? {} : { list })}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={example}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={rule !== undefined}
        aria-describedby={`${id}-rule`}
        className="h-9 font-mono"
      />
      <p id={`${id}-rule`} className={rule === undefined ? "hidden" : "text-failure"}>
        {rule}
      </p>
    </div>
  )
}

/**
 * Where a component's releases go: a target for each environment, with the workflow that builds and
 * deploys a release there, the App Store Connect app its builds go to, and how far, TestFlight or on
 * to App Store review. Each added and removed in one click; rules are said once a save was tried.
 */
function DeployTargetRows({
  rows,
  checkedRows,
  onChange,
  environments,
  checked,
}: {
  readonly rows: ReadonlyArray<TargetRow>
  readonly checkedRows: ReadonlyArray<CheckedRow>
  readonly onChange: (rows: ReadonlyArray<TargetRow>) => void
  /** The environments to suggest, such as those the project's telemetry named. */
  readonly environments: ReadonlyArray<EnvironmentKey>
  /** Whether a save was tried, so rules are said. */
  readonly checked: boolean
}) {
  const id = useId()
  const change = (row: TargetRow, next: Partial<Omit<TargetRow, "id">>) =>
    onChange(rows.map((each) => (each.id === row.id ? { ...each, ...next } : each)))
  const add = () =>
    onChange([
      ...rows,
      {
        id: Math.max(0, ...rows.map((row) => row.id)) + 1,
        environment: "",
        workflow: "",
        bundleId: "",
        distribution: "testFlight",
      },
    ])
  return (
    <fieldset className="flex flex-col gap-3" aria-describedby={`${id}-hint`}>
      <legend className="mb-1 text-sm">Deploy targets</legend>
      <p id={`${id}-hint`} className="text-muted-foreground">
        Promoting runs the workflow with the inputs <span className="font-mono">release</span>,{" "}
        <span className="font-mono">environment</span>, <span className="font-mono">commit</span> and{" "}
        <span className="font-mono">runner</span>, then sends an app&apos;s build to TestFlight or App Store review.
      </p>
      <datalist id={`${id}-environments`}>
        {environments.map((environment) => (
          <option key={environment} value={environment}>
            {environment}
          </option>
        ))}
      </datalist>
      {rows.map((row, index) => {
        const checkedRow = checkedRows[index] ?? { _tag: "empty" }
        const rules = checked && checkedRow._tag === "invalid" ? checkedRow : undefined
        const number = index + 1
        const field = `${id}-${row.id}`
        return (
          <div key={row.id} className="flex flex-col gap-3 border p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono text-[15px]">{row.environment.trim() || `Target ${number}`}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove deploy target ${number}`}
                onClick={() => onChange(rows.filter((each) => each.id !== row.id))}
              >
                <XIcon />
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <TargetField
                id={`${field}-environment`}
                label="Environment"
                number={number}
                list={`${id}-environments`}
                value={row.environment}
                onChange={(environment) => change(row, { environment })}
                example="production"
                rule={rules?.environment}
              />
              <TargetField
                id={`${field}-workflow`}
                label="Workflow file"
                number={number}
                value={row.workflow}
                onChange={(workflow) => change(row, { workflow })}
                example="deploy.yml"
                rule={rules?.workflow}
              />
            </div>
            {/* An app's ID and how far its builds go, each the target's full width. */}
            <TargetField
              id={`${field}-app`}
              label="App Store Connect app"
              number={number}
              value={row.bundleId}
              onChange={(bundleId) => change(row, { bundleId })}
              example="com.acme.notes"
              rule={rules?.bundleId}
            />
            <div className="flex min-w-0 flex-col gap-1.5">
              <span aria-hidden className="text-muted-foreground">
                Its builds go to
              </span>
              <Segmented
                label={`Where deploy target ${number}'s builds go`}
                options={distributions}
                value={row.distribution}
                onChange={(distribution) => change(row, { distribution })}
                className="self-start"
              />
            </div>
            {rules?.target !== undefined && <p className="text-failure">{rules.target}</p>}
          </div>
        )
      })}
      <Button type="button" variant="outline" size="sm" className="self-start" onClick={add}>
        <PlusIcon data-icon="inline-start" />
        Add a deploy target
      </Button>
    </fieldset>
  )
}

/**
 * Where a component's releases come from and where they go, as a form in a dialog: its GitHub
 * repository, whose commits they are; and its deploy target in each environment, a workflow, an App
 * Store Connect app, or both. Each is checked as the API checks it; an empty one unlinks it, and a
 * workflow needs the repository. Saving calls `onSave` with every link, as the API replaces them all;
 * while it saves the button says so, and a failure is said under the fields. The dialog closes when
 * the page says so, such as once the save succeeded.
 */
export function LinksDialog({
  component,
  environments,
  open,
  onOpenChange,
  saving,
  onSave,
}: {
  readonly component: Component
  /** The environments a deploy target's field suggests: the project's, production first. */
  readonly environments: ReadonlyArray<EnvironmentKey>
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  /** The last save's answer. */
  readonly saving: AsyncResult.AsyncResult<Component, unknown>
  readonly onSave: (links: ComponentLinks) => void
}) {
  const [repository, setRepository] = useState(component.repository ?? "")
  const [rows, setRows] = useState<ReadonlyArray<TargetRow>>(() =>
    (component.deployTargets ?? []).map((target, index) => ({
      id: index,
      environment: target.environment,
      workflow: target.workflow ?? "",
      bundleId: target.appStore?.bundleId ?? "",
      distribution: target.appStore?.distribution ?? "testFlight",
    })),
  )
  // Rules are said once a save was tried, not while the first value is being typed.
  const [checked, setChecked] = useState(false)
  const typedRepository = typedOf(repository, decodeRepository)
  const repositoryRule = checked && typedRepository._tag === "invalid" ? typedRepository.rule : undefined
  const checkedRows = checkedRowsOf(rows, typedRepository._tag === "valid")
  const targets = checkedRows.flatMap((row) => (row._tag === "valid" ? [row.target] : []))
  const rowsValid = checkedRows.every((row) => row._tag !== "invalid")
  // What the list breaks as a whole, such as having more targets than a component may.
  const decodedTargets = decodeTargets(targets)
  const listRule = checked && Result.isFailure(decodedTargets) ? decodedTargets.failure.message : undefined

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Where {component.key}&apos;s releases come from</DialogTitle>
          <DialogDescription>
            Its GitHub repository gives each release its commit and what changed since the one before; its deploy
            targets say where a release goes in each environment, and how.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault()
            setChecked(true)
            if (typedRepository._tag === "invalid" || !rowsValid || Result.isFailure(decodedTargets)) {
              return
            }
            onSave({
              ...(typedRepository._tag === "valid" ? { repository: typedRepository.value } : {}),
              ...(decodedTargets.success.length > 0 ? { deployTargets: decodedTargets.success } : {}),
            })
          }}
        >
          <RepositoryField value={repository} onChange={setRepository} rule={repositoryRule} />
          <DeployTargetRows
            rows={rows}
            checkedRows={checkedRows}
            onChange={setRows}
            environments={environments}
            checked={checked}
          />
          {listRule !== undefined && (
            <p role="alert" className="text-failure">
              {listRule}
            </p>
          )}
          {checked && !rowsValid && (
            <p role="alert" className="text-failure">
              Fix what each target says, then save.
            </p>
          )}
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
