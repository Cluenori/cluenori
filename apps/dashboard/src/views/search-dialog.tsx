import type { ProjectKey } from "@cluenori/foundation"
import { useAtomValue } from "@effect/atom-react"
import { AsyncResult } from "effect/reactivity"
import { BugIcon, FolderIcon, PaletteIcon } from "lucide-react"

import { errorsAtom } from "@/project-data"
import type { Route } from "@/router"
import { navigate } from "@/router"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/views/ui/command"

/** The project's errors of the period, asked for when search opens; none until they arrive. */
function ProjectErrors({ project, go }: { readonly project: ProjectKey; readonly go: (route: Route) => void }) {
  const errors = useAtomValue(errorsAtom({ project }))
  if (!AsyncResult.isSuccess(errors) || errors.value.groups.length === 0) {
    return null
  }
  return (
    <CommandGroup heading="Errors">
      {errors.value.groups.map((group) => (
        <CommandItem key={group.id} onSelect={() => go({ page: "error", project, error: group.id })}>
          <BugIcon className="text-failure" />
          <span className="truncate">{group.title}</span>
        </CommandItem>
      ))}
    </CommandGroup>
  )
}

/** ⌘K: every project, and the current project's errors, found by typing a few letters. */
export function SearchDialog({
  open,
  onOpenChange,
  project,
  projects,
}: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  /** The project whose errors are listed, if a page shows one. */
  readonly project: ProjectKey | undefined
  readonly projects: ReadonlyArray<{ readonly key: ProjectKey; readonly name: string }>
}) {
  const go = (route: Route) => {
    onOpenChange(false)
    navigate(route)
  }
  return (
    // ⌘K opens and closes instantly: a keyboard action repeated all day shouldn't wait for an animation.
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search"
      description="Projects and errors"
      className="data-closed:animate-none data-open:animate-none"
    >
      <Command>
        <CommandInput placeholder="Search projects and errors…" />
        <CommandList>
          <CommandEmpty>Nothing matches.</CommandEmpty>
          <CommandGroup heading="Projects">
            {projects.map((entry) => (
              <CommandItem key={entry.key} onSelect={() => go({ page: "overview", project: entry.key })}>
                <FolderIcon />
                {entry.name}
              </CommandItem>
            ))}
            <CommandItem onSelect={() => go({ page: "kit" })}>
              <PaletteIcon />
              Design kit
            </CommandItem>
          </CommandGroup>
          {project !== undefined && <ProjectErrors project={project} go={go} />}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
