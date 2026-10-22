import type { ComponentKey } from "@cluenori/foundation"
import type { ComponentVersion } from "@cluenori/releases"
import { BuildNumber, SemanticVersion } from "@cluenori/releases"
import { Result, Schema } from "effect"
import { ChevronDownIcon } from "lucide-react"
import { useId, useState } from "react"

import type { VersionPart } from "@/release-facts"
import { bumpedVersion, nextReleaseOf } from "@/release-facts"
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/views/ui/dropdown-menu"
import { Input } from "@/views/ui/input"

// A version and a first build typed in are checked by the API's own rules.
const decodeVersion = Schema.decodeResult(SemanticVersion)
const decodeBuild = Schema.decodeUnknownResult(BuildNumber)

const parts: ReadonlyArray<{ readonly part: VersionPart; readonly label: string }> = [
  { part: "patch", label: "Patch" },
  { part: "minor", label: "Minor" },
  { part: "major", label: "Major" },
]

/** A version to set, checked: the version, and where build numbers continue from, when given. */
export type VersionToSet = { readonly version: SemanticVersion; readonly firstBuild?: BuildNumber }

/**
 * Setting a component's version, as a form in a dialog: the version, `MAJOR.MINOR.PATCH`, the same
 * or higher than now, and optionally the build number its builds continue from, above the last
 * given, as for an app whose builds were numbered before. Each checked by the API's rule; why the
 * API refused is said above the buttons.
 */
export function SetVersionDialog({
  component,
  current,
  open,
  onOpenChange,
  saving,
  refusal,
  onSave,
}: {
  readonly component: ComponentKey
  /** The component's version line; absent before its version was set. */
  readonly current: ComponentVersion | undefined
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly saving: boolean
  /** Why the last save didn't set it, in words. */
  readonly refusal: string | undefined
  readonly onSave: (set: VersionToSet) => void
}) {
  const id = useId()
  const [version, setVersion] = useState(current?.version ?? "1.0.0")
  const [firstBuild, setFirstBuild] = useState("")
  const [checked, setChecked] = useState(false)
  const decodedVersion = decodeVersion(version.trim())
  const typedBuild = firstBuild.trim()
  const decodedBuild = typedBuild === "" ? undefined : decodeBuild(Number(typedBuild))
  const versionRule = checked && Result.isFailure(decodedVersion) ? decodedVersion.failure.message : undefined
  const buildRule =
    checked && decodedBuild !== undefined && Result.isFailure(decodedBuild)
      ? "A whole number from 1, such as 120."
      : undefined
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{component}&apos;s version</DialogTitle>
          <DialogDescription>
            Its next builds are numbered in it: a commit built for the first time becomes{" "}
            <span className="font-mono">version+build</span>, for good. It can only go up.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault()
            setChecked(true)
            if (Result.isFailure(decodedVersion) || (decodedBuild !== undefined && Result.isFailure(decodedBuild))) {
              return
            }
            onSave({
              version: decodedVersion.success,
              ...(decodedBuild === undefined ? {} : { firstBuild: decodedBuild.success }),
            })
          }}
        >
          <div className="flex flex-col gap-2">
            <label htmlFor={`${id}-version`} className="text-sm">
              Version
            </label>
            <Input
              id={`${id}-version`}
              value={version}
              onChange={(event) => setVersion(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={versionRule !== undefined}
              aria-describedby={`${id}-version-help`}
              className="h-9 font-mono"
            />
            <p
              id={`${id}-version-help`}
              className={versionRule === undefined ? "text-muted-foreground" : "text-failure"}
            >
              {versionRule ?? "MAJOR.MINOR.PATCH, such as 1.4.0."}
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor={`${id}-build`} className="text-sm">
              First build number
            </label>
            <Input
              id={`${id}-build`}
              inputMode="numeric"
              value={firstBuild}
              onChange={(event) => setFirstBuild(event.target.value)}
              autoComplete="off"
              aria-invalid={buildRule !== undefined}
              aria-describedby={`${id}-build-help`}
              className="h-9 font-mono"
            />
            <p id={`${id}-build-help`} className={buildRule === undefined ? "text-muted-foreground" : "text-failure"}>
              {buildRule ??
                (current === undefined
                  ? "Optional: where its build numbers start, such as above an app's builds numbered before."
                  : `Optional: where its build numbers continue from, above ${current.lastBuild}.`)}
            </p>
          </div>
          {refusal !== undefined && (
            <p role="alert" className="text-failure">
              {refusal}
            </p>
          )}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button type="submit" disabled={saving}>
              {saving ? "Setting…" : "Set the version"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** One component as the versions list shows it: its name, key and color. */
export type VersionedComponent = { readonly key: ComponentKey; readonly name: string; readonly color: string }

/**
 * Each component's version and the release its next build will be, with a menu to bump its patch,
 * minor or major, each showing what it becomes, and setting it by hand. A component without a
 * version says that CI can't number its builds until it has one.
 */
export function VersionList({
  components,
  versions,
  bumping,
  problem,
  onBump,
  onSet,
}: {
  readonly components: ReadonlyArray<VersionedComponent>
  readonly versions: ReadonlyArray<ComponentVersion>
  /** The component a bump is being saved for. */
  readonly bumping: ComponentKey | undefined
  /** Why the last bump of a component didn't happen, in words. */
  readonly problem: { readonly component: ComponentKey; readonly text: string } | undefined
  readonly onBump: (component: ComponentKey, version: SemanticVersion) => void
  readonly onSet: (component: ComponentKey) => void
}) {
  if (components.length === 0) {
    return <p className="px-5 py-6 text-sm text-muted-foreground">No components yet.</p>
  }
  return (
    <ul className="divide-y">
      {components.map((component) => {
        const line = versions.find((each) => each.component === component.key)
        return (
          <li
            key={component.key}
            className="grid items-center gap-x-6 gap-y-3 px-5 py-4 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_auto]"
          >
            <span className="flex min-w-0 items-center gap-3">
              <span className="size-2.5 shrink-0" style={{ backgroundColor: component.color }} />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-[15px]">{component.name}</span>
                <span className="truncate font-mono text-sm text-muted-foreground">{component.key}</span>
              </span>
            </span>
            {line === undefined ? (
              <span className="text-sm text-muted-foreground">Set a version to let CI number its builds.</span>
            ) : (
              <span className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-0.5">
                <span className="font-mono text-lg">{line.version}</span>
                <span className="text-sm text-muted-foreground">
                  Next build <span className="font-mono text-foreground">{nextReleaseOf(line)}</span>
                </span>
              </span>
            )}
            <span className="flex flex-wrap gap-2">
              {line !== undefined && (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={<Button variant="outline" size="sm" disabled={bumping === component.key} />}
                  >
                    {bumping === component.key ? "Bumping…" : "Bump"}
                    <span className="sr-only"> {component.key}</span>
                    <ChevronDownIcon data-icon="inline-end" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuGroup>
                      <DropdownMenuLabel>From {line.version}; it can&apos;t go back down</DropdownMenuLabel>
                      {parts.map((each) => {
                        const next = bumpedVersion(line.version, each.part)
                        return (
                          <DropdownMenuItem
                            key={each.part}
                            onClick={() => {
                              const decoded = decodeVersion(next)
                              if (Result.isSuccess(decoded)) {
                                onBump(component.key, decoded.success)
                              }
                            }}
                          >
                            {each.label}
                            <span className="ml-auto font-mono text-muted-foreground">{next}</span>
                          </DropdownMenuItem>
                        )
                      })}
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <Button variant="outline" size="sm" onClick={() => onSet(component.key)}>
                Set version…<span className="sr-only"> of {component.key}</span>
              </Button>
            </span>
            {problem?.component === component.key && (
              <p role="alert" className="text-sm text-failure sm:col-span-3">
                {problem.text}
              </p>
            )}
          </li>
        )
      })}
    </ul>
  )
}
